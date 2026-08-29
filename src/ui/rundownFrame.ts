import { FaceLandmarker } from "@mediapipe/tasks-vision";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { RegionId, ScoredMetric } from "../engine/types.js";
import type { RundownTimeline, TimedBeat } from "../engine/rundownTimeline.js";
import { beatNear } from "../engine/rundownTimeline.js";
import { drawMeasurement, measurementBounds } from "./measureOverlay.js";
import { drawCtaCard } from "./ctaCard.js";
import { drawSearchLockup } from "./searchLockup.js";
import { SPREAD } from "../engine/rarity.js";

// ---------------------------------------------------------------------------
// The rundown, one frame at a time.
//
// The other two cuts are one composition each, animated by a clock. This one is
// a sequence: fourteen or so beats, each naming a measurement, each cropped to
// the part of the face it is about. The camera walks down the face once.
//
// Four decisions carry the format, and all four came from watching what the
// reference channel actually does rather than from what its UI looks like:
//
// 1. THE NUMBER SITS ON THE LINE. Not in a corner, not in a legend, not in a
//    badge. The eye lands on the measurement and the value at the same moment,
//    which is the whole difference between a diagram and a proof.
//
// 2. ONE MEASUREMENT, EVERYTHING ELSE DARK. A face with ten overlays on it is a
//    wireframe. A face with one is evidence. The dimming is also what makes the
//    frame legible at thumbnail size, which is where it gets chosen.
//
// 3. THE CROP MOVES. Eyes beat is cropped to the eyes; jaw beat is cropped to
//    the jaw. This is what makes the top-to-bottom running order VISIBLE rather
//    than merely true — and it is why the ordering bug had to be fixed before
//    any of this could be drawn, because bouncing back up the face is invisible
//    on a static portrait and glaring once the camera moves.
//
// 4. THE BOTTOM BAR IS FIXED. Metric name and "Score" left, value and band
//    right, always in the same place. It sits above the zone where TikTok puts
//    its own caption and buttons, so nothing important is ever covered.
//
// The overlay geometry is not reimplemented here. measureOverlay.ts already
// knows how to draw every metric on a face and has been through a round of
// getting the honesty right — lines extend along their own path so a partial
// draw is a SUBSET of the true figure rather than a wrong one. It draws in
// normalized landmark space, so the same crop rectangle that positions the
// photograph positions the overlay, and the two cannot drift apart.
// ---------------------------------------------------------------------------

// Where each region sits down the face, as a fraction of the face bounding box.
//
// Deliberately bands rather than landmark indices. The exact points for a
// measurement live in measureOverlay's recipes and duplicating them here would
// mean two places to update and one of them silently going stale. A band is
// derived from the bounding box the frame already computes, is obviously right
// or obviously wrong on sight, and only has to be good enough to frame a crop.
//
// Generous on purpose: a crop tight enough to be exactly the eyes reads as a
// stock-photo close-up and loses the face doing the reacting. These include
// enough around them to keep it a person.
// How much head sits above the mesh, in mesh-box heights.
//
// MediaPipe's topmost vertex lands near the hairline, not the crown, so the
// bounding box of the landmarks is a face rather than a head — roughly the
// bottom three quarters of one. Framing anything against that box without
// adding this back guarantees a flat-topped portrait.
const CROWN = 0.34;

//
// Note that the box these are fractions of is the MESH box, and the mesh stops
// at the top of the forehead. Zero is not the top of the head — it is somewhere
// around the hairline, with a third of a head still above it. Every band here
// is written in those units, and CROWN below is what converts back.
const BAND: Record<RegionId, [number, number]> = {
  eyes: [0.06, 0.66],
  midface: [0.16, 0.8],
  nose: [0.22, 0.86],
  lips: [0.42, 1.02],
  jaw: [0.36, 1.1],
  chin: [0.5, 1.14],
  // Whole-face measurements, and the reason this table needed revisiting.
  //
  // [0, 1] is not the whole face. It is the mesh, which starts at the forehead
  // and ends at the chin — so a "whole face" crop cut the top of the head off
  // and stopped flush at the jaw, which is what made every rundown look like it
  // had been framed by someone standing too close. A portrait needs the skull
  // and some air under the chin, and neither of those is inside the mesh.
  proportions: [-CROWN, 1.12],
  symmetry: [-CROWN, 1.12],
};

// ---------------------------------------------------------------------------
// THE SAFE AREA, in pixels of a 1280-tall frame.
//
// TikTok and Instagram both draw their own furniture over the bottom of a reel
// — the poster's handle, the caption, the sound name — and TikTok adds a column
// of action buttons up the right side. Anything the video puts under that is
// not "subtle", it is invisible.
//
// The header comment above claims the bottom bar "sits above the zone where
// TikTok puts its own caption and buttons". It did not: it was at H - 128, and
// the watermark at H - 22 was underneath the sound title on every single post.
//
// 300px of 1280 is about 23%, measured against a screenshot of a real TikTok
// rather than reasoned about — TikTok's caption block runs to roughly 20% and
// Instagram's to roughly 18%, so this clears both with a little margin for the
// taller phones where the safe area grows.
// Measured from the published TikTok/Reels safe-zone template, on its own
// 1080x1920 canvas, and divided by 1.5 for this frame's 720x1280:
//
//   top     270px -> 180   the handle, the "following/for you" tabs, the search
//   bottom  335px -> 223   caption block, sound title, progress bar
//   left     60px ->  40   thumb rest
//   right   120px ->  80   the action rail, from about a third down
//
// SAFE_BOTTOM stays at 300 rather than dropping to the measured 223. The
// template is the minimum that is not COVERED; a caption sitting one pixel
// above a sound title is legible and still looks cramped, and taller phones
// grow that zone. The extra 77px is breathing room, deliberately spent.
//
// SAFE_RIGHT likewise sits at 132 against a measured 80 — the action rail is
// wider on the newer layout and its icons carry labels.
const SAFE_TOP = 180;
const SAFE_BOTTOM = 300;
const SAFE_LEFT = 48;
// The right-hand action rail. Only the bottom bar is wide enough to reach it.
const SAFE_RIGHT = 132;

