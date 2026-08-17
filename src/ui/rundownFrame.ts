import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { RegionId, ScoredMetric } from "../engine/types.js";
import type { RundownTimeline, TimedBeat } from "../engine/rundownTimeline.js";
import { beatAt, typedFraction } from "../engine/rundownTimeline.js";
import { drawMeasurement } from "./measureOverlay.js";

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
const BAND: Record<RegionId, [number, number]> = {
  eyes: [0.14, 0.58],
  midface: [0.24, 0.72],
  nose: [0.3, 0.78],
  lips: [0.5, 0.94],
  jaw: [0.46, 1.02],
  chin: [0.6, 1.06],
  // Whole-face measurements. Cropping in on a proportion between two distant
  // points and then drawing a line to one that is off screen would be worse
  // than not cropping at all.
  proportions: [0, 1],
  symmetry: [0, 1],
};

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
): Crop {
  const box = faceBox(landmarks);
  const faceW = Math.max(1, (box.x1 - box.x0) * photo.width);
  const faceH = Math.max(1, (box.y1 - box.y0) * photo.height);
  const [top, bottom] = BAND[region ?? "proportions"] ?? [0, 1];

  // Height wanted for this band, with headroom so the band is not flush to the
  // frame edge, then width derived from the output aspect.
  const bandH = faceH * (bottom - top) * 1.34;
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
  const minW = faceW * 0.72;
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

  const cx = ((box.x0 + box.x1) / 2) * photo.width;
  const cy = (box.y0 + (box.y1 - box.y0) * ((top + bottom) / 2)) * photo.height;
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
): Crop {
  const index = timeline.beats.findIndex((b) => t >= b.start && t < b.start + b.duration);
  const current = timeline.beats[index] ?? timeline.beats[timeline.beats.length - 1];
  if (!current) return regionCrop(photo, landmarks, undefined, aspect);

  const here = regionCrop(photo, landmarks, current.beat.region, aspect);
  const next = timeline.beats[index + 1];
  if (!next) return here;

  // The move occupies the last 0.55s of the beat, or the whole tail if the beat
  // is shorter than that.
  const MOVE = 0.55;
  const end = current.start + current.duration;
  const from = Math.max(current.start, end - MOVE);
  if (t < from) return here;
  const there = regionCrop(photo, landmarks, next.beat.region, aspect);
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
  const crop = cropAt(photo, landmarks, input.timeline, t, W / H);
  ctx.drawImage(photo, crop.x, crop.y, crop.w, crop.h, 0, 0, W, H);

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

  drawOverlayForBeat(ctx, photo, landmarks, input, beat, t, crop, W, H, overlayCanvas);
  drawCaption(ctx, beat, t, W, H);
  drawBottomBar(ctx, input, beat, W, H);
  drawWatermark(ctx, W, H);
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
  const baseline = H - 268;
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
  const y = H - 128;

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
      ctx.fillText("/10", W - 48, y + 12);
      const suffix = ctx.measureText("/10").width;
      ctx.font = "300 54px Fraunces, Georgia, serif";
      ctx.fillStyle = toneColour(metric);
      ctx.fillText(metric.score.toFixed(1), W - 48 - suffix - 6, y + 12);
      ctx.font = "500 13px Inter, Arial, sans-serif";
      ctx.letterSpacing = "2px";
      ctx.fillStyle = "#7f8682";
      ctx.fillText(bandFor(metric).toUpperCase(), W - 48, y + 36);
    } else if (badge) {
      ctx.font = "300 54px Fraunces, Georgia, serif";
      ctx.fillStyle = "#f7f7f2";
      ctx.fillText(badge, W - 48, y + 12);
      ctx.font = "500 13px Inter, Arial, sans-serif";
      ctx.letterSpacing = "2px";
      ctx.fillStyle = "#7f8682";
      ctx.fillText("MEASURED, NOT GUESSED", W - 48, y + 36);
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
  const y = H - 22;
  ctx.globalAlpha = 0.62;
  ctx.fillStyle = "#f5f5f1";
  ctx.fillText(name, x, y);
  ctx.fillStyle = "#0c876f";
  ctx.fillText(tld, x + ctx.measureText(name).width, y);
  ctx.restore();
}
