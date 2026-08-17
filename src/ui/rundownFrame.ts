import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { RegionId, ScoredMetric } from "../engine/types.js";
import type { RundownTimeline, TimedBeat } from "../engine/rundownTimeline.js";
import { beatAt, typedFraction } from "../engine/rundownTimeline.js";
import { drawMeasurement, measurementBounds } from "./measureOverlay.js";

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
const SAFE_BOTTOM = 300;
// The right-hand action rail. Only the bottom bar is wide enough to reach it.
const SAFE_RIGHT = 132;

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
   * That is also why they cannot "confuse the system" — the engine never sees
   * them. They are decoded as pictures by the compositor and reach no part of
   * the scoring, the landmarker or the report.
   */
  broll?: CanvasImageSource[];
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
  const bandH = faceH * (bottom - top) * 1.16;
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
    const pad = 0.16; // room for the label chip, which sits outside the span
    const needW = (mustContain.x1 - mustContain.x0) * photo.width * (1 + pad * 2);
    const needH = (mustContain.y1 - mustContain.y0) * photo.height * (1 + pad * 2);
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
): Crop {
  // The union of every measurement named in a beat, since a sentence may name
  // more than one and the frame has to hold all of them at once.
  const bounds = (b: TimedBeat) => {
    if (!metrics) return undefined;
    const ids = b.beat.metricIds ?? (b.beat.metricId ? [b.beat.metricId] : []);
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

  const index = timeline.beats.findIndex((b) => t >= b.start && t < b.start + b.duration);
  const current = timeline.beats[index] ?? timeline.beats[timeline.beats.length - 1];
  if (!current) return regionCrop(photo, landmarks, undefined, aspect);

  const here = regionCrop(photo, landmarks, current.beat.region, aspect, bounds(current));
  const next = timeline.beats[index + 1];
  if (!next) return here;

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
export function drawProgress(beat: TimedBeat, t: number): number {
  if (beat.drawAt === undefined) return 0;
  // The figure arrives over the run-up to drawAt, so it COMPLETES on the click
  // rather than starting there. The sound is the measurement landing.
  const DRAW = 0.5;
  return clamp01((t - (beat.drawAt - DRAW)) / DRAW);
}

export interface RundownFrameOptions {
  width: number;
  height: number;
  /** Reused across frames — allocating one per frame is the whole cost. */
  overlayCanvas: HTMLCanvasElement;
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

  const beat = beatAt(input.timeline, t) ?? input.timeline.beats[input.timeline.beats.length - 1];
  if (!beat) return;

  // The photograph is the frame. Full bleed rather than a card, because the
  // subject of a rundown is the face and every pixel spent on chrome is a pixel
  // not spent on the thing being measured.
  const crop = cropAt(photo, landmarks, input.timeline, t, W / H, input.metrics);
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
  const cutaway = (isDisclaimer && input.disclaimerClip) || brollFor(input, beat, t);
  if (cutaway) {
    // Cover, no crop maths: there are no landmarks for this photograph and
    // inventing a face box for it is exactly the guess this feature avoids.
    coverDraw(ctx, cutaway, W, H);
  } else if (kind === "card") {
    // The face moves to the top and the breakdown arrives under it.
    //
    // Not a cut: the crop the previous beat left off on eases up into the band
    // over the first third of this one, so the photograph appears to travel
    // rather than to be replaced. A hard cut here loses the connection between
    // the face just measured and the numbers now being read off it, which is
    // the one thing the card is for.
    const settle = smoother(clamp01((t - beat.start) / Math.max(0.001, beat.duration * 0.3)));
    const boxH = lerp(H, H * CARD_PHOTO, settle);
    const target = regionCrop(photo, landmarks, "proportions", W / boxH);
    const c = lerpCrop(crop, target, settle);
    ctx.drawImage(photo, c.x, c.y, c.w, c.h, 0, 0, W, boxH);
    // The photograph fades into the card rather than ending on a hard edge.
    const fade = ctx.createLinearGradient(0, boxH * 0.55, 0, boxH);
    fade.addColorStop(0, "rgba(5,6,6,0)");
    fade.addColorStop(1, "#050606");
    ctx.fillStyle = fade;
    ctx.fillRect(0, boxH * 0.55, W, boxH * 0.45 + 2);
  } else {
    ctx.drawImage(photo, crop.x, crop.y, crop.w, crop.h, 0, 0, W, H);
  }

  // Everything except the measurement goes dark. A uniform scrim rather than a
  // shaped mask: masking around the active region means computing a region
  // outline, and a slightly wrong outline draws attention to itself far more
  // than an even dim does.
  const scrim = ctx.createLinearGradient(0, 0, 0, H);
  scrim.addColorStop(0, "rgba(3,5,5,.72)");
  scrim.addColorStop(0.34, "rgba(3,5,5,.34)");
  scrim.addColorStop(0.68, "rgba(3,5,5,.42)");
  scrim.addColorStop(1, "rgba(3,5,5,.92)");
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
  // not a branch here that a later refactor can quietly drop.
  if (overlayVisible(input, beat, t)) {
    drawOverlayForBeat(ctx, photo, landmarks, input, beat, t, crop, W, H, overlayCanvas);
  }
  // The two closing beats take over the frame rather than sitting beside the
  // face. Both are arguments about the viewer rather than about the subject —
  // where he lands against everyone, and what to do about it — and neither
  // reads while a face is still competing for the eye.
  if (beat.beat.kind === "card") drawCard(ctx, beat, W, H);
  if (beat.beat.kind === "curve") drawCurve(ctx, beat, t, W, H, input.name);
  if (beat.beat.kind === "search") drawSearchBar(ctx, beat, t, W, H);
  // The caption is drawn on every beat including the card. It collided with the
  // region rows the first time round; the card is compressed now — a shorter
  // photo band, a tighter row pitch — specifically so both fit.
  drawCaption(ctx, beat, t, W, H);
  drawBottomBar(ctx, input, beat, W, H);
  drawWatermark(ctx, W, H);
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
): CanvasImageSource | null {
  const pool = input.broll;
  if (!pool?.length) return null;
  const kind = beat.beat.kind;
  const index = input.timeline.beats.indexOf(beat);
  if (index < 0) return null;

  // The card, the curve and the search bar own their whole frame and never take
  // one — a photograph behind a chart is the head-shaped smudge the search beat
  // was fixed to stop having.
  if (kind === "card" || kind === "curve" || kind === "search") return null;

  // A beat that draws nothing can take a cutaway for its whole length.
  if (kind !== "metric") return pool[index % pool.length] ?? null;

  // A MEASUREMENT beat takes one only in its tail, and this is the part worth
  // being careful about.
  //
  // The measurement cannot be drawn over a cutaway — the overlay lives in the
  // measured photograph's landmark space, so the same line over a different
  // face lands somewhere arbitrary. But "no cutaways during the analysis" costs
  // the format its only cuts through the longest stretch of the video, which is
  // most of the reason a rundown made of one still frame looks like one still
  // frame.
  //
  // So the beat is split. The line lands at DRAW_AT, holds on the measured
  // photograph through the middle of the sentence — long enough to be read and
  // to be the evidence it exists to be — and the last third cuts away while the
  // sentence finishes. Every measurement is still shown on the face it was
  // taken from, and there is now a cut on every beat instead of four in ninety
  // seconds.
  //
  // The crop move to the next region happens behind that cutaway, which is a
  // free improvement: the camera arrives already settled instead of gliding.
  const local = (t - beat.start) / Math.max(0.001, beat.duration);
  if (local < 1 - CUTAWAY_TAIL) return null;
  return pool[index % pool.length] ?? null;
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
  return drawProgress(beat, t) > 0;
}

// How much of a measurement beat's tail a cutaway may take. A third leaves the
// line on screen for the majority of the sentence that describes it, which is
// the ordering that makes it evidence rather than illustration.
const CUTAWAY_TAIL = 0.34;

// Cover-fit, centred. No crop maths and no face box: there are no landmarks for
// a cutaway, and inventing a bounding box for one is precisely the guess this
// feature exists to avoid making.
function coverDraw(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  W: number,
  H: number,
): void {
  const iw =
    (image as HTMLVideoElement).videoWidth || (image as HTMLImageElement).width || W;
  const ih =
    (image as HTMLVideoElement).videoHeight || (image as HTMLImageElement).height || H;
  const scale = Math.max(W / iw, H / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(image, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

// How far through its own animation a full-frame beat is, 0..1, with a little
// air at the end so the finished picture is held rather than cut on.
function beatProgress(beat: TimedBeat, t: number): number {
  return clamp01((t - beat.start) / Math.max(0.001, beat.duration * 0.62));
}

// How much of the frame the photograph keeps once the card is up.
const CARD_PHOTO = 0.3;

// Row pitch on the card. Eight regions have to finish above the caption, which
// itself has to finish above the safe area, and at the old 46px they ran 120px
// past it.
const CARD_ROW = 40;

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
function drawCard(ctx: CanvasRenderingContext2D, beat: TimedBeat, W: number, H: number): void {
  const card = beat.beat.card;
  if (!card) return;

  const top = H * CARD_PHOTO;
  ctx.save();
  ctx.textAlign = "center";

  // The verdict, big, because it is the conclusion and a name is what gets
  // quoted in a comment section.
  ctx.font = "300 76px Fraunces, Georgia, serif";
  ctx.fillStyle = "#f7f7f2";
  ctx.fillText(card.verdict, W / 2, top + 74);

  // The three figures, in a row. Score first because it is the one they came
  // for; ceiling next because it is the one that sells a subscription; rarity
  // last because it is the one nobody else in this niche can actually compute.
  const stats: Array<[string, string]> = [
    ["SCORE", card.overall.toFixed(1)],
    ["CEILING", card.potential.toFixed(1)],
    ["TOP", `${Math.max(1, Math.round(100 - card.percentile))}%`],
  ];
  const colW = W / 3;
  stats.forEach(([label, value], i) => {
    const cx = colW * i + colW / 2;
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
  let y = top + 238;
  const left = W * 0.12;
  const right = W * 0.88;
  ctx.textAlign = "left";
  for (const row of card.rows) {
    if (y > H - SAFE_BOTTOM - 200) break; // never collide with the caption
    ctx.font = "500 24px Inter, Arial, sans-serif";
    ctx.fillStyle = "#c9d1cd";
    ctx.fillText(row.label, left, y);

    // A bar as well as a number. The number is the fact; the bar is what makes
    // one region visibly the weak one at a glance, which is the thing a viewer
    // screenshots to argue about.
    const barX = left + 190;
    const barW = right - barX - 74;
    ctx.fillStyle = "rgba(247,247,242,0.12)";
    ctx.fillRect(barX, y - 14, barW, 8);
    ctx.fillStyle = row.score >= 6.5 ? "#8ff3e0" : row.score <= 4.5 ? "#e8a17a" : "#f7f7f2";
    ctx.fillRect(barX, y - 14, barW * clamp01(row.score / 10), 8);

    ctx.textAlign = "right";
    ctx.font = "500 24px Inter, Arial, sans-serif";
    ctx.fillStyle = "#f7f7f2";
    ctx.fillText(row.score.toFixed(1), right, y);
    ctx.textAlign = "left";
    y += CARD_ROW;
  }
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
  beat: TimedBeat,
  t: number,
  W: number,
  H: number,
  name: string,
): void {
  const p = beatProgress(beat, t);
  const pct = clamp01((beat.beat.percentile ?? 50) / 100);

  const left = W * 0.12;
  const right = W * 0.88;
  const span = right - left;
  const baseline = H * 0.52;
  const peak = H * 0.2;

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
      ctx.fillText(`TOP ${top}%`, W / 2, baseline + 96);
      ctx.font = "500 14px Inter, Arial, sans-serif";
      ctx.letterSpacing = "3px";
      ctx.fillStyle = "#7f8682";
      ctx.fillText("OF THE REFERENCE SET", W / 2, baseline + 130);
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
  const progress = drawProgress(beat, t);
  if (progress <= 0) return;

  // Drawn at the photograph's own resolution in normalized landmark space, then
  // composited through the SAME crop rectangle as the photograph. That is what
  // guarantees the line sits on the feature: both are the same projection of the
  // same coordinates, so there is no second transform to get wrong.
  drawMeasurement(overlayCanvas, landmarks, photo.width, photo.height, metric, progress);
  ctx.save();
  ctx.globalAlpha = Math.min(1, progress * 1.6);
  ctx.drawImage(overlayCanvas, crop.x, crop.y, crop.w, crop.h, 0, 0, W, H);
  ctx.restore();
}

// The caption, typed.
//
// Sits low enough to clear the measurement and high enough to clear the bottom
// bar. Two lines maximum — a third means the sentence was too long for a beat
// and the fix is in the script, not here.
function drawCaption(
  ctx: CanvasRenderingContext2D,
  beat: TimedBeat,
  t: number,
  W: number,
  H: number,
): void {
  const full = beat.beat.line;
  const shown = full.slice(0, Math.round(full.length * typedFraction(beat, t)));
  if (!shown) return;

  ctx.save();
  ctx.font = "600 34px Inter, Arial, sans-serif";
  ctx.letterSpacing = "0px";
  ctx.textAlign = "center";
  const maxWidth = W - 96;
  const lines = wrap(ctx, shown, maxWidth, 2);
  // Bottom-aligned against the safe area rather than measured down from the
  // frame edge, so a one-line beat and a two-line beat both END in the same
  // place instead of the second line sliding into TikTok's caption.
  const baseline = H - SAFE_BOTTOM - 96 - (lines.length - 1) * 44;
  lines.forEach((line, i) => {
    const y = baseline + i * 44;
    // A shadow rather than a plate behind the text. A plate is a rectangle the
    // eye has to look past; a shadow keeps the face visible underneath.
    ctx.shadowColor = "rgba(0,0,0,.9)";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "#f7f7f2";
    ctx.fillText(line, W / 2, y);
  });
  ctx.restore();
}

function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  return lines.slice(0, maxLines);
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
  // Was H - 128, which put the metric name and its value inside the block where
  // TikTok prints the caption and the sound name.
  const y = H - SAFE_BOTTOM - 40;

  ctx.save();
  ctx.textAlign = "left";
  ctx.font = "600 25px Inter, Arial, sans-serif";
  ctx.letterSpacing = "0px";
  ctx.fillStyle = "#f5f5f1";
  const title = metric ? metric.def.name : titleFor(beat, input.name);
  ctx.fillText(clip(ctx, title, W * 0.56), 48, y);

  ctx.font = "500 14px Inter, Arial, sans-serif";
  ctx.letterSpacing = "3px";
  ctx.fillStyle = "#7f8682";
  ctx.fillText(metric ? "SCORE" : "TRUEMAX", 48, y + 26);

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
function toneColour(metric: ScoredMetric): string {
  if (metric.zEff >= 0.5) return "#8ff3e0";
  if (metric.zEff <= -0.5) return "#e8a17a";
  return "#f7f7f2";
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

function drawWatermark(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  ctx.save();
  ctx.font = "500 16px Inter, Arial, sans-serif";
  ctx.letterSpacing = "2px";
  ctx.textAlign = "left";
  const name = "truemax";
  const tld = ".app";
  const total = ctx.measureText(name).width + ctx.measureText(tld).width;
  const x = (W - total) / 2;
  const y = H - SAFE_BOTTOM + 26;
  ctx.globalAlpha = 0.62;
  ctx.fillStyle = "#f5f5f1";
  ctx.fillText(name, x, y);
  ctx.fillStyle = "#0c876f";
  ctx.fillText(tld, x + ctx.measureText(name).width, y);
  ctx.restore();
}