// The video's stroke weight, over the report's hairline (1). The platform's
// re-encode eats exactly the width a screen never loses, and the reference
// channels' lines read a step heavier — this keeps the white line and the
// endpoint nodes, just built to survive compression and bright skin.
const VIDEO_LINE_WEIGHT = 1.35;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const smoother = (n: number) => n * n * n * (n * (n * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RundownInput {
  timeline: RundownTimeline;
  /** Keyed by metric id, for the overlay geometry. */
  metrics: Map<string, ScoredMetric>;
  name: string;
  /**
   * Extra photographs of the same person, shown but NEVER measured.
   *
   * A rundown built from one photograph is one photograph held for ninety
   * seconds, and a still frame is the format's biggest weakness — every
   * competitor cuts between shots. These are the cutaways.
   *
   * They are strictly B-ROLL and the restriction is not a limitation, it is the
   * thing that makes the feature safe. Every measurement is drawn in the
   * MEASURED photograph's normalized landmark space; the same line composited
   * over a different photograph would sit somewhere arbitrary on a different
   * face, which is a rundown drawing a jaw measurement across somebody's
   * forehead. So a cutaway may only appear on a beat that draws no measurement:
   * the hook, the context beat, the disclaimer, the sign-off.
   *
   * They cannot move a score: nothing here reaches the scoring or the report,
   * and every number said or drawn in the video comes from the measured
   * photograph. What they CAN carry is the same measurement drawn in the right
   * place on the face currently on screen — see `landmarks` below.
   */
  broll?: Array<{
    image: CanvasImageSource;
    /**
     * The cutaway's OWN landmarks, when a face was found in it.
     *
     * This is what makes a cutaway able to carry a measurement rather than
     * merely interrupt one. The number is always the measured photograph's —
     * one face, one set of figures, stated once — but the LINE is positioned by
     * this photograph's own geometry, so it lands on the mouth that is actually
     * on screen instead of where the other photograph's mouth happened to be.
     *
     * It is an annotation, not a second measurement, and the distinction is
     * real: the value shown is not re-derived here and a cutaway shot at a
     * different angle will have a slightly different true value than the label
     * says. That is the same licence any documentary takes with B-roll, and it
     * is the reason the figure is quoted once from the controlled photograph
     * rather than per shot.
     *
     * Absent when no face was detected — a hand, a silhouette, a back of a
     * head — and then the cutaway simply carries no line.
     */
    landmarks?: NormalizedLandmark[];
  }>;
  /**
   * A clip that plays under the operator's disclaimer, already seeked.
   *
   * The disclaimer is the one beat whose length the operator knows BEFORE the
   * render — spokenSeconds tells them while they type — so it is the one beat
   * they can go and find footage for. Everything else in the video is timed by
   * a synthesiser whose real duration nobody has yet.
   *
   * Seeking is the caller's job, not this module's: seeking an HTMLVideoElement
   * is asynchronous and every function in here is a synchronous draw. The
   * compositor awaits the seek and then hands the element over on the frame it
   * is wanted.
   */
  disclaimerClip?: CanvasImageSource;
  /**
   * The exact disclaimer text, so the clip lands on the right beat.
   *
   * Matched by line rather than by index because the context section holds up
   * to two beats — the templated "this measures a face and nothing else" and
   * the operator's own sentence — and only the second one has footage chosen
   * for it.
   */
  disclaimerLine?: string;
  /**
   * Which cut is being rendered.
   *
   * "short" cuts the SUBJECT OUT: on measurement beats the photograph is
   * matted to the face and floated on the dark ground, so the face is the
   * only thing in the frame — the reference format's look, achieved with the
   * landmarks the scan already has rather than a segmentation model. The hook
   * stays full bleed (the "how attractive is X" beat is the one place the
   * whole photograph earns its frame), and the card, curve and search beats
   * already own their compositions in both cuts.
   */
  cut?: "short" | "full";
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function faceBox(landmarks: NormalizedLandmark[]): Box {
  let x0 = 1;
  let x1 = 0;
  let y0 = 1;
  let y1 = 0;
  for (const p of landmarks) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}

/**
 * The crop for one region, in photo pixels, at a given output aspect.
 *
 * Exported because the timing of a crop move is a pacing decision and pacing is
 * tested — see rundownFrame.test.ts, which checks that the band for the chin
 * really does sit below the band for the eyes rather than trusting the table.
 */
export function regionCrop(
  photo: { width: number; height: number },
  landmarks: NormalizedLandmark[],
  region: RegionId | undefined,
  aspect: number,
  /**
   * The normalized box the beat's measurement will be drawn into, when there is
   * one. The crop is widened to contain it — see the MUST-CONTAIN block below.
   */
  mustContain?: { x0: number; y0: number; x1: number; y1: number },
): Crop {
  const box = faceBox(landmarks);
  const faceW = Math.max(1, (box.x1 - box.x0) * photo.width);
  const faceH = Math.max(1, (box.y1 - box.y0) * photo.height);
  const [top, bottom] = BAND[region ?? "proportions"] ?? [0, 1];

  // Height wanted for this band, with headroom so the band is not flush to the
  // frame edge, then width derived from the output aspect.
  // 1.22, up from 1.16: the tick-ends of a full-width measurement were
  // landing flush against the frame edge.
  const bandH = faceH * (bottom - top) * 1.22;
  let sh = Math.max(bandH, 1);
  let sw = sh * aspect;
  // A floor on how tight the crop may get, so an extreme zoom on a narrow band
  // does not turn a photograph into a texture.
  //
  // This was faceW * 1.12 — "always show the whole face plus a margin" — and it
  // quietly destroyed the entire format. The output is 9:16, so demanding the
  // full face width forces a crop TALLER than the face itself; every lower band
  // then ran past the bottom of the photograph, got clamped back, and landed in
  // the same place. Eyes, lips and chin all produced an identical frame. The
  // camera never moved, and nothing about the code said so.
  //
  // Below the face width is correct for a close-up: framing the eyes means the
  // ears are outside the frame, which is what a close-up IS. Whole-face metrics
  // are unaffected because their band asks for more height than this floor sets.
  //
  // Raised from 0.72. That number was set while fixing the opposite fault — a
  // floor of 1.12 face widths was forcing every band to the same clamped frame
  // — and the correction went too far the other way: at 0.72 an eyes beat is
  // cropped inside the cheekbones, which is a texture, not a face reacting.
  // 0.9 is still a close-up (the ears leave the frame) while keeping enough
  // face on either side to read as a person.
  const minW = faceW * 0.9;
  if (sw < minW) {
    sw = minW;
    sh = sw / aspect;
  }
  if (sw > photo.width) {
    sw = photo.width;
    sh = sw / aspect;
  }
  if (sh > photo.height) {
    sh = photo.height;
    sw = sh * aspect;
  }

  let cx = ((box.x0 + box.x1) / 2) * photo.width;
  let cy = (box.y0 + (box.y1 - box.y0) * ((top + bottom) / 2)) * photo.height;

  // MUST-CONTAIN: the frame has to hold the measurement it is framing.
  //
  // Everything above chooses a crop from the REGION — a band of the face and a
  // floor on how tight it may get. That is the right way to decide where the
  // camera looks, and it is a guess about how much it needs to see. The two
  // disagreed in the obvious way: a chin-width span runs the whole width of the
  // jaw, the close-up floor is nine tenths of the face width, and the line ran
  // off the right edge with its label outside the picture entirely.
  //
  // Widening here rather than raising the floor, because raising the floor is
  // the fix that was already tried and reverted. A floor big enough for the
  // widest measurement forces a 9:16 crop taller than the face on EVERY beat,
  // every lower band then clamps against the bottom of the photograph, and eyes,
  // lips and chin all render the identical frame. The camera stops moving. A
  // per-beat expansion costs nothing on the beats that do not need it.
  if (mustContain) {
    // 0.32, doubled from 0.16. The chip is not a point at the end of the
    // span, it is ~180px of label BEYOND the end of the span, and at 0.16 a
    // full-width measurement's chip rendered half outside the frame — the
    // exact clip this block exists to prevent.
    const pad = 0.32;
    const needW = (mustContain.x1 - mustContain.x0) * photo.width * (1 + pad * 2);
    // The vertical need is stricter than the horizontal: the bottom of the
    // frame carries the caption band, so a tall measurement gets only ~70% of
    // the frame's height to live in. Sizing to the padded height alone put a
    // cheekbone-height line's bottom endpoint flush against the caption.
    const needH = ((mustContain.y1 - mustContain.y0) * photo.height) / 0.7;
    if (needW > sw || needH > sh) {
      sw = Math.max(sw, needW, needH * aspect);
      sh = sw / aspect;
    }
    // Recentre on the union of the band and the measurement, so growing the box
    // does not leave the thing being drawn against one edge of it.
    cx = (((mustContain.x0 + mustContain.x1) / 2) * photo.width + cx) / 2;
    cy = (((mustContain.y0 + mustContain.y1) / 2) * photo.height + cy) / 2;
    if (sw > photo.width) {
      sw = photo.width;
      sh = sw / aspect;
    }
    if (sh > photo.height) {
      sh = photo.height;
      sw = sh * aspect;
    }
    // And POSITION the window so the drawn figure actually sits in the safe
    // area: top of the figure at least 8% into the frame, bottom above the
    // caption band. The bottom constraint is applied last because a collision
    // with the caption is the fault that was actually shipped.
    const mcY0 = mustContain.y0 * photo.height;
    const mcY1 = mustContain.y1 * photo.height;
    cy = Math.min(cy, mcY0 + sh * 0.42);
    cy = Math.max(cy, mcY1 - sh * 0.28);
  }

  // NEVER cut the face in half.
  //
  // The band table says which part of the face a beat is about, and a close-up
  // is the point: framing the eyes means the ears leave the frame. But a band
  // plus a floor is still only a guess at how much face there is, and on a
  // photograph where the head fills more of the picture than usual the guess
  // came out tighter than the head — chin off the bottom, crown off the top.
  // A face cut off mid-forehead is the one framing fault a viewer reads as a
  // broken renderer rather than as a choice.
  //
  // So the crop is grown until it holds the whole head, whatever the band asked
  // for. HEAD_FIT below is deliberately under 1: a close-up may still crop the
  // ears and the very top of the hair, which is what a close-up is. What it may
  // not do is cut through the features.
  // 1.12, up from 1.04, after the short cut's tighter look shipped a frame
  // with the crown shaved mid-hair: the CROWN allowance models the average
  // head and this is the margin for the heads it underestimates.
  const headW = faceW * 1.06;
  const headH = faceH * (1 + CROWN) * 1.12;
  // Raised from 0.86 after real exports: at 0.86 the crop was allowed to cut
  // 14% of the head, and on tight source photographs that 14% was the top of
  // the skull and the chin — the two cuts a viewer reads as a broken renderer.
  // The whole head, every beat. The camera still moves: bands recentre the
  // frame vertically where the photograph has room, and the push-in carries
  // the rest. What is genuinely lost is the tight close-up, and that trade is
  // deliberate — the subject of every beat is a face, not a texture.
  const HEAD_FIT = 1.0;
  if (sw < headW * HEAD_FIT || sh < headH * HEAD_FIT) {
    sw = Math.max(sw, headW * HEAD_FIT, headH * HEAD_FIT * aspect);
    sh = sw / aspect;
  }

  // Fidelity floor. It prevents texture-level crops while remaining low enough
  // that the vertical camera move still exists on a landscape photograph.
  const fidelityWidth = photo.width * 0.34;
  if (sw < fidelityWidth) {
    sw = fidelityWidth;
    sh = sw / aspect;
  }

  // Re-clamped after growing: everything above may have pushed the crop past
  // the edge of the photograph, and drawing past the edge paints the void.
  if (sw > photo.width) {
    sw = photo.width;
    sh = sw / aspect;
  }
  if (sh > photo.height) {
    sh = photo.height;
    sw = sh * aspect;
  }

  return {
    x: Math.max(0, Math.min(photo.width - sw, cx - sw / 2)),
    y: Math.max(0, Math.min(photo.height - sh, cy - sh / 2)),
    w: sw,
    h: sh,
  };
}

const lerpCrop = (a: Crop, b: Crop, t: number): Crop => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  w: lerp(a.w, b.w, t),
  h: lerp(a.h, b.h, t),
});

/**
 * The crop at time t, moving between regions during the gap at the end of a
 * beat rather than cutting.
 *
 * A hard cut between crops on every beat would be fourteen cuts in a minute,
 * which reads as a slideshow — the exact failure the running order was fixed to
 * avoid. Moving during the gap means the camera is settled by the time the next
 * sentence starts.
 */
export function cropAt(
  photo: { width: number; height: number },
  landmarks: NormalizedLandmark[],
  timeline: RundownTimeline,
  t: number,
  aspect: number,
  /**
   * The scored metrics, so a beat's crop can be widened to hold the measurement
   * it is about to draw. Optional: without it the framing falls back to the
   * region bands alone, which is what it did before and is still usable.
   */
  metrics?: Map<string, ScoredMetric>,
  /** Widen each beat's frame for its companion line too — short cut only. */
  withCompanions = false,
  /**
   * Hold the beat's own crop instead of travelling toward the next beat's.
   * Set when the next beat plays on a DIFFERENT photograph (see stageFor):
   * lerping a crop toward a region computed on this photo for a move that
   * will actually happen on another one is a drift toward nowhere, and the
   * stage dip covers the cut it was smoothing.
   */
  holdAtEnd = false,
): Crop {
  // The union of every measurement named in a beat, since a sentence may name
  // more than one and the frame has to hold all of them at once.
  const bounds = (b: TimedBeat) => {
    if (!metrics) return undefined;
    const named = b.beat.metricIds ?? (b.beat.metricId ? [b.beat.metricId] : []);
    const ids = withCompanions
      ? [...named, ...named.map((id) => COMPANIONS[id]).filter(Boolean)]
      : named;
    let out: { x0: number; y0: number; x1: number; y1: number } | undefined;
    for (const id of ids) {
      const m = metrics.get(id);
      const box = m && measurementBounds(m, landmarks);
      if (!box) continue;
      out = out
        ? {
            x0: Math.min(out.x0, box.x0),
            y0: Math.min(out.y0, box.y0),
            x1: Math.max(out.x1, box.x1),
            y1: Math.max(out.y1, box.y1),
          }
        : box;
    }
    return out;
  };

  // Clamped at both ends. A fitted timeline starts where the SPEECH starts
  // inside the audio file rather than at zero, so the opening frames belong to
  // no beat — and findIndex answers -1 for those, which through a bare fallback
  // meant the video opened on the crop of its own last beat.
  const found = timeline.beats.findIndex((b) => t >= b.start && t < b.start + b.duration);
  const index =
    found >= 0 ? found : t < (timeline.beats[0]?.start ?? 0) ? 0 : timeline.beats.length - 1;
  const current = timeline.beats[index];
  if (!current) return regionCrop(photo, landmarks, undefined, aspect);

  const here = regionCrop(photo, landmarks, current.beat.region, aspect, bounds(current));
  const next = timeline.beats[index + 1];
  if (!next || holdAtEnd) return here;

  // The move occupies the last 0.55s of the beat, or the whole tail if the beat
  // is shorter than that.
  const MOVE = 0.55;
  const end = current.start + current.duration;
  const from = Math.max(current.start, end - MOVE);
  if (t < from) return here;
  const there = regionCrop(photo, landmarks, next.beat.region, aspect, bounds(next));
  return lerpCrop(here, there, smoother(clamp01((t - from) / (end - from))));
}

/**
 * How far through drawing its overlay a beat is at time t, 0..1.
 *
 * Zero for beats that draw nothing, so the caller does not have to ask twice.
 */
export function drawProgress(beat: TimedBeat, t: number, snappy = false): number {
  if (beat.drawAt === undefined) return 0;
  // The figure arrives over the run-up to drawAt, so it COMPLETES on the click
  // rather than starting there. The sound is the measurement landing.
  //
  // The run-up is clamped to the beat's own start. drawAt sits 16% into the
  // beat, so on a short one — a four-word hook, a sign-off — half a second of
  // run-up began BEFORE the beat did, and the line was already part drawn on
  // its first frame. Rare, and exactly the kind of thing that looks like the
  // renderer is a frame out.
  // 0.38, down from 0.5. At the new narration rate a half-second run-up ate
  // most of a short clause; the line should land just before its number is
  // spoken, not draw through the whole sentence.
  const DRAW = snappy ? 0.3 : 0.38;
  const from = Math.max(beat.start, beat.drawAt - DRAW);
  const span = Math.max(0.001, beat.drawAt - from);
  const drawn = clamp01((t - from) / span);

  // And it RETRACTS on the way out, along the same paths it arrived on.
  //
  // The exit was a fade of the whole figure: every line dimmed in place and
  // then was gone. It never looked wrong exactly, but it reads as an overlay
  // being switched off, which is what it was. Un-drawing it — the line
  // withdrawing toward its start point, the ticks and the label going first —
  // reads as the measurement being taken away, which is the same gesture that
  // put it there played backwards, and it is what makes the reference channels
  // look deliberate rather than like a slideshow with annotations.
  //
  // Costs nothing extra: drawMeasurement already renders any partial progress
  // as a strict subset of the true figure, so running it back down is as
  // geometrically honest as running it up.
  const RETRACT = snappy ? 0.26 : 0.42;
  const leaving = clamp01((overlayEnds(beat, snappy) - t) / RETRACT);
  return Math.min(drawn, leaving);
}

/**
 * When the measurement has to be off the face, in absolute seconds.
 *
 * Not simply the end of the beat. A metric beat hands its last third to a
 * cutaway — a different photograph, which the overlay cannot be drawn over
 * because the lines live in the measured face's landmark space. So on those
 * beats the figure has to be gone by the time the cutaway arrives, not by the
 * time the beat does.
 *
 * Scheduling the retraction against the beat's end instead put the whole
 * animation inside the cutaway window, where nothing is drawn: the lines simply
 * vanished on the cut and the retraction was invisible on exactly the beats
 * that have one. Found by rendering it, after the tests for it passed.
 */
function overlayEnds(beat: TimedBeat, snappy = false): number {
  // The short cut holds almost no clean frame before the cut: the reference
  // format's feel is that one figure is still leaving while the next arrives,
  // so the retraction runs nearly to the boundary and the next beat's draw is
  // already running its run-up on the other side of the cut.
  const cut = beat.start + beat.duration - (snappy ? 0.03 : CUT_CLEAR);
  if (beat.beat.kind !== "metric") return cut;
  // The cutaway takes over here — see brollFor, which owns the same fraction.
  const cutaway = beat.start + beat.duration * (1 - CUTAWAY_TAIL);
  return Math.min(cut, cutaway);
}

// A beat of clean frame before the cut.
//
// The retract finishes here rather than at the boundary, so the last frames of
// a beat hold a bare photograph. A cut that lands mid-animation is the single
// most obvious way for an edit to look unfinished.
const CUT_CLEAR = 0.12;

/**
 * How opaque the measurement is at this instant, 0..1.
 *
 * Separate from drawProgress, which is how much of the LINE has been drawn.
 * They are different questions and were being answered by the same number: the
 * figure snapped to full opacity the moment it existed and vanished the frame
 * the beat ended, which is the popping.
 *
 * In over the draw, held through the middle, out over the last stretch. The
 * fade out matters more than the fade in — a measurement that disappears
 * between two frames reads as a glitch, and one that dissolves reads as the
 * video moving on.
 */
export function overlayAlpha(beat: TimedBeat, t: number, snappy = false): number {
  // The figure now RETRACTS rather than dissolving — see drawProgress — so the
  // alpha's job on the way out is much smaller than it was. It only has to stop
  // the last few pixels of a line popping off at zero length, which a fast fade
  // over the tail of the retraction does.
  //
  // Kept as its own function because the cutaway path scales it separately and
  // because "is any of this on screen" is a question several callers ask.
  const drawn = drawProgress(beat, t, snappy);
  // Fully opaque as soon as there is any meaningful line, and only softening
  // once the retraction has nearly finished.
  return smoother(clamp01(drawn / 0.12));
}

export interface RundownFrameOptions {
  width: number;
  height: number;
  /** Reused across frames — allocating one per frame is the whole cost. */
  overlayCanvas: HTMLCanvasElement;
}

// A camera that never moves reads as a slideshow no matter how good the
// cuts are. Every full-bleed beat drifts in by this much over its own length
// — enough that the frame is visibly alive, small enough that nobody watching
// could say where the move started.
const PUSH_IN = 0.035;

// The push is a function of the crop, not a transform on the context, so the
// measurement overlay — composited through the very same rectangle — stays on
// the feature for free. Zooming the photograph and not the crop is how a line
// ends up near a jaw instead of on it.
function pushInCrop(crop: Crop, photo: { width: number; height: number }, p: number): Crop {
  const s = 1 - PUSH_IN * clamp01(p);
  const w = crop.w * s;
  const h = crop.h * s;
  const x = Math.max(0, Math.min(photo.width - w, crop.x + (crop.w - w) / 2));
  const y = Math.max(0, Math.min(photo.height - h, crop.y + (crop.h - h) / 2));
  return { x, y, w, h };
}

// The opening resolve: the first frames arrive out of focus and sharpen as
// the hook lands. Implemented as a cached downscale/upscale rather than
// ctx.filter, because filter support in the browsers that run this export is
// exactly the kind of thing that differs between the preview and the file.
// Deterministic: the blur is a pure function of t and the frame content.
const RESOLVE_S = 0.9;
let resolveScratch: HTMLCanvasElement | null = null;

function drawOpeningResolve(ctx: CanvasRenderingContext2D, t: number, W: number, H: number): void {
  const p = clamp01(t / RESOLVE_S);
  if (p >= 1) return;
  resolveScratch ??= document.createElement("canvas");
  // Stronger early: a twelfth of the frame at t=0, easing toward full
  // resolution as the alpha runs out.
  const f = lerp(12, 3, p);
  const sw = Math.max(2, Math.round(W / f));
  const sh = Math.max(2, Math.round(H / f));
  resolveScratch.width = sw;
  resolveScratch.height = sh;
  const sctx = resolveScratch.getContext("2d")!;
  sctx.imageSmoothingEnabled = true;
  sctx.drawImage(ctx.canvas, 0, 0, ctx.canvas.width, ctx.canvas.height, 0, 0, sw, sh);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = 1 - smoother(p);
  ctx.drawImage(resolveScratch, 0, 0, sw, sh, 0, 0, W, H);
  ctx.restore();
}

// How long a cutaway takes to rise out of black. The background under it is
// the frame's own near-black, so an alpha ramp is a dip-to-black cut — the
// cheapest transition that still reads as an edit rather than a glitch.
const CUT_DIP = 0.18;

function cutawayAlpha(beat: TimedBeat, t: number): number {
  const start =
    beat.beat.kind === "metric"
      ? beat.start + beat.duration * (1 - CUTAWAY_TAIL)
      : beat.start;
  const rise = smoother(clamp01((t - start) / CUT_DIP));
  // And back down at the beat's end. Without the fall, every cutaway ended at
  // full brightness and slammed straight onto the next frame — the one hard
  // cut left in the video, sitting right where the sentence lands. Through
  // black on both sides, the same edit reads as intentional.
  const fall = smoother(clamp01((beat.start + beat.duration - t) / CUT_DIP));
  return rise * fall;
}

// ---------------------------------------------------------------------------
// The short cut's face matte.
//
// The reference format's single strongest visual is that the person is CUT
// OUT: nothing in the frame but the face on darkness, so there is nothing to
// look at except the thing being measured. A segmentation model would buy a
// pixel-perfect edge at the cost of a multi-megabyte download; the scan
// already carries a face oval in its landmarks, and a generously expanded,
// heavily feathered hull of that oval reads as a deliberate spotlight rather
// than a cheap cutout — the feather is doing the honesty work of admitting
// this is a matte, not a segmentation.
//
// The hull is expanded upward far more than outward because MediaPipe's oval
// stops at the hairline: without the crown allowance the matte would guillotine
// the hair, which is the one mistake that makes a cutout look broken rather
// than stylised.
// ---------------------------------------------------------------------------

const MATTE_EXPAND = 1.3;
const MATTE_CROWN = 0.62;
const MATTE_FEATHER = 0.055;

let matteCanvas: HTMLCanvasElement | null = null;
let maskCanvas: HTMLCanvasElement | null = null;

function scratch(store: "matte" | "mask", W: number, H: number): HTMLCanvasElement {
  let c = store === "matte" ? matteCanvas : maskCanvas;
  if (!c) {
    c = document.createElement("canvas");
    if (store === "matte") matteCanvas = c;
    else maskCanvas = c;
  }
  if (c.width !== W || c.height !== H) {
    c.width = W;
    c.height = H;
  }
  return c;
}

// The face-oval hull in FRAME coordinates, ordered by angle about its own
// centroid — the oval is star-shaped around its centre, so an angle sort is a
// correct ring without walking MediaPipe's edge list.
function ovalRing(
  landmarks: NormalizedLandmark[],
  photo: { width: number; height: number },
  crop: Crop,
  W: number,
  H: number,
): Array<[number, number]> {
  const idx = new Set<number>();
  for (const edge of FaceLandmarker.FACE_LANDMARKS_FACE_OVAL) {
    idx.add(edge.start);
    idx.add(edge.end);
  }
  const pts: Array<[number, number]> = [];
  for (const i of idx) {
    const p = landmarks[i];
    if (!p) continue;
    pts.push([
      ((p.x * photo.width - crop.x) / crop.w) * W,
      ((p.y * photo.height - crop.y) / crop.h) * H,
    ]);
  }
  if (pts.length < 3) return pts;
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  return pts
    .map(([x, y]) => {
      // Expand about the centroid, with extra headroom above it for the crown.
      const ex = cx + (x - cx) * MATTE_EXPAND;
      let ey = cy + (y - cy) * MATTE_EXPAND;
      if (y < cy) ey -= (cy - y) * MATTE_CROWN;
      return [ex, ey, Math.atan2(y - cy, x - cx)] as [number, number, number];
    })
    .sort((a, b) => a[2] - b[2])
    .map(([x, y]) => [x, y]);
}

function drawMattedPhoto(
  ctx: CanvasRenderingContext2D,
  photo: HTMLCanvasElement,
  landmarks: NormalizedLandmark[],
  crop: Crop,
  W: number,
  H: number,
): void {
  const ring = ovalRing(landmarks, photo, crop, W, H);
  if (ring.length < 3) {
    ctx.drawImage(photo, crop.x, crop.y, crop.w, crop.h, 0, 0, W, H);
    return;
  }
  const mask = scratch("mask", W, H);
  const mctx = mask.getContext("2d")!;
  mctx.clearRect(0, 0, W, H);
  mctx.filter = `blur(${Math.round(W * MATTE_FEATHER)}px)`;
  mctx.fillStyle = "#fff";
  mctx.beginPath();
  mctx.moveTo(ring[0][0], ring[0][1]);
  for (const [x, y] of ring.slice(1)) mctx.lineTo(x, y);
  mctx.closePath();
  mctx.fill();
  mctx.filter = "none";

  const matte = scratch("matte", W, H);
  const tctx = matte.getContext("2d")!;
  tctx.clearRect(0, 0, W, H);
  tctx.drawImage(photo, crop.x, crop.y, crop.w, crop.h, 0, 0, W, H);
  tctx.globalCompositeOperation = "destination-in";
  tctx.drawImage(mask, 0, 0);
  tctx.globalCompositeOperation = "source-over";

  // A soft pool of light behind the head, so the subject sits IN the dark
  // rather than pasted onto it.
  const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length;
  const cy = ring.reduce((a, p) => a + p[1], 0) / ring.length;
  const glow = ctx.createRadialGradient(cx, cy, W * 0.05, cx, cy, W * 0.75);
  glow.addColorStop(0, "rgba(38,48,50,0.55)");
  glow.addColorStop(1, "rgba(5,6,6,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(matte, 0, 0);
}

export function drawRundownFrame(
  ctx: CanvasRenderingContext2D,
  photo: HTMLCanvasElement,
  landmarks: NormalizedLandmark[],
  input: RundownInput,
  t: number,
  options: RundownFrameOptions,
): void {
  const { width: W, height: H, overlayCanvas } = options;
  ctx.fillStyle = "#050606";
  ctx.fillRect(0, 0, W, H);

  const beat = beatNear(input.timeline, t);
  if (!beat) return;

  // The STAGE: which photograph this beat plays on. Measurement beats are
  // dealt out across the primary and every landmarked cutaway (stageFor), and
  // from here down the whole grammar of the beat — crop, push-in, matte,
  // measurement — runs on the stage photograph with the stage's own
  // landmarks. The card, curve and closing beats always play on the primary.
  const stage = stageFor(input, beat);
  const basePhoto = (stage?.image ?? photo) as HTMLCanvasElement;
  const baseLandmarks = stage?.landmarks ?? landmarks;
  const beatIndex = input.timeline.beats.indexOf(beat);
  const nextBeat = input.timeline.beats[beatIndex + 1];
  const stageHolds = Boolean(nextBeat && stageFor(input, nextBeat) !== stage);
  const dip = stageDip(input, beat, t);

  // The photograph is the frame. Full bleed rather than a card, because the
  // subject of a rundown is the face and every pixel spent on chrome is a pixel
  // not spent on the thing being measured.
  //
  // The push-in uses raw beat-local time, not an eased curve: a drift that
  // eases in and out of every beat reads as the camera breathing. It RELEASES
  // over the same window cropAt uses to travel to the next region, so the
  // frame arrives at the boundary exactly where the next beat begins — without
  // the release, the push would reset across the cut and every beat would
  // open with a 3.5% jump.
  const local = clamp01((t - beat.start) / Math.max(0.001, beat.duration));
  const release = smoother(clamp01((beat.start + beat.duration - t) / 0.55));
  const crop = pushInCrop(
    cropAt(
      basePhoto,
      baseLandmarks,
      input.timeline,
      t,
      W / H,
      input.metrics,
      input.cut === "short",
      stageHolds,
    ),
    basePhoto,
    local * release,
  );
  const kind = beat.beat.kind;

  // A cutaway, when this beat draws no measurement and there is one to show.
  //
  // Keyed off the beat's index rather than a clock, so the same rundown always
  // cuts to the same photograph at the same moment — a video that shuffled its
  // own B-roll between two renders of one scan would be a different video every
  // time it was exported.
  // The disclaimer's own clip wins over the cutaway pool on the beat it was
  // attached for: it was chosen to match that sentence, and a still shuffled in
  // from the general pool would be the operator's work thrown away.
  const isDisclaimer = beat.beat.kind === "context" && beat.beat.line === input.disclaimerLine;
  const cutaway =
    (isDisclaimer && input.disclaimerClip ? { image: input.disclaimerClip } : null) ??
    brollFor(input, beat, t);
  if (cutaway) {
    // Cover, not the crop maths — the crop is derived from the MEASURED
    // photograph's face box and means nothing here. Rises out of the frame's
    // own black over CUT_DIP rather than popping in whole — see cutawayAlpha.
    const dip = cutawayAlpha(beat, t);
    ctx.save();
    ctx.globalAlpha = dip;
    // Short cut: the shot ARRIVES rather than fades — it slides the last few
    // percent of a frame-width in, direction alternating per beat so the cuts
    // do not all move the same way, with a brief brightness flash on top. The
    // whoosh cue the exporter stamps is the sound of this move.
    if (input.cut === "short") {
      const settle = smoother(dip);
      const dir = Math.round(beat.start * 7) % 2 === 0 ? 1 : -1;
      ctx.translate((1 - settle) * W * 0.08 * dir, 0);
    }
    const fit = coverDraw(ctx, cutaway.image, W, H);
    ctx.restore();
    if (input.cut === "short" && dip < 1) {
      ctx.save();
      ctx.globalAlpha = (1 - dip) * 0.2;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    // The same measurement, drawn where it actually is on THIS face.
    //
    // Without this a cutaway is a gap in the analysis: the video stops
    // measuring for a third of every beat and just shows a picture. With it the
    // line follows the sentence onto the next shot, which is what makes cutting
    // away feel like continued analysis rather than an interruption.
    const id = beat.beat.metricId;
    const metric = id ? input.metrics.get(id) : undefined;
    if (cutaway.landmarks && metric && overlayAlpha(beat, t) > 0.004) {
      const iw = (cutaway.image as HTMLImageElement).width || W;
      const ih = (cutaway.image as HTMLImageElement).height || H;
      drawMeasurement(overlayCanvas, cutaway.landmarks, iw, ih, metric, 1, { weight: VIDEO_LINE_WEIGHT });
      ctx.save();
      // The line rides the same dip as its photograph: a measurement at full
      // strength over an image still rising out of black is two layers
      // disagreeing about when the cut happened.
      ctx.globalAlpha = 0.92 * overlayAlpha(beat, t) * dip;
      ctx.drawImage(overlayCanvas, 0, 0, iw, ih, fit.x, fit.y, fit.w, fit.h);
      ctx.restore();
    }
  } else if (kind === "card") {
    // The face moves to the top and the breakdown arrives under it.
    //
    // Not a cut: the crop the previous beat left off on eases up into the band
    // over the first third of this one, so the photograph appears to travel
    // rather than to be replaced. A hard cut here loses the connection between
    // the face just measured and the numbers now being read off it, which is
    // the one thing the card is for.
    // Settled against the FIRST card beat, not this one — the card is one
    // continuous state narrated over two sentences, so the entrance belongs
    // to the state, not to the sentence.
    //
    // The entrance itself is a FLASH-SWIPE, not a squish. The previous move
    // eased the full-bleed photograph up into the top band, which meant a
    // second of the face visibly compressing — watched back it read as the
    // frame buckling rather than as a cut. The verdict deserves an arrival:
    // a hard cut to the card composition, the photo band sliding down into
    // place from a few percent above, under a brief white flash that reads
    // as the camera's shutter. Same grammar as the short cut's cutaways.
    const settle = cardSettle(input, beat, t);
    const boxH = H * CARD_PHOTO;
    const target = regionCrop(photo, landmarks, "proportions", W / boxH);
    const slide = (1 - settle) * -boxH * 0.22;
    ctx.drawImage(photo, target.x, target.y, target.w, target.h, 0, slide, W, boxH);
    // The photograph fades into the card rather than ending on a hard edge.
    const fade = ctx.createLinearGradient(0, boxH * 0.55, 0, boxH);
    fade.addColorStop(0, "rgba(5,6,6,0)");
    fade.addColorStop(1, "#050606");
    ctx.fillStyle = fade;
    ctx.fillRect(0, boxH * 0.55, W, boxH * 0.45 + 2);
    // The flash is far faster than the settle: a shutter is over in a quarter
    // second, while the band is still easing into place behind it.
    const firstCard = input.timeline.beats.find((b) => b.beat.kind === "card") ?? beat;
    const flash = 1 - clamp01((t - firstCard.start) / 0.28);
    if (flash > 0) {
      ctx.save();
      ctx.globalAlpha = flash * 0.4;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  } else if (input.cut === "short" && kind === "metric") {
    // Through the stage dip: a change of photograph rises out of the frame's
    // own black exactly the way a cutaway does, so the two cut grammars match.
    ctx.save();
    ctx.globalAlpha = dip;
    drawMattedPhoto(ctx, basePhoto, baseLandmarks, crop, W, H);
    ctx.restore();
  } else {
    ctx.save();
    ctx.globalAlpha = dip;
    ctx.drawImage(basePhoto, crop.x, crop.y, crop.w, crop.h, 0, 0, W, H);
    ctx.restore();
  }

  // Everything except the measurement goes dark. A uniform scrim rather than a
  // shaped mask: masking around the active region means computing a region
  // outline, and a slightly wrong outline draws attention to itself far more
  // than an even dim does.
  // Lighter over a cutaway. The scrim exists to make ONE measurement stand out
  // of a photograph; a cutaway has no measurement to stand out of, so the same
  // dimming just produces a dull frame at the exact moment the video is meant
  // to feel like it has more than one shot in it. Enough is kept at the top and
  // bottom to hold the caption and the bar, which carry their own shadows.
  const scrim = ctx.createLinearGradient(0, 0, 0, H);
  const matted = input.cut === "short" && kind === "metric" && !cutaway;
  if (matted) {
    // The ground is already dark on a matted frame — the scrim's only
    // remaining job is holding the caption and the bar, so it keeps the top
    // and bottom bands and stays out of the face.
    scrim.addColorStop(0, "rgba(3,5,5,.40)");
    scrim.addColorStop(0.34, "rgba(3,5,5,.02)");
    scrim.addColorStop(0.68, "rgba(3,5,5,.10)");
    scrim.addColorStop(1, "rgba(3,5,5,.72)");
  } else if (cutaway) {
    scrim.addColorStop(0, "rgba(3,5,5,.46)");
    scrim.addColorStop(0.34, "rgba(3,5,5,.06)");
    scrim.addColorStop(0.68, "rgba(3,5,5,.20)");
    scrim.addColorStop(1, "rgba(3,5,5,.78)");
  } else {
    scrim.addColorStop(0, "rgba(3,5,5,.72)");
    scrim.addColorStop(0.34, "rgba(3,5,5,.34)");
    scrim.addColorStop(0.68, "rgba(3,5,5,.42)");
    scrim.addColorStop(1, "rgba(3,5,5,.92)");
  }
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, W, H);

  // The curve and the search bar pop in FRONT of the face, so the face goes
  // most of the way down. Not all the way to black: keeping the photograph
  // faintly there is what makes the curve read as "this man, against everyone"
  // rather than as a chart that arrived from somewhere else.
  if (kind === "curve") {
    // The curve pops in FRONT of the face. Not all the way to black: keeping
    // the photograph faintly there is what makes the curve read as "this man,
    // against everyone" rather than as a chart that arrived from somewhere else.
    ctx.fillStyle = "rgba(5,6,6,0.90)";
    ctx.fillRect(0, 0, W, H);
  } else if (kind === "search") {
    // The search bar goes to BLACK, with nothing behind it.
    //
    // At 0.82 the photograph was still legible as a shape, and a head-shaped
    // smudge behind a search box is neither a portrait nor a clean end card —
    // it just looks like something failed to clear. This frame is the only one
    // that is not about the subject at all: it is an instruction, and an
    // instruction wants no competition.
    ctx.fillStyle = "#050606";
    ctx.fillRect(0, 0, W, H);
  }

  // Never over a cutaway — see overlayVisible, which owns that rule so it is
  // not a branch here that a later refactor can quietly drop. On a staged
  // beat the overlay is drawn from the STAGE's landmarks through the stage's
  // own crop, so the line sits on the face that is actually on screen; the
  // value inside it is still the measured photograph's, stated once.
  if (overlayVisible(input, beat, t)) {
    drawOverlayForBeat(ctx, basePhoto, baseLandmarks, input, beat, t, crop, W, H, overlayCanvas);
  }
  // The two closing beats take over the frame rather than sitting beside the
  // face. Both are arguments about the viewer rather than about the subject —
  // where he lands against everyone, and what to do about it — and neither
  // reads while a face is still competing for the eye.
  if (beat.beat.kind === "card") drawCard(ctx, input, beat, t, W, H);
  if (beat.beat.kind === "curve") drawCurve(ctx, input, beat, t, W, H, input.name);
  if (beat.beat.kind === "search") drawSearchBar(ctx, beat, t, W, H);
  // The sign-off owns its frame too. The voice is saying "go get yours at
  // truemax.app" and the picture used to still be the SUBJECT's face — the
  // one moment in the video that is about the viewer was illustrated with
  // somebody else. The shared endcard takes over on the beat, and the spoken
  // line lands in the caption over it like every other line.
  if (beat.beat.kind === "cta") drawCtaCard(ctx, W, H, t - beat.start, 0.6);
  // The caption is drawn on every beat including the card. It collided with the
  // region rows the first time round; the card is compressed now — a shorter
  // photo band, a tighter row pitch — specifically so both fit.
  drawLedger(ctx, input, beat, t);
  drawVisualCue(ctx, beat, t, W, H);
  // No chrome over the endcard. The bottom bar prints the SUBJECT'S name and
  // the watermark prints the URL — and the sign-off is the one beat that is
  // about the viewer, on a card that already carries the wordmark and the URL
  // at full size. Chrome here is the same information three times, one of
  // them wrong.
  if (beat.beat.kind !== "cta") {
    drawBottomBar(ctx, input, beat, W, H);
    drawWatermark(ctx, H);
  }
  // Last, over everything: the whole frame resolves, chrome included, the way
  // a stream sharpens after a seek. Blurring only the photograph would leave
  // razor-sharp text floating on an out-of-focus face, which reads as a
  // rendering bug rather than an opening.
  drawOpeningResolve(ctx, t, W, H);
}

// Which beats a cutaway may cover, and which photograph it gets.
//
// The rule is one line long and it is the whole safety argument: a beat that
// DRAWS a measurement must show the photograph that measurement was taken from.
// Everything else — the hook, the operator's context and disclaimer, the
// sign-off — draws no geometry and can show anything.
//
// The card, the curve and the search bar are excluded too, but for a different
// reason: they are compositions that own the whole frame, and a photograph
// behind them is the head-shaped smudge the search beat was just fixed to stop
// having.
//
// The photograph is chosen by the beat's INDEX in the timeline, not by a clock
// or a counter, so one scan always produces the same cut at the same moment. A
// rundown that shuffled its own B-roll between two exports of one face would be
// a different video every time, and the reason the whole module is pure is that
// it must not be.
export function brollFor(
  input: RundownInput,
  beat: TimedBeat,
  t: number,
): { image: CanvasImageSource; landmarks?: NormalizedLandmark[] } | null {
  const pool = input.broll;
  if (!pool?.length) return null;
  const kind = beat.beat.kind;
  const index = input.timeline.beats.indexOf(beat);
  if (index < 0) return null;

  // The card, the curve, the search bar and the sign-off own their whole frame
  // and never take one — a photograph behind a chart is the head-shaped smudge
  // the search beat was fixed to stop having, and a cutaway rising behind the
  // endcard would put a face back into the one beat that is not about a face.
  if (kind === "card" || kind === "curve" || kind === "search" || kind === "cta") return null;

  // A beat that draws nothing can take a cutaway for its whole length.
  if (kind !== "metric") return pool[index % pool.length] ?? null;

  // Measurement beats belong to the STAGE system now — see stageFor. When any
  // attached photograph carries its own landmarks, whole beats move onto it
  // with the full analysis, and the old tail-flash cutaway would be a third
  // cut fighting that structure. It survives only for the case the stages
  // cannot serve: a pool where no photograph found a face, which can still
  // interrupt the tail of a beat exactly as before.
  if (stagePool(input).length) return null;

  // The measurement cannot be drawn over a faceless cutaway — the overlay
  // lives in landmark space and there are no landmarks to give it. So the
  // beat is split: the line lands at DRAW_AT, holds on the measured
  // photograph through the middle of the sentence, and the last third cuts
  // away while the sentence finishes.
  const local = (t - beat.start) / Math.max(0.001, beat.duration);
  if (local < 1 - CUTAWAY_TAIL) return null;
  return pool[index % pool.length] ?? null;
}

// ---------------------------------------------------------------------------
// PHOTO-FIRST staging.
//
// The cutaway system above treats extra photographs as decoration: the
// analysis lives on one photograph and the others flash by in beat tails,
// which — watched back — reads as the video showing you a picture and doing
// nothing with it. The stage system inverts that. Every attached photograph
// with a face becomes a full member of the analysis: measurement beats are
// dealt out in PAIRS across the primary photograph and every landmarked
// cutaway in turn, and the beat's whole grammar — the crop, the push-in, the
// measurement line, the retraction — runs on whichever photograph holds the
// stage, positioned by that photograph's own landmarks.
//
// The VALUE never moves: one face, one set of figures, measured once on the
// controlled photograph and stated identically wherever the line is drawn.
// The line on another photo of the same person is the same annotation licence
// the cutaway system already took, extended from a flash to a full beat.
//
// Deterministic by metric index, so one scan always renders one video.
// ---------------------------------------------------------------------------

/** How many consecutive measurement beats each photograph holds. */
export const STAGE_BEATS_PER_PHOTO = 2;

type Stage = { image: CanvasImageSource; landmarks: NormalizedLandmark[] };

/** The photographs able to hold a full analysis beat: face found, line drawable. */
export function stagePool(input: RundownInput): Stage[] {
  return (input.broll ?? []).filter((b): b is Stage => Boolean(b.landmarks?.length));
}

/**
 * Which stage a beat plays on: 0 is the primary photograph, n>0 is pool[n-1].
 * Non-metric beats always play on the primary.
 */
function stageIndexOf(input: RundownInput, beat: TimedBeat): number {
  if (beat.beat.kind !== "metric") return 0;
  const pool = stagePool(input);
  if (!pool.length) return 0;
  let mi = 0;
  for (const b of input.timeline.beats) {
    if (b === beat) break;
    if (b.beat.kind === "metric") mi++;
  }
  return Math.floor(mi / STAGE_BEATS_PER_PHOTO) % (pool.length + 1);
}

/** The stage photograph for this beat, or null for the primary. */
export function stageFor(input: RundownInput, beat: TimedBeat): Stage | null {
  const index = stageIndexOf(input, beat);
  return index === 0 ? null : (stagePool(input)[index - 1] ?? null);
}

/** Whether this beat opens on a different photograph than the one before it. */
export function stageChanged(input: RundownInput, beat: TimedBeat): boolean {
  const index = input.timeline.beats.indexOf(beat);
  if (index <= 0) return stageIndexOf(input, beat) !== 0;
  return stageIndexOf(input, beat) !== stageIndexOf(input, input.timeline.beats[index - 1]);
}

/**
 * The dip that carries a stage change: the outgoing photograph falls to the
 * frame's own near-black over CUT_DIP and the incoming one rises out of it —
 * the same edit grammar the cutaways use, so the two systems cut alike.
 * 1 anywhere away from a boundary between different stages.
 */
function stageDip(input: RundownInput, beat: TimedBeat, t: number): number {
  if (!stagePool(input).length) return 1;
  const index = input.timeline.beats.indexOf(beat);
  const here = stageIndexOf(input, beat);
  const prev = index > 0 ? stageIndexOf(input, input.timeline.beats[index - 1]) : here;
  const next =
    index >= 0 && index < input.timeline.beats.length - 1
      ? stageIndexOf(input, input.timeline.beats[index + 1])
      : here;
  let a = 1;
  if (here !== prev) a = Math.min(a, smoother(clamp01((t - beat.start) / CUT_DIP)));
  if (here !== next) {
    a = Math.min(a, smoother(clamp01((beat.start + beat.duration - t) / CUT_DIP)));
  }
  return a;
}

/**
 * Whether the measurement overlay is on screen at this instant.
 *
 * A named predicate rather than an `if` at the call site, because it carries
 * the one invariant this whole feature rests on — the overlay and a cutaway are
 * never both drawn — and an invariant living in a single branch inside a 200
 * line compositor is an invariant one refactor away from being gone. The
 * renderer asks this, and so does the test that sweeps every frame of every
 * beat looking for the pair being live at once.
 */
export function overlayVisible(input: RundownInput, beat: TimedBeat, t: number): boolean {
  if (!beat.beat.metricId) return false;
  if (brollFor(input, beat, t)) return false;
  return overlayAlpha(beat, t) > 0.004;
}

// How much of a measurement beat's tail a cutaway may take. A third leaves the
// line on screen for the majority of the sentence that describes it, which is
// the ordering that makes it evidence rather than illustration.
export const CUTAWAY_TAIL = 0.34;

// Cover-fit, centred. No crop maths and no face box: there are no landmarks for
// a cutaway, and inventing a bounding box for one is precisely the guess this
// feature exists to avoid making.
function coverDraw(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  W: number,
  H: number,
): { x: number; y: number; w: number; h: number } {
  const iw =
    (image as HTMLVideoElement).videoWidth || (image as HTMLImageElement).width || W;
  const ih =
    (image as HTMLVideoElement).videoHeight || (image as HTMLImageElement).height || H;
  const scale = Math.max(W / iw, H / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const x = (W - dw) / 2;
  const y = (H - dh) / 2;
  ctx.drawImage(image, x, y, dw, dh);
  // Returned so an overlay for this photograph is composited through the very
  // same rectangle. Two independent fits of one image is how a line ends up
  // near a feature instead of on it.
  return { x, y, w: dw, h: dh };
}

// How far through its own animation a full-frame beat is, 0..1, with a little
// air at the end so the finished picture is held rather than cut on.
function beatProgress(beat: TimedBeat, t: number): number {
  return clamp01((t - beat.start) / Math.max(0.001, beat.duration * 0.62));
}

/**
 * The largest font size at which `text` fits `maxWidth`, as a ready font string.
 *
 * Canvas has no shrink-to-fit, so every fixed font size in this renderer is a
 * bet that the longest string it will ever be handed is the one that was on
 * screen when the number was chosen. That bet loses quietly: the text does not
 * wrap or error, it just draws past the edge of the frame and the ends are gone.
 *
 * Steps down a point at a time rather than solving for the scale, because
 * measureText is not exactly linear in the font size — kerning and hinting move
 * — and a computed size can still overflow by a pixel or two. Twenty-odd
 * measureText calls on one short string, once per frame, is nothing.
 */
export function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  max: number,
  min: number,
  font: (px: number) => string,
): string {
  for (let px = Math.round(max); px > min; px--) {
    ctx.font = font(px);
    if (ctx.measureText(text).width <= maxWidth) return font(px);
  }
  return font(min);
}

// How much of the frame the photograph keeps once the card is up.
const CARD_PHOTO = 0.3;

// Row pitch on the card. Eight regions have to finish above the caption, which
// itself has to finish above the safe area, and at the old 46px they ran 120px
// past it.
const CARD_ROW = 40;

/**
 * How far the card has settled at time t, 0..1.
 *
 * Keyed to the FIRST card beat rather than the current one, because there are
 * two — the verdict and the ceiling — and each running its own entrance meant
 * the same move played twice with a cut back to full screen in between. The card
 * is one state narrated over two sentences, so the move belongs to the state.
 *
 * Shared by the photograph's travel and the card's own fade so the two cannot
 * drift apart: the card used to draw at full opacity from its first frame, on
 * top of a photograph still on its way up, which is a page of white text over a
 * face for a third of a second.
 */
function cardSettle(input: RundownInput, beat: TimedBeat, t: number): number {
  const first = input.timeline.beats.find((b) => b.beat.kind === "card") ?? beat;
  return smoother(clamp01((t - first.start) / Math.max(0.001, first.duration * 0.45)));
}

// ---------------------------------------------------------------------------
// The scorecard: the face at the top, everything measured underneath it.
//
// The rundown spent a minute making a case one measurement at a time and then
// delivered the conclusion as a sentence over a close-up of a cheekbone. The
// card is where the case is added up, and it is also the frame that gets
// screenshotted — which is the only distribution mechanism in this format that
// costs nothing.
//
// Every number on it was already said out loud somewhere in the video. It is a
// summary, not new information, and that is deliberate: a card that introduces
// a figure the voice never mentioned invites the viewer to wonder what else was
// left out.
// ---------------------------------------------------------------------------
function drawCard(
  ctx: CanvasRenderingContext2D,
  input: RundownInput,
  beat: TimedBeat,
  t: number,
  W: number,
  H: number,
): void {
  const card = beat.beat.card;
  if (!card) return;

  const top = H * CARD_PHOTO;
  ctx.save();
  ctx.textAlign = "center";

  // The card arrives WITH the photograph, not before it.
  //
  // It was drawn at full opacity from its first frame, which put a page of
  // white text across a face that was still on its way up to the top of the
  // frame. That is the transition that looked wrong: not the move, but the two
  // halves of it disagreeing about when the move had happened. Fading on the
  // same curve costs one multiply and makes the card look like it is being
  // revealed by the photograph moving rather than dropped on top of it.
  //
  // Held back a little further than the photograph — text arriving under a
  // frame that has already stopped moving reads as settled; text arriving into
  // a moving frame reads as a mistake.
  const settle = cardSettle(input, beat, t);
  ctx.globalAlpha = clamp01((settle - 0.55) / 0.4);

  // The figures count up rather than appear. Keyed to the same first-card-beat
  // clock as the settle, so a re-render of the same scan counts the same way —
  // and starting only after the card is fully readable, because a number
  // changing while its card is still fading in is two animations fighting.
  const firstCard = input.timeline.beats.find((b) => b.beat.kind === "card") ?? beat;
  const sinceCard = t - firstCard.start;
  const countUp = 1 - (1 - clamp01((sinceCard - 0.55) / 0.85)) ** 3;

  // The verdict, big, because it is the conclusion and a name is what gets
  // quoted in a comment section.
  //
  // SHRUNK TO FIT, because the ladder holds strings of wildly different lengths
  // and the font size was fixed. "Mid" is three characters and "Looksmaxxing
  // final boss" is twenty-two; at a flat 76px the second one ran off both edges
  // of a 720-wide frame and shipped as "ooksmaxxing final bos". A conclusion
  // that is missing its first and last letter is not a conclusion.
  //
  // Shrinking rather than wrapping: the verdict is one phrase and one line, and
  // a two-line verdict pushes the stats row into the region rows underneath it.
  // Down to 44px, which still reads on a phone at arm's length — and if a rung
  // is ever added that will not fit even there, the clamp keeps it inside the
  // frame rather than letting it bleed.
  ctx.fillStyle = "#f7f7f2";
  ctx.font = fitFont(ctx, card.verdict, W - SAFE_LEFT * 2, 76, 44, (px) => `300 ${px}px Fraunces, Georgia, serif`);
  ctx.fillText(card.verdict, W / 2, top + 74);

  // The three figures, in a row. Score first because it is the one they came
  // for; ceiling next because it is the one that sells a subscription; rarity
  // last because it is the one nobody else in this niche can actually compute.
  // The two scores count from zero; the rarity holds still. Counting a
  // "top X%" upward reads as the rank getting worse in front of the viewer,
  // which is the wrong feeling for the frame that gets screenshotted.
  const stats: Array<[string, string]> = [
    ["SCORE", (card.overall * countUp).toFixed(1)],
    ["CEILING", (card.potential * countUp).toFixed(1)],
    ["TOP", `${Math.max(1, Math.round(100 - card.percentile))}%`],
  ];
  const statW = W / 3;
  stats.forEach(([label, value], i) => {
    const cx = statW * i + statW / 2;
    ctx.font = "500 14px Inter, Arial, sans-serif";
    ctx.letterSpacing = "3px";
    ctx.fillStyle = "#7f8682";
    ctx.fillText(label, cx, top + 122);
    ctx.font = "300 56px Fraunces, Georgia, serif";
    ctx.letterSpacing = "0px";
    ctx.fillStyle = "#f7f7f2";
    ctx.fillText(value, cx, top + 178);
  });

  // The regions, top of the face to the bottom — the same order the video just
  // walked in, so the card reads as a recap rather than as a second opinion.
  //
  // TWO COLUMNS, because one did not fit and the overflow was being dropped.
  // The loop broke as soon as a row would have reached the caption, and with
  // eight regions at a 40px pitch that happened on the fifth: the card called
  // itself the full breakdown and showed the top half of the face. Nothing
  // errored — the rows simply stopped, in the order they were listed, so it was
  // always the jaw and the chin that vanished.
  //
  // Down the left column first and then down the right, rather than left-right
  // in pairs. The regions are in face order and reading them in face order is
  // the point; a viewer scanning for the jaw looks down a column, not across.
  const rowsTop = top + 232;
  const cols = 2;
  const perCol = Math.ceil(card.rows.length / cols);
  const gutter = 24;
  const colW = (W - SAFE_LEFT * 2 - gutter) / cols;
  ctx.textAlign = "left";
  card.rows.forEach((row, i) => {
    const col = Math.floor(i / perCol);
    const y = rowsTop + (i % perCol) * CARD_ROW;
    // Still guarded. Two columns is enough for the eight regions this engine
    // has; a ninth would silently start a third column that has nowhere to go,
    // and dropping it is better than drawing it over the caption.
    if (col >= cols || y > H - SAFE_BOTTOM - 130) return;
    const x0 = SAFE_LEFT + col * (colW + gutter);
    const x1 = x0 + colW;

    ctx.font = "500 21px Inter, Arial, sans-serif";
    ctx.fillStyle = "#c9d1cd";
    ctx.fillText(row.label, x0, y);

    // A bar as well as a number. The number is the fact; the bar is what makes
    // one region visibly the weak one at a glance, which is the thing a viewer
    // screenshots to argue about.
    const barX = x0 + 128;
    const barW = x1 - barX - 46;
    ctx.fillStyle = "rgba(247,247,242,0.12)";
    ctx.fillRect(barX, y - 13, barW, 7);
    // Each bar sweeps to its value on the count-up clock, staggered a beat
    // per row down the column — the same top-of-face-first order the video
    // just walked, so the card animates the way it reads.
    const sweep = 1 - (1 - clamp01((sinceCard - 0.55 - i * 0.07) / 0.5)) ** 3;
    ctx.fillStyle = row.score >= 6.5 ? "#8ff3e0" : row.score <= 4.5 ? "#e8a17a" : "#f7f7f2";
    ctx.fillRect(barX, y - 13, barW * clamp01(row.score / 10) * sweep, 7);

    ctx.textAlign = "right";
    ctx.fillStyle = "#f7f7f2";
    ctx.fillText(row.score.toFixed(1), x1, y);
    ctx.textAlign = "left";
  });
  ctx.restore();
}

// ---------------------------------------------------------------------------
// The distribution, with the crowd shaded and one marker standing outside it.
//
// The single most persuasive frame available to this format, and it was being
// delivered as narration over a photograph. "Two thirds of men measure between
// 4.1 and 6.3" asks a viewer to hold two numbers and compare them to a third
// they heard ten seconds ago. The same fact drawn — a hump, a shaded middle,
// and a line out on the right-hand tail — is understood before it is read.
//
// A normal curve rather than the empirical one. The engine's own aggregate is
// normalised through a quantile table, so the population IS approximately
// gaussian in this space by construction, and drawing the sample's lumps would
// be drawing 52 people's noise as if it were structure.
// ---------------------------------------------------------------------------
function drawCurve(
  ctx: CanvasRenderingContext2D,
  input: RundownInput,
  beat: TimedBeat,
  t: number,
  W: number,
  H: number,
  name: string,
): void {
  // Keyed to the FIRST curve beat, exactly as cardSettle is keyed to the
  // first card beat and for the same reason: there are two curve beats — the
  // badge and the crowd — and each ran its own entrance, so the same curve
  // visibly drew itself twice in a row. It is one state narrated over two
  // sentences; the entrance belongs to the state.
  const firstCurve = input.timeline.beats.find((b) => b.beat.kind === "curve") ?? beat;
  const p = beatProgress(firstCurve, t);
  const pct = clamp01((beat.beat.percentile ?? 50) / 100);

  const left = W * 0.12;
  const right = W * 0.88;
  const span = right - left;
  const baseline = H * 0.52;
  // Clear of the top zone, where TikTok puts the search and the tabs. At 0.2 the
  // peak sat at 256 and was already clear, but expressing it against SAFE_TOP
  // means it stays clear if either number moves.
  const peak = Math.max(SAFE_TOP + 40, H * 0.2);

  // z for a percentile, by the Beasley-Springer-Moro-ish rational approximation
  // that precision.ts already trusts elsewhere. Only used for placement, so
  // three decimals of accuracy is far more than the pixels can show.
  const zOf = (q: number): number => {
    const a = clamp01(Math.min(0.9995, Math.max(0.0005, q)));
    const s = a < 0.5 ? -1 : 1;
    const r = Math.sqrt(-2 * Math.log(a < 0.5 ? a : 1 - a));
    return (
      s * (r - (2.30753 + 0.27061 * r) / (1 + (0.99229 + 0.04481 * r) * r))
    );
  };

  const Z_EDGE = 3; // the axis runs -3σ..+3σ, which is the whole population
  const xOf = (z: number) => left + ((z + Z_EDGE) / (2 * Z_EDGE)) * span;
  const yOf = (z: number) => baseline - Math.exp(-(z * z) / 2) * (baseline - peak);

  ctx.save();

  // The fill is a RARITY scale, left to right, and it is the whole point of
  // colouring it at all.
  //
  // Green through the common low end, orange across the bulk where most men
  // actually are, red out on the right tail where almost nobody is. It is a
  // heat scale for how UNUSUAL a position is, not a good/bad scale — red is the
  // rare end, which in this niche is the end people want. A viewer reads where
  // the marker falls against the colour before they read a single number, and
  // "he is off in the red" is the sentence the frame is trying to produce.
  //
  // Shading the WHOLE curve rather than only the middle 68%: the old version
  // shaded one sigma and left the tails bare, which drew the eye to the middle
  // — the exact opposite of what a video about somebody exceptional wants. The
  // band is now marked by its edges instead.
  const heat = ctx.createLinearGradient(left, 0, right, 0);
  heat.addColorStop(0.0, "rgba(143,243,224,0.10)");
  heat.addColorStop(0.22, "rgba(143,243,224,0.34)");
  heat.addColorStop(0.5, "rgba(232,161,122,0.40)");
  heat.addColorStop(0.78, "rgba(228,110,84,0.40)");
  heat.addColorStop(1.0, "rgba(228,60,60,0.34)");
  ctx.beginPath();
  ctx.moveTo(xOf(-Z_EDGE), baseline);
  for (let z = -Z_EDGE; z <= Z_EDGE + 0.0001; z += 0.02) ctx.lineTo(xOf(z), yOf(z));
  ctx.lineTo(xOf(Z_EDGE), baseline);
  ctx.closePath();
  ctx.fillStyle = heat;
  ctx.fill();

  // The middle 68%, marked by its EDGES rather than by a fill, so the crowd is
  // legible without the eye being pulled into it.
  ctx.setLineDash([6, 8]);
  ctx.strokeStyle = "rgba(247,247,242,0.34)";
  ctx.lineWidth = 1.5;
  for (const edge of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(xOf(edge), baseline);
    ctx.lineTo(xOf(edge), yOf(edge));
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // The curve itself, drawn left to right over the beat so the frame has
  // something happening in it rather than appearing whole.
  ctx.beginPath();
  const drawnTo = -Z_EDGE + 2 * Z_EDGE * p;
  ctx.moveTo(xOf(-Z_EDGE), yOf(-Z_EDGE));
  for (let z = -Z_EDGE; z <= drawnTo; z += 0.02) ctx.lineTo(xOf(z), yOf(z));
  ctx.strokeStyle = "rgba(247,247,242,0.85)";
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.stroke();

  // Baseline.
  ctx.beginPath();
  ctx.moveTo(left, baseline);
  ctx.lineTo(right, baseline);
  ctx.strokeStyle = "rgba(247,247,242,0.22)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.textAlign = "center";

  // Where the axis sits below the curve's baseline. Named because the headline
  // percentile has to be placed clear of it, and two independent magic numbers
  // are how those two ended up drawn on top of each other.
  const AXIS_TICK_Y = 62;
  const AXIS_UNIT_Y = 84;

  // The scale, along the bottom.
  //
  // A curve with no axis is a shape. The band was labelled "where most men are"
  // and a viewer still had no way to read WHERE on it a marker sat, which is
  // the only question the frame exists to answer. The ticks are the same
  // one-sigma numbers the script says aloud, so the picture and the narration
  // cannot disagree.
  ctx.font = "500 13px Inter, Arial, sans-serif";
  ctx.letterSpacing = "1px";
  ctx.fillStyle = "rgba(247,247,242,0.52)";
  for (const [z, label] of [
    [-1, SPREAD.low.toFixed(1)],
    [0, SPREAD.median.toFixed(1)],
    [1, SPREAD.high.toFixed(1)],
  ] as Array<[number, string]>) {
    ctx.fillText(label, xOf(z), baseline + AXIS_TICK_Y);
  }
  ctx.font = "500 11px Inter, Arial, sans-serif";
  ctx.fillStyle = "rgba(247,247,242,0.34)";
  ctx.fillText("SCORE", W / 2, baseline + AXIS_UNIT_Y);

  // TWO STAGES, and the order is the argument.
  //
  // First his POSITION — the marker and the headline rarity, because a viewer
  // who has just heard a score wants to know what it is worth before they want
  // a lesson in distributions. Then the GENERALISATION: where the crowd sits,
  // which is only interesting once there is a marker to compare it to.
  //
  // The first curve beat is the one carrying a badge; the second has none.
  const showsCrowd = !beat.beat.badge;
  if (showsCrowd) {
    ctx.font = "500 15px Inter, Arial, sans-serif";
    ctx.letterSpacing = "1px";
    ctx.fillStyle = "#e8a17a";
    ctx.fillText("WHERE MOST MEN ARE", (xOf(-1) + xOf(1)) / 2, baseline + 34);
    ctx.font = "500 13px Inter, Arial, sans-serif";
    ctx.fillStyle = "#7f8682";
    ctx.fillText("RARE", xOf(2.25), baseline + 34);
    ctx.fillText("RARE", xOf(-2.25), baseline + 34);
  }

  // The marker, which arrives only once the curve has been drawn past it —
  // otherwise it stands on a line that is not there yet.
  const z = Math.max(-Z_EDGE, Math.min(Z_EDGE, zOf(pct)));
  if (drawnTo >= z) {
    const x = xOf(z);
    ctx.beginPath();
    ctx.moveTo(x, baseline);
    ctx.lineTo(x, yOf(z) - 26);
    ctx.strokeStyle = "#f7f7f2";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, yOf(z) - 26, 7, 0, Math.PI * 2);
    ctx.fillStyle = "#f7f7f2";
    ctx.fill();

    ctx.font = "600 22px Inter, Arial, sans-serif";
    ctx.letterSpacing = "0px";
    ctx.fillStyle = "#f7f7f2";
    // The subject's own name, not "HIM" — which was hardcoded, so every woman
    // measured by this got a masculine pronoun printed on the one frame the
    // whole video builds to. The name is also simply better: it is the person
    // the viewer has been looking at for a minute.
    const label = name.trim().split(/\s+/)[0]?.toUpperCase() || "THIS FACE";
    // Kept inside the frame when the marker is far out on either tail.
    const half = ctx.measureText(label).width / 2 + 12;
    const lx = Math.max(left + half, Math.min(right - half, x));
    ctx.fillText(label, lx, yOf(z) - 44);

    // His standing, printed big under the curve, on the first beat only. This
    // is the number the whole video has been earning and it was only spoken.
    //
    // AFTER the name, not before: setting up this block's own 14px grey style
    // first left it in place for the name, which came out as a dim caption
    // instead of a label on a marker.
    if (!showsCrowd) {
      const top = Math.max(1, Math.round(100 - (beat.beat.percentile ?? 50)));
      ctx.font = "300 64px Fraunces, Georgia, serif";
      ctx.letterSpacing = "0px";
      ctx.fillStyle = "#f7f7f2";
      // Below the axis, not through it.
      //
      // This sat at baseline + 96. Sixty-four point Fraunces has a cap height
      // around 46px, so the glyphs reached back to roughly baseline + 50 and
      // were drawn straight over the scale numbers at +62 and the word SCORE at
      // +84 — the axis was legible in every frame except the one frame the
      // headline appears in, which is the frame people screenshot.
      //
      // Expressed against the axis it has to clear rather than as a new magic
      // number, so moving the scale moves this with it.
      const clearsAxis = AXIS_UNIT_Y + 12 + 46;
      ctx.fillText(`TOP ${top}%`, W / 2, baseline + clearsAxis);
      ctx.font = "500 14px Inter, Arial, sans-serif";
      ctx.letterSpacing = "3px";
      ctx.fillStyle = "#7f8682";
      ctx.fillText("OF THE REFERENCE SET", W / 2, baseline + clearsAxis + 34);
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// The address, typed into a search bar.
//
// A URL read aloud is a URL nobody types. A search bar with a cursor blinking
// after "truemax.app" is an instruction the viewer's hands already know how to
// follow, and it costs one beat at the point in the video where they have just
// been given a reason to want their own.
// ---------------------------------------------------------------------------
function drawSearchBar(
  ctx: CanvasRenderingContext2D,
  beat: TimedBeat,
  t: number,
  W: number,
  H: number,
): void {
  const p = beatProgress(beat, t);
  const URL = "www.truemax.app";

  const w = W * 0.78;
  const h = 92;
  const x = (W - w) / 2;
  const y = H * 0.42;
  const r = h / 2;

  ctx.save();

  // The bar pops in over the first fifth of the beat, then holds while the
  // address types. Two things animating at once reads as a loading screen.
  const pop = clamp01(p / 0.2);
  const scale = 0.86 + 0.14 * smoother(pop);
  ctx.translate(x + w / 2, y + h / 2);
  ctx.scale(scale, scale);
  ctx.translate(-(x + w / 2), -(y + h / 2));
  ctx.globalAlpha = pop;

  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + r, r, Math.PI / 2, -Math.PI / 2);
  ctx.closePath();
  ctx.fillStyle = "rgba(247,247,242,0.96)";
  ctx.fill();

  // The magnifier.
  const gx = x + 46;
  const gy = y + h / 2;
  ctx.beginPath();
  ctx.arc(gx, gy - 3, 12, 0, Math.PI * 2);
  ctx.strokeStyle = "#3d4744";
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(gx + 9, gy + 6);
  ctx.lineTo(gx + 18, gy + 15);
  ctx.stroke();

  // The address, one character at a time over the rest of the beat.
  const typed = URL.slice(0, Math.round(URL.length * clamp01((p - 0.2) / 0.7)));
  ctx.textAlign = "left";
  ctx.font = "500 40px Inter, Arial, sans-serif";
  ctx.letterSpacing = "0px";
  ctx.fillStyle = "#121614";
  ctx.fillText(typed, x + 84, y + h / 2 + 14);

  // A cursor that blinks only once the typing has stopped. Blinking while text
  // is still arriving reads as a glitch rather than as a caret.
  if (typed.length === URL.length && Math.floor(t * 2) % 2 === 0) {
    const cx = x + 84 + ctx.measureText(typed).width + 4;
    ctx.fillRect(cx, y + h / 2 - 22, 3, 40);
  }

  // The wordmark under the bar, arriving once the address has finished typing.
  //
  // The frame is black and holds exactly one instruction, so there is room for
  // the brand to be stated properly rather than as the 16px watermark it wears
  // everywhere else. It comes in AFTER the typing so the eye follows the
  // address first and lands on the name second, which is the order the two
  // things matter in.
  const brand = clamp01((p - 0.86) / 0.14);
  if (brand > 0) {
    ctx.globalAlpha = brand;
    ctx.textAlign = "center";
    ctx.font = "500 34px Inter, Arial, sans-serif";
    ctx.letterSpacing = "6px";
    const my = y + h + 96;
    ctx.fillStyle = "#f7f7f2";
    ctx.fillText("TRUE", W / 2 - ctx.measureText("MAX").width / 2, my);
    ctx.fillStyle = "#8ff3e0";
    ctx.fillText("MAX", W / 2 + ctx.measureText("TRUE").width / 2, my);
    ctx.font = "500 13px Inter, Arial, sans-serif";
    ctx.letterSpacing = "3px";
    ctx.fillStyle = "#7f8682";
    ctx.fillText("MEASURED, NOT GUESSED", W / 2, my + 38);
  }
  ctx.restore();
}

function drawOverlayForBeat(
  ctx: CanvasRenderingContext2D,
  photo: HTMLCanvasElement,
  landmarks: NormalizedLandmark[],
  input: RundownInput,
  beat: TimedBeat,
  t: number,
  crop: Crop,
  W: number,
  H: number,
  overlayCanvas: HTMLCanvasElement,
): void {
  const id = beat.beat.metricId;
  if (!id) return;
  const metric = input.metrics.get(id);
  if (!metric) return;
  const snappy = input.cut === "short";
  const progress = drawProgress(beat, t, snappy);
  if (progress <= 0) return;

  // Drawn at the photograph's own resolution in normalized landmark space, then
  // composited through the SAME crop rectangle as the photograph. That is what
  // guarantees the line sits on the feature: both are the same projection of the
  // same coordinates, so there is no second transform to get wrong.
  drawMeasurement(overlayCanvas, landmarks, photo.width, photo.height, metric, progress, { weight: VIDEO_LINE_WEIGHT });
  ctx.save();
  // The line's own draw is a subset of the true figure; the ALPHA is what makes
  // it arrive and leave rather than blink. See overlayAlpha.
  ctx.globalAlpha = overlayAlpha(beat, t, snappy);
  ctx.drawImage(overlayCanvas, crop.x, crop.y, crop.w, crop.h, 0, 0, W, H);
  ctx.restore();

  // The COMPANION line, short cut only: the second measurement of the same
  // feature, arriving late and dim. This is the reference format's trick of
  // giving every clause more than one thing moving — the eye beat draws the
  // tilt AND the aperture, the lips draw the ratio AND the corner tilt — while
  // staying honest: both lines are real measurements of this face, both from
  // the same landmark space, and the primary keeps the number.
  if (snappy) {
    const companionId = COMPANIONS[id];
    const companion = companionId ? input.metrics.get(companionId) : undefined;
    if (companion && Number.isFinite(companion.value) && !companion.implausible) {
      const late = clamp01((progress - 0.45) / 0.55);
      if (late > 0) {
        drawMeasurement(overlayCanvas, landmarks, photo.width, photo.height, companion, late, { weight: VIDEO_LINE_WEIGHT });
        ctx.save();
        ctx.globalAlpha = 0.42 * overlayAlpha(beat, t, snappy);
        ctx.drawImage(overlayCanvas, crop.x, crop.y, crop.w, crop.h, 0, 0, W, H);
        ctx.restore();
      }
    }
  }
}

// Which second measurement rides along on a beat, keyed by the primary. Only
// pairs that measure the SAME visible feature: a companion from another part
// of the face would drag the eye away from the thing being narrated.
const COMPANIONS: Record<string, string> = {
  canthalTilt: "eyeAspectRatio",
  intercanthalEyeWidth: "fifthsEyeRatio",
  lipRatio: "mouthCornerTilt",
  jawCheekRatio: "chinWidthRatio",
  midfaceRatio: "middleLowerBalance",
};

// ---------------------------------------------------------------------------
// The trait ledger: the analysis, accumulating on screen.
//
// The reference rundowns' signature element. As each measurement lands, its
// verdict joins a running list — "+Tall ramus", then "+Tall ramus / +Gonial
// angle", then more — so any single frame shows not just the current line but
// the case built so far. A viewer who arrives mid-video (which on TikTok is
// most of them) sees the score being assembled instead of one disconnected
// fact, and the frame they screenshot carries the whole argument.
//
// Signs follow the metric's own tone: measured strong is a +, measured weak
// is a −, and the middle band is a dot rather than being dropped — a ledger
// that only lists extremes reads as a highlight reel, not an analysis.
// Colours are the same tone palette as the score chip, glow included, so the
// ledger and the number never disagree about whether a trait helped.
// ---------------------------------------------------------------------------
const LEDGER_MAX = 5;
// 27, down from 36 with the type: five entries now span 128px where they
// spanned 180.
const LEDGER_PITCH = 27;
const LEDGER_REVEAL = 0.4;

function ledgerEntries(
  input: RundownInput,
  t: number,
): Array<{ metric: ScoredMetric; reveal: number }> {
  const out: Array<{ metric: ScoredMetric; reveal: number }> = [];
  for (const b of input.timeline.beats) {
    if (b.beat.kind !== "metric" || !b.beat.metricId) continue;
    // A trait joins the ledger a beat after its line starts drawing — the
    // measurement introduces it, the ledger records it.
    const at = b.start + 0.35;
    if (t < at) break;
    const metric = input.metrics.get(b.beat.metricId);
    if (!metric) continue;
    out.push({ metric, reveal: clamp01((t - at) / LEDGER_REVEAL) });
  }
  return out.slice(-LEDGER_MAX);
}

function drawLedger(
  ctx: CanvasRenderingContext2D,
  input: RundownInput,
  beat: TimedBeat,
  t: number,
): void {
  // The closing compositions own their whole frame; the ledger's job is done
  // by the scorecard there anyway. And it ends WITH the analysis: the last
  // metric beat is the last thing it may draw over. It kept running through
  // the sign-off ("Who should we measure next?") in a real export, which put
  // the full trait list over the one frame that is not about the subject.
  const kind = beat.beat.kind;
  if (kind === "card" || kind === "curve" || kind === "search" || kind === "cta") return;
  let lastMetricEnd = -Infinity;
  for (const b of input.timeline.beats) {
    if (b.beat.kind === "metric") lastMetricEnd = b.start + b.duration;
  }
  if (t > lastMetricEnd) return;
  const entries = ledgerEntries(input, t);
  if (!entries.length) return;

  // Anchored just inside the top-left safe corner, stacking down — up and out
  // of the face. It used to end at 42% of the frame height, which put the
  // list straight across the eyes of every portrait.
  // Higher than SAFE_TOP and smaller than it was, deliberately. SAFE_TOP is
  // where TikTok's own chrome ends, and the ledger used to start below it in
  // 27px type — five entries ran to the middle of the forehead and sat over
  // the face on every close-up. At 20px starting 40px into the margin the
  // whole stack ends above the brow line; the top few pixels may brush the
  // chrome on some devices, which is the right trade — the list is context,
  // the face is the video.
  const y0 = SAFE_TOP - 40;
  ctx.save();
  ctx.textAlign = "left";
  ctx.font = "700 20px Inter, Arial, sans-serif";
  const newest = entries[entries.length - 1];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const last = i === entries.length - 1;
    const colour = toneColour(e.metric);
    // Same reading as the colour, so the sign and the ink can never disagree.
    // The old middle band drew a "·" in neutral white; under the band reading
    // there is no middle — a measurement is either inside its tolerance or it
    // is not — so the dot is gone and every entry states a verdict. See
    // toneColour.
    const sign = e.metric.conformance >= 1 ? "+" : "−";
    // The newest entry rises in; the ones before it step back as it arrives,
    // on the newcomer's own clock so the hand-off is one motion.
    const settle = smoother(e.reveal);
    const dim = last ? 1 : lerp(1, 0.5, smoother(newest.reveal));
    ctx.globalAlpha = (last ? settle : dim) * 0.96;
    ctx.shadowColor = colour;
    ctx.shadowBlur = 16;
    ctx.fillStyle = colour;
    const y = y0 + i * LEDGER_PITCH + (last ? (1 - settle) * 12 : 0);
    ctx.fillText(`${sign} ${e.metric.def.name}`, SAFE_LEFT, y);
  }
  ctx.restore();
}

// One short visual conclusion, typed quickly. The narration carries the full
// sentence; the frame keeps the face and its geometry prominent on a phone.
// Closing compositions already contain their own copy, so cues are limited to
// the photo-first beats where they do not duplicate a card, curve or endcard.
function drawVisualCue(
  ctx: CanvasRenderingContext2D,
  beat: TimedBeat,
  t: number,
  W: number,
  H: number,
): void {
  if (beat.beat.kind !== "hook" && beat.beat.kind !== "metric" && beat.beat.kind !== "context") return;
  const full = beat.beat.label?.trim();
  if (!full) return;

  ctx.save();
  ctx.font = "700 42px Inter, Arial, sans-serif";
  ctx.letterSpacing = "3px";
  ctx.textAlign = "center";
  const elapsed = Math.max(0, t - beat.start);
  const reveal = clamp01(elapsed / Math.min(0.56, Math.max(0.26, beat.duration * 0.25)));
  const count = Math.max(0, Math.min(full.length, Math.ceil(full.length * reveal)));
  const exit = clamp01((beat.start + beat.duration - t) / 0.2);
  ctx.globalAlpha = smoother(Math.min(reveal * 2, exit));
  ctx.shadowColor = "rgba(0,0,0,.95)";
  ctx.shadowBlur = 26;
  ctx.fillStyle = "#f7f7f2";
  ctx.fillText(full.slice(0, count), W / 2, H - SAFE_BOTTOM - 132);
  ctx.restore();
}

// The mid-frame value kicker is GONE, and the section that drew it with it.
//
// It repeated, in 46px type across the middle of the frame, a number that was
// already on screen twice: once in the chip riding the measurement line and
// once implied by the score in the bottom bar. Three renderings of one value
// per beat, and the big one sat over the face. The overlay drawing the line
// and the chip on it IS the caption; anything restating it is cover.
//
// rollingDigits and rollProgress stay exported below — the chip's own number
// roll uses the same helpers and the tests pin their behaviour.

// ---------------------------------------------------------------------------
// The number roll.
//
// A measured value that is simply THERE reads as a caption. One that arrives
// unresolved and settles reads as a machine finishing its arithmetic, and it
// is the cheapest expensive-looking gesture in the reference videos — their
// facial thirds visibly pass through 51/51/57 and 37/36/32 before landing on
// 34/34/32, and their harmony donut counts 35 → 51 → 64 → 87.
//
// Two rules it has to obey here:
//
//   Deterministic. Frames are rendered for export, and the same beat rendered
//   twice must produce the same pixels, so there is no Math.random in this —
//   the digit is a hash of its position and the quantised step.
//
//   After the evidence, never before. The roll starts at drawAt, the instant
//   the line finishes drawing. A value resolving while its own measurement is
//   still being constructed is the backwards version of this.
// ---------------------------------------------------------------------------

const ROLL = 0.45;

export function rollProgress(beat: TimedBeat, t: number): number {
  if (beat.drawAt === undefined) return 1;
  return clamp01((t - beat.drawAt) / ROLL);
}

/**
 * `final` with its digits scrambled, settling left to right as `p` runs 0→1.
 *
 * Only digits move. The decimal point, the minus and the unit hold still,
 * because a string whose punctuation dances is a glitch rather than a readout.
 * Leading digits lock first, the way an odometer settles, so the magnitude is
 * readable before the precision is.
 */
export function rollingDigits(final: string, p: number): string {
  if (p >= 1) return final;
  const digits: number[] = [];
  for (let i = 0; i < final.length; i++) {
    if (final[i] >= "0" && final[i] <= "9") digits.push(i);
  }
  if (!digits.length) return final;

  // Quantised so the digits visibly STEP. Rolling per frame at 60fps is a
  // grey blur that reads as a rendering fault, not as counting.
  const STEPS = 9;
  const step = Math.floor(clamp01(p) * STEPS);
  const out = final.split("");
  for (let k = 0; k < digits.length; k++) {
    if (p >= (k + 1) / digits.length) continue;
    const i = digits[k];
    const h = (i * 2654435761 + step * 40503 + final.length * 97) >>> 0;
    out[i] = String(h % 10);
  }
  return out.join("");
}

// The bottom bar. Fixed position, every frame, because a value that moves is a
// value the eye has to find again on every beat.
function drawBottomBar(
  ctx: CanvasRenderingContext2D,
  input: RundownInput,
  beat: TimedBeat,
  W: number,
  H: number,
): void {
  const id = beat.beat.metricId;
  const metric = id ? input.metrics.get(id) : undefined;
  // As low as the frame allows while staying clear of TikTok's own chrome.
  // It sat at H - SAFE_BOTTOM - 40 and together with the caption formed a
  // block across the lower third of the face; with the caption down to one
  // word the bar drops too, and the face gets the frame back. The watermark
  // moves under it (drawWatermark), and the stack bottoms out around 1060 at
  // 1280 tall — above where TikTok's description and sound rail begin.
  const y = H - SAFE_BOTTOM + 10;

  ctx.save();
  ctx.textAlign = "left";
  ctx.font = "600 25px Inter, Arial, sans-serif";
  ctx.letterSpacing = "0px";
  ctx.fillStyle = "#f5f5f1";
  const title = metric ? metric.def.name : titleFor(beat, input.name);
  ctx.fillText(clip(ctx, title, W * 0.56), SAFE_LEFT, y);

  ctx.font = "500 14px Inter, Arial, sans-serif";
  ctx.letterSpacing = "3px";
  ctx.fillStyle = "#7f8682";
  ctx.fillText(metric ? "SCORE" : "TRUEMAX", SAFE_LEFT, y + 26);

  // The number, right-aligned, with the qualitative band under it. The band is
  // the part a viewer repeats out loud, so it is never omitted — a bare 9.5
  // means nothing without knowing 9.5 is excellent.
  const badge = beat.beat.badge;
  if (metric || badge) {
    ctx.textAlign = "right";
    ctx.letterSpacing = "-1px";
    if (metric) {
      // "/10" is measured and placed first, and the score is then right-aligned
      // to where it ends. Both drawn at the same right edge would stack the
      // suffix on top of the number, which is what happens if you set
      // textAlign once and forget the second string is a separate draw.
      ctx.font = "300 20px Fraunces, Georgia, serif";
      ctx.fillStyle = "#747b77";
      ctx.fillText("/10", W - SAFE_RIGHT, y + 12);
      const suffix = ctx.measureText("/10").width;
      ctx.font = "300 54px Fraunces, Georgia, serif";
      ctx.fillStyle = toneColour(metric);
      ctx.fillText(metric.score.toFixed(1), W - SAFE_RIGHT - suffix - 6, y + 12);
      ctx.font = "500 13px Inter, Arial, sans-serif";
      ctx.letterSpacing = "2px";
      ctx.fillStyle = "#7f8682";
      ctx.fillText(bandFor(metric).toUpperCase(), W - SAFE_RIGHT, y + 36);
    } else if (badge && beat.beat.kind !== "curve" && beat.beat.kind !== "card") {
      ctx.font = "300 54px Fraunces, Georgia, serif";
      ctx.fillStyle = "#f7f7f2";
      ctx.fillText(badge, W - SAFE_RIGHT, y + 12);
      ctx.font = "500 13px Inter, Arial, sans-serif";
      ctx.letterSpacing = "2px";
      ctx.fillStyle = "#7f8682";
      ctx.fillText("MEASURED, NOT GUESSED", W - SAFE_RIGHT, y + 36);
    }
  }
  ctx.restore();
}

function titleFor(beat: TimedBeat, name: string): string {
  switch (beat.beat.kind) {
    case "hook":
      return name;
    case "score":
      return "Overall";
    case "context":
      return "What this does not measure";
    default:
      return name;
  }
}

// Colour carries the same judgement the sentence does, so the two cannot
// disagree on screen. Green for a strength, warm for a weakness, and the same
// two colours the rest of the product already uses.
/**
 * The colour grammar: is this measurement holding the face back, or not.
 *
 * Keyed to `conformance` (spec: inside its tolerance band?) rather than to
 * `zEff` (rank: does it out-rank half the population?). Those are different
 * questions, and the rank one was the wrong one to paint with. Its thresholds
 * at ±0.5 sd put HALF of every corpus metric — 49.3% of 627 — into a neutral
 * white that says nothing, so half of any rundown rendered as visual filler.
 *
 * On the same 627 the band reading splits 46.9% in / 53.1% out: an even,
 * legible contrast where every element on screen carries a verdict. Crucially
 * the two rules never contradict — zero metrics are in band yet ranked weak,
 * and zero are out of band yet ranked strong — so this only ever resolves the
 * old neutral middle. Nothing that used to read positive can turn negative.
 *
 * Out of band ramps with distance instead of being one flat warning colour:
 * 22.5% of metrics sit just outside and 15.6% sit far outside, and a video that
 * shouts equally at both is lying about which one to work on.
 */
export function toneColour(metric: ScoredMetric): string {
  if (metric.conformance >= 1) return "#8ff3e0";
  // 1 → just outside, muted. 0 → far outside, saturated.
  const out = clamp01(1 - metric.conformance);
  return mixHex("#e8c98a", "#e8894f", smoother(out));
}

function mixHex(a: string, b: string, t: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const c = (i: number) => Math.round(lerp(ch(a, i), ch(b, i), clamp01(t)));
  return `rgb(${c(0)}, ${c(1)}, ${c(2)})`;
}

function bandFor(metric: ScoredMetric): string {
  const z = metric.zEff;
  if (z >= 1.2) return "Excellent";
  if (z >= 0.5) return "Good";
  if (z > -0.5) return "Average";
  if (z > -1.2) return "Below average";
  return "Weak";
}

function clip(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 3 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

// The address, on screen the whole way through.
//
// It was CENTRED, which on a 720-wide frame puts it directly under the chin —
// the one column a measurement line is most likely to be drawn down. A jaw
// width, a philtrum, a midline: all of them run through the middle of the
// bottom third, and all of them arrived on top of the wordmark.
//
// So it tucks in under the score column instead, left-aligned to the same edge
// the metric name already uses. Nothing is measured out there, the items read
// as one stack, and the centre of the frame is left to the face.
//
// Drawn as the shared search lockup (searchLockup.ts) rather than flat type:
// a persistent little search bar is an instruction, not a signature, and it
// is the same pill on every export the product makes.
function drawWatermark(ctx: CanvasRenderingContext2D, H: number): void {
  // Left-anchored in the old wordmark's slot: centre sits half a pill-width
  // in from SAFE_LEFT, measured once with the pill's own font so the left
  // edge lands where the flat wordmark's did.
  const h = 30;
  ctx.save();
  ctx.font = `500 ${Math.round(h * 0.44)}px Inter, Arial, sans-serif`;
  ctx.letterSpacing = "1px";
  const textW = ctx.measureText("truemax").width + ctx.measureText(".app").width;
  const pillW = h * 0.5 + h * 0.17 * 2.9 + h * 0.32 + textW + h * 0.5;
  ctx.restore();
  drawSearchLockup(ctx, { cx: SAFE_LEFT + pillW / 2, cy: H - SAFE_BOTTOM + 58, h, alpha: 0.85 });
}
