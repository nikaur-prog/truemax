import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { ScoredMetric } from "../engine/types.js";
import { drawMeasurement, measurementBounds } from "./measureOverlay.js";
import { drawCtaCard } from "./ctaCard.js";
import { easeOutCubic } from "./countUp.js";

// ---------------------------------------------------------------------------
// The universal CTA series: one ~26 second outro, identical every time.
//
// Every frame is a pure function of `t`. That is the entire design. The brief
// was "nothing should be regenerated — the same CTA series every time with the
// same visuals", and the only way to guarantee that is for the video to be a
// deterministic render rather than a recording: no wall clock, no rAF, no
// MediaRecorder timing jitter. tools/build-cta.mjs steps t frame by frame and
// what comes out is bit-identical run to run, give or take codec entropy.
//
// Honesty rules carried in from the rest of the product:
//  - The score shown is the engine's real output for the demo face, computed
//    at build time. No invented number is ever drawn.
//  - The measurements are drawn by the same drawMeasurement the report uses,
//    from real landmarks. Same lines, same values.
//  - The demo face is a Wikimedia Commons photo; its credit renders on every
//    beat the face appears in, because the licence requires it.
//  - The one AI actor shot is tagged AI-GENERATED on screen, per the trust
//    rules in docs/AI_ACTOR_CONTENT_STRATEGY.md. It is never presented as a
//    customer.
//  - No rarity claims beyond what the card itself already states.
// ---------------------------------------------------------------------------

/** VO phrase → visual. Times in seconds. Exported so tests can pin the map. */
export interface CtaBeat {
  id: "score" | "measure" | "coach" | "confident" | "recs" | "progress" | "linkbio" | "search";
  start: number;
  end: number;
}

export const CTA_BEATS: readonly CtaBeat[] = [
  { id: "score", start: 0.0, end: 3.2 }, // "If you want your own in-depth analysis"
  { id: "measure", start: 3.2, end: 7.2 }, // "where we break down your entire facial format"
  { id: "coach", start: 7.2, end: 11.2 }, // "along with a personalized coach…"
  { id: "confident", start: 11.2, end: 14.2 }, // "…your most confident-looking self"
  { id: "recs", start: 14.2, end: 18.0 }, // "product, dietary, and lifestyle recommendations"
  { id: "progress", start: 18.0, end: 21.0 }, // "as he tracks your progress every week"
  { id: "linkbio", start: 21.0, end: 23.0 }, // "Click the link in bio"
  { id: "search", start: 23.0, end: 26.0 }, // "or search truemax.app" → endcard
];

/** Base length; the builder extends the final endcard hold to cover the VO. */
export const CTA_SECONDS = 26;

const BG = "#0d0f11";
const INK = "#f4f2ec";
const MINT = "#2f9e73";
const MINT_BRIGHT = "#79e8d2";
const MUT = "rgba(244,242,236,0.55)";

const SERIF = '"Fraunces Variable", Fraunces, Georgia, serif';
const SANS = '"Inter Variable", Inter, system-ui, sans-serif';

export interface CtaAssets {
  /** The finished score card, pre-rendered once by renderScoreCard. */
  scoreCard: HTMLCanvasElement;
  /** The demo face and its landmarks, for the measure beat. */
  photo: HTMLCanvasElement;
  landmarks: NormalizedLandmark[];
  /** Exactly the metrics to feature, in order. Real ScoredMetrics. */
  metrics: ScoredMetric[];
  /** Wikimedia attribution for the demo face. Rendered, not optional. */
  credit: string;
  /** Coach Max's face. */
  maxAvatar: CanvasImageSource | null;
  /** The brand mark for the search beat. */
  mark: CanvasImageSource | null;
  /** Frame of the AI actor clip at `local` seconds into its beat, if ready. */
  girlFrame: (local: number) => CanvasImageSource | null;
  /** Three real recommendation titles: [product, diet, lifestyle]. */
  recs: [string, string, string];
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** 0→1 across [a,b] of the local beat time, eased. */
const seg = (local: number, a: number, b: number) => easeOutCubic(clamp01((local - a) / (b - a)));

export interface CtaFrameOpts {
  /**
   * Hold the measure beat's camera on one wide, cover-fit framing of the face
   * instead of easing into each construction. For contexts that LOOP the beat
   * — the gate montage plays it inside a phone frame — where the per-metric
   * push-in reads as restless zooming rather than as a camera move. The lines
   * still draw themselves; only the camera stands still.
   */
  stillMeasureCamera?: boolean;
}

/**
 * Draw the frame at absolute time `t` seconds. `w`,`h` are the output size
 * (1080×1920 in production). `total` is the full video length — everything
 * past the search beat holds the endcard until then.
 */
export function drawCtaSeriesFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  assets: CtaAssets,
  opts: CtaFrameOpts = {},
): void {
  ctx.save();
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);

  const beat = CTA_BEATS.find((b) => t >= b.start && t < b.end) ?? CTA_BEATS[CTA_BEATS.length - 1];
  const local = t - beat.start;

  switch (beat.id) {
    case "score": drawScore(ctx, w, h, local, assets); break;
    case "measure": drawMeasure(ctx, w, h, local, beat.end - beat.start, assets, opts); break;
    case "coach": drawCoach(ctx, w, h, local, assets); break;
    case "confident": drawConfident(ctx, w, h, local, assets); break;
    case "recs": drawRecs(ctx, w, h, local, assets); break;
    case "progress": drawProgress(ctx, w, h, local, assets); break;
    case "linkbio": drawLinkBio(ctx, w, h, local); break;
    case "search": drawSearch(ctx, w, h, local, assets); break;
  }
  ctx.restore();
}

// --- beat 1: the score card ------------------------------------------------

function drawScore(ctx: CanvasRenderingContext2D, w: number, h: number, local: number, a: CtaAssets): void {
  // The real card, rising into place with a slow push-in. The card already
  // carries the number, the percentile and the face — re-drawing any of it
  // here would just be a second copy that can drift.
  const rise = seg(local, 0, 0.7);
  const push = 1.0 + 0.05 * clamp01(local / 3.2);
  const cw = a.scoreCard.width;
  const ch = a.scoreCard.height;
  const scale = Math.min(w / cw, h / ch) * push;
  const dw = cw * scale;
  const dh = ch * scale;
  ctx.globalAlpha = rise;
  ctx.drawImage(a.scoreCard, (w - dw) / 2, (h - dh) / 2 + (1 - rise) * h * 0.06, dw, dh);
  ctx.globalAlpha = 1;

  // One sweep line passing down the card — the scan, in shorthand.
  if (local > 0.5 && local < 2.2) {
    const p = (local - 0.5) / 1.7;
    const y = h * (0.12 + 0.72 * p);
    const grad = ctx.createLinearGradient(0, y - 3, 0, y + 3);
    grad.addColorStop(0, "rgba(121,232,210,0)");
    grad.addColorStop(0.5, "rgba(121,232,210,0.85)");
    grad.addColorStop(1, "rgba(121,232,210,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(w * 0.08, y - 3, w * 0.84, 6);
  }
  // Top-left on this beat: the card draws its own footer line along the
  // bottom, and two faint captions on one baseline read as a misprint.
  credit(ctx, w, h, a.credit, "top");
}

// --- beat 2: the measure pass ----------------------------------------------

function drawMeasure(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  local: number,
  span: number,
  a: CtaAssets,
  opts: CtaFrameOpts = {},
): void {
  const n = Math.max(1, a.metrics.length);
  const per = span / n;
  const i = Math.min(n - 1, Math.floor(local / per));
  const sub = (local - i * per) / per; // 0..1 through this metric
  const metric = a.metrics[i];

  // The measurement is drawn at photo resolution on a scratch layer, then the
  // whole photo+figure is composited through a zoom window framing the
  // construction — the same zoomToBounds thinking as the live pass, done with
  // drawImage because everything here is one canvas.
  const pw = a.photo.width;
  const ph = a.photo.height;
  const scratch = scratchLayer(pw, ph);
  const sctx = scratch.getContext("2d")!;
  sctx.clearRect(0, 0, pw, ph);
  // Lines only, matching the scan itself: the app's measure pass stopped
  // printing values, and the ad depicting it must not show a UI the app
  // does not have.
  drawMeasurement(scratch, a.landmarks, pw, ph, metric, seg(sub, 0.15, 0.75), { labels: false });

  let viewW: number;
  let viewH: number;
  let sx: number;
  let sy: number;
  if (opts.stillMeasureCamera) {
    // One framing for the whole beat: cover-fit, centred on the face itself
    // (the landmark centroid), identical for every metric so the loop cuts
    // are invisible.
    let cxSum = 0;
    let cySum = 0;
    for (const p of a.landmarks) { cxSum += p.x; cySum += p.y; }
    const cxN = a.landmarks.length ? cxSum / a.landmarks.length : 0.5;
    const cyN = a.landmarks.length ? cySum / a.landmarks.length : 0.5;
    viewW = Math.min(pw, ph * (w / h));
    viewH = (viewW / w) * h;
    sx = Math.max(0, Math.min(pw - viewW, cxN * pw - viewW / 2));
    sy = Math.max(0, Math.min(ph - viewH, cyN * ph - viewH / 2));
  } else {
    const b = measurementBounds(metric, a.landmarks) ?? { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8 };
    const pad = 0.16;
    const cxN = (b.x0 + b.x1) / 2;
    const cyN = (b.y0 + b.y1) / 2;
    const spanN = Math.max(b.x1 - b.x0, (b.y1 - b.y0) * (ph / pw)) + pad * 2;
    // Ease from wide to framed across the metric's own window.
    const zoomIn = seg(sub, 0, 0.45);
    viewW = pw * (1 + (Math.min(0.95, Math.max(0.35, spanN)) - 1) * zoomIn);
    viewH = (viewW / w) * h;
    sx = Math.max(0, Math.min(pw - viewW, cxN * pw - viewW / 2));
    sy = Math.max(0, Math.min(ph - viewH, cyN * ph - viewH / 2));
  }

  ctx.drawImage(a.photo, sx, sy, viewW, viewH, 0, 0, w, h);
  ctx.drawImage(scratch, sx, sy, viewW, viewH, 0, 0, w, h);

  // Dark gradient at the bottom so the label always reads.
  const grad = ctx.createLinearGradient(0, h * 0.78, 0, h);
  grad.addColorStop(0, "rgba(13,15,17,0)");
  grad.addColorStop(1, "rgba(13,15,17,0.9)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, h * 0.78, w, h * 0.22);

  const u = w / 1080;
  ctx.textAlign = "left";
  ctx.fillStyle = MUT;
  ctx.font = `500 ${Math.round(26 * u)}px ${SANS}`;
  ctx.fillText(metric.def.name.toUpperCase(), w * 0.08, h * 0.9);
  credit(ctx, w, h, a.credit);
}

let scratchCache: HTMLCanvasElement | null = null;
function scratchLayer(w: number, h: number): HTMLCanvasElement {
  if (!scratchCache) scratchCache = document.createElement("canvas");
  if (scratchCache.width !== w) scratchCache.width = w;
  if (scratchCache.height !== h) scratchCache.height = h;
  return scratchCache;
}

// --- beat 3: the coach -----------------------------------------------------

const COACH_LINES = [
  "Want me to help you with your cheek area?",
  "Here's the plan. Step by step, week by week.",
];

function drawCoach(ctx: CanvasRenderingContext2D, w: number, h: number, local: number, a: CtaAssets): void {
  const u = w / 1080;

  // Max pops in with the same overshoot the app's pop-out has.
  const pop = seg(local, 0, 0.5);
  const overshoot = 1 + 0.12 * Math.sin(Math.min(1, pop) * Math.PI);
  const size = 240 * u * pop * overshoot;
  const mx = w / 2;
  const my = h * 0.3;
  if (a.maxAvatar && size > 1) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(mx, my, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = "#101113";
    ctx.fill();
    ctx.clip();
    ctx.drawImage(a.maxAvatar, mx - size / 2, my - size / 2, size, size);
    ctx.restore();
    ctx.strokeStyle = MINT;
    ctx.lineWidth = 3 * u;
    ctx.beginPath();
    ctx.arc(mx, my, size / 2, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.textAlign = "center";
  ctx.fillStyle = MUT;
  ctx.font = `500 ${Math.round(24 * u)}px ${SANS}`;
  ctx.globalAlpha = pop;
  ctx.fillText("COACH MAX", mx, my + size / 2 + 46 * u);
  ctx.globalAlpha = 1;

  // Two bubbles, typed on. The typewriter is the app's own texture.
  const starts = [0.7, 2.2];
  for (let i = 0; i < COACH_LINES.length; i++) {
    if (local < starts[i]) continue;
    const line = COACH_LINES[i];
    const tp = (local - starts[i]) / 1.1;
    const typed = tp >= 1 ? line.length : Math.floor(tp * line.length);
    bubble(ctx, w, u, line.slice(0, typed), h * 0.48 + i * 150 * u, i === 0);
  }
}

function bubble(ctx: CanvasRenderingContext2D, w: number, u: number, text: string, y: number, coach: boolean): void {
  if (!text) return;
  ctx.font = `400 ${Math.round(34 * u)}px ${SANS}`;
  const padX = 30 * u;
  const tw = ctx.measureText(text).width;
  const bw = Math.min(w * 0.84, tw + padX * 2);
  const bh = 86 * u;
  const x = coach ? w * 0.08 : w * 0.92 - bw;
  ctx.fillStyle = coach ? "#182420" : "#20242a";
  roundRect(ctx, x, y, bw, bh, 22 * u);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.fillText(text, x + padX, y + bh * 0.62);
}

// --- beat 4: the AI actor --------------------------------------------------

function drawConfident(ctx: CanvasRenderingContext2D, w: number, h: number, local: number, a: CtaAssets): void {
  const frame = a.girlFrame(local);
  if (frame) {
    // Cover-fit the clip.
    const fw = (frame as HTMLVideoElement).videoWidth || (frame as HTMLCanvasElement).width || w;
    const fh = (frame as HTMLVideoElement).videoHeight || (frame as HTMLCanvasElement).height || h;
    const s = Math.max(w / fw, h / fh);
    ctx.drawImage(frame, (w - fw * s) / 2, (h - fh * s) / 2, fw * s, fh * s);
  }
  // The trust label. Small, present, every frame of the beat.
  const u = w / 1080;
  ctx.textAlign = "right";
  ctx.font = `600 ${Math.round(20 * u)}px ${SANS}`;
  ctx.fillStyle = "rgba(13,15,17,0.55)";
  const label = "AI-GENERATED DEMONSTRATION";
  const tw = ctx.measureText(label).width;
  roundRect(ctx, w * 0.96 - tw - 24 * u, h * 0.045, tw + 24 * u, 40 * u, 10 * u);
  ctx.fill();
  ctx.fillStyle = "rgba(244,242,236,0.9)";
  ctx.fillText(label, w * 0.96 - 12 * u, h * 0.045 + 27 * u);
}

// --- beat 5: the recommendations -------------------------------------------

function drawRecs(ctx: CanvasRenderingContext2D, w: number, h: number, local: number, a: CtaAssets): void {
  const u = w / 1080;
  const kinds = ["PRODUCT", "DIET", "LIFESTYLE"];
  ctx.textAlign = "center";
  ctx.fillStyle = INK;
  ctx.font = `300 ${Math.round(54 * u)}px ${SERIF}`;
  ctx.globalAlpha = seg(local, 0, 0.4);
  ctx.fillText("Built around your goals", w / 2, h * 0.2);
  ctx.globalAlpha = 1;

  for (let i = 0; i < 3; i++) {
    const at = seg(local, 0.4 + i * 0.55, 1.0 + i * 0.55);
    if (at <= 0) continue;
    const y = h * 0.28 + i * 200 * u + (1 - at) * 60 * u;
    const x = w * 0.08;
    const bw = w * 0.84;
    ctx.globalAlpha = at;
    ctx.fillStyle = "#15181c";
    roundRect(ctx, x, y, bw, 160 * u, 26 * u);
    ctx.fill();
    ctx.strokeStyle = "rgba(121,232,210,0.18)";
    ctx.lineWidth = 2 * u;
    roundRect(ctx, x, y, bw, 160 * u, 26 * u);
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.fillStyle = MINT_BRIGHT;
    ctx.font = `600 ${Math.round(24 * u)}px ${SANS}`;
    ctx.fillText(kinds[i], x + 36 * u, y + 56 * u);
    ctx.fillStyle = INK;
    ctx.font = `400 ${Math.round(36 * u)}px ${SANS}`;
    ctx.fillText(fitText(ctx, a.recs[i], bw - 72 * u), x + 36 * u, y + 112 * u);
    ctx.globalAlpha = 1;
  }
}

// --- beat 6: the weekly trend ----------------------------------------------

function drawProgress(ctx: CanvasRenderingContext2D, w: number, h: number, local: number, a: CtaAssets): void {
  const u = w / 1080;
  ctx.textAlign = "center";
  ctx.fillStyle = INK;
  ctx.font = `300 ${Math.round(54 * u)}px ${SERIF}`;
  ctx.fillText("Tracked, week by week", w / 2, h * 0.2);

  // The chart: eight weekly points, the line drawing left to right. The shape
  // rises but no number is claimed — a fabricated delta has no place here.
  const x0 = w * 0.12;
  const x1 = w * 0.88;
  const yBase = h * 0.62;
  const yTop = h * 0.4;
  const p = seg(local, 0.2, 2.2);
  const pts = [0, 0.08, 0.1, 0.22, 0.28, 0.42, 0.55, 0.66];
  ctx.strokeStyle = "rgba(244,242,236,0.12)";
  ctx.lineWidth = 1.5 * u;
  for (let i = 0; i < 8; i++) {
    const x = x0 + ((x1 - x0) * i) / 7;
    ctx.beginPath();
    ctx.moveTo(x, yTop - 20 * u);
    ctx.lineTo(x, yBase + 20 * u);
    ctx.stroke();
  }
  ctx.strokeStyle = MINT_BRIGHT;
  ctx.lineWidth = 4 * u;
  ctx.lineCap = "round";
  ctx.beginPath();
  const upto = p * 7;
  for (let i = 0; i <= Math.floor(upto); i++) {
    const x = x0 + ((x1 - x0) * i) / 7;
    const y = yBase - (yBase - yTop) * pts[i];
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  // Partial segment to the live point.
  const fi = Math.floor(upto);
  if (fi < 7) {
    const frac = upto - fi;
    const xa = x0 + ((x1 - x0) * fi) / 7;
    const ya = yBase - (yBase - yTop) * pts[fi];
    const xb = x0 + ((x1 - x0) * (fi + 1)) / 7;
    const yb = yBase - (yBase - yTop) * pts[fi + 1];
    ctx.lineTo(xa + (xb - xa) * frac, ya + (yb - ya) * frac);
  }
  ctx.stroke();

  ctx.fillStyle = MUT;
  ctx.font = `500 ${Math.round(22 * u)}px ${SANS}`;
  ctx.textAlign = "left";
  ctx.fillText("WEEK 1", x0, yBase + 60 * u);
  ctx.textAlign = "right";
  ctx.fillText("WEEK 8", x1, yBase + 60 * u);

  // The live end of the line, marked, so the eye lands where the story is.
  {
    const li = Math.min(7, Math.floor(upto));
    const lf = Math.min(1, upto - li);
    const lx = x0 + ((x1 - x0) * Math.min(7, upto)) / 7;
    const ly = yBase - (yBase - yTop) * (pts[li] + ((pts[li + 1] ?? pts[7]) - pts[li]) * lf);
    ctx.fillStyle = MINT_BRIGHT;
    ctx.beginPath();
    ctx.arc(lx, ly, 8 * u, 0, Math.PI * 2);
    ctx.fill();
  }

  // Max peeks in from the right edge — half off-frame, like he is leaning
  // round a door, not a sticker placed in the corner.
  if (a.maxAvatar && local > 1.2) {
    const inP = seg(local, 1.2, 1.8);
    const size = 300 * u;
    const mx = w + size * 0.5 - size * 0.72 * inP;
    const my = h * 0.78;
    const tilt = Math.sin((local - 1.8) * 5) * 0.08 * (local > 1.8 ? 1 : 0);
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(-0.12 + tilt);
    ctx.beginPath();
    ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = "#101113";
    ctx.fill();
    ctx.clip();
    ctx.drawImage(a.maxAvatar, -size / 2, -size / 2, size, size);
    ctx.restore();
  }
}

// --- beat 7: link in bio ---------------------------------------------------

function drawLinkBio(ctx: CanvasRenderingContext2D, w: number, h: number, local: number): void {
  const u = w / 1080;
  // A stylised phone — deliberately OURS, not a mocked-up TikTok. Faking
  // another product's chrome in an ad is how you get taken down.
  const pw = w * 0.62;
  const ph = pw * 2.05;
  const px = (w - pw) / 2;
  const py = h * 0.16;
  ctx.fillStyle = "#15181c";
  roundRect(ctx, px, py, pw, ph, 56 * u);
  ctx.fill();
  ctx.strokeStyle = "rgba(244,242,236,0.14)";
  ctx.lineWidth = 3 * u;
  roundRect(ctx, px, py, pw, ph, 56 * u);
  ctx.stroke();

  // Abstract profile rows.
  ctx.fillStyle = "rgba(244,242,236,0.1)";
  ctx.beginPath();
  ctx.arc(w / 2, py + 140 * u, 62 * u, 0, Math.PI * 2);
  ctx.fill();
  roundRect(ctx, w / 2 - 90 * u, py + 230 * u, 180 * u, 22 * u, 11 * u);
  ctx.fill();
  roundRect(ctx, w / 2 - 130 * u, py + 274 * u, 260 * u, 18 * u, 9 * u);
  ctx.fill();

  // The pill. It breathes until the tap, then depresses with a ripple.
  const tapAt = 1.1;
  const pressed = local > tapAt && local < tapAt + 0.25;
  const glow = 0.5 + 0.5 * Math.sin(local * 4);
  const bw = pw * 0.72;
  const bh = 84 * u;
  const bx = w / 2 - bw / 2;
  const by = py + 340 * u;
  ctx.save();
  if (pressed) ctx.translate(0, 3 * u);
  ctx.shadowColor = `rgba(121,232,210,${0.25 + glow * 0.3})`;
  ctx.shadowBlur = 30 * u;
  ctx.fillStyle = MINT;
  roundRect(ctx, bx, by, bw, bh, bh / 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "#0d0f11";
  ctx.textAlign = "center";
  ctx.font = `600 ${Math.round(34 * u)}px ${SANS}`;
  ctx.fillText("truemax.app", w / 2, by + bh * 0.64);

  if (local > tapAt) {
    const r = seg(local, tapAt, tapAt + 0.7);
    ctx.strokeStyle = `rgba(121,232,210,${0.7 * (1 - r)})`;
    ctx.lineWidth = 4 * u;
    ctx.beginPath();
    ctx.arc(w / 2, by + bh / 2, 40 * u + r * 180 * u, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = MUT;
  ctx.font = `500 ${Math.round(26 * u)}px ${SANS}`;
  ctx.fillText("LINK IN BIO", w / 2, py + ph + 70 * u);
}

// --- beat 8: the search, then the endcard ----------------------------------

const URL_TEXT = "www.truemax.app";

function drawSearch(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  local: number,
  a: CtaAssets,
): void {
  const u = w / 1080;
  const endcardAt = 1.9; // local seconds; endcard holds from here to `total`
  if (local >= endcardAt) {
    drawCtaCard(ctx, w, h, local - endcardAt, 0.6);
    return;
  }

  // The mark above the bar.
  if (a.mark) {
    const size = 150 * u;
    ctx.globalAlpha = seg(local, 0, 0.3);
    ctx.drawImage(a.mark, w / 2 - size / 2, h * 0.26 - size / 2, size, size);
    ctx.globalAlpha = 1;
  }

  // The search bar, typed into.
  const bw = w * 0.8;
  const bh = 100 * u;
  const bx = (w - bw) / 2;
  const by = h * 0.38;
  ctx.fillStyle = "#15181c";
  roundRect(ctx, bx, by, bw, bh, bh / 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(244,242,236,0.18)";
  ctx.lineWidth = 2.5 * u;
  roundRect(ctx, bx, by, bw, bh, bh / 2);
  ctx.stroke();
  // Magnifier glyph.
  ctx.strokeStyle = MUT;
  ctx.lineWidth = 5 * u;
  ctx.beginPath();
  ctx.arc(bx + 52 * u, by + bh / 2 - 6 * u, 16 * u, 0, Math.PI * 2);
  ctx.moveTo(bx + 64 * u, by + bh / 2 + 6 * u);
  ctx.lineTo(bx + 76 * u, by + bh / 2 + 18 * u);
  ctx.stroke();

  const typed = Math.min(URL_TEXT.length, Math.floor(seg(local, 0.15, 1.15) * URL_TEXT.length));
  ctx.textAlign = "left";
  ctx.fillStyle = INK;
  ctx.font = `500 ${Math.round(40 * u)}px ${SANS}`;
  const shown = URL_TEXT.slice(0, typed);
  ctx.fillText(shown, bx + 100 * u, by + bh * 0.64);
  // Caret, blinking on a deterministic clock.
  if (typed < URL_TEXT.length || Math.floor(local * 3) % 2 === 0) {
    const cx = bx + 100 * u + ctx.measureText(shown).width + 6 * u;
    ctx.fillStyle = MINT_BRIGHT;
    ctx.fillRect(cx, by + bh * 0.28, 3.5 * u, bh * 0.44);
  }

  // The cursor arrives and clicks once the URL is whole.
  if (local > 1.2) {
    const move = seg(local, 1.2, 1.65);
    const cx = w * 0.85 - move * (w * 0.85 - (bx + bw - 70 * u));
    const cy = h * 0.6 - move * (h * 0.6 - (by + bh / 2));
    const clicking = local > 1.7;
    if (clicking) {
      ctx.strokeStyle = `rgba(121,232,210,${0.8 * (1 - seg(local, 1.7, 1.9))})`;
      ctx.lineWidth = 4 * u;
      ctx.beginPath();
      ctx.arc(cx, cy, 20 * u + seg(local, 1.7, 1.9) * 60 * u, 0, Math.PI * 2);
      ctx.stroke();
    }
    cursor(ctx, cx, cy, 34 * u);
  }
}

function cursor(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = INK;
  ctx.strokeStyle = "#0d0f11";
  ctx.lineWidth = s * 0.08;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, s);
  ctx.lineTo(s * 0.26, s * 0.76);
  ctx.lineTo(s * 0.44, s * 1.08);
  ctx.lineTo(s * 0.58, s * 1.0);
  ctx.lineTo(s * 0.42, s * 0.7);
  ctx.lineTo(s * 0.72, s * 0.68);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// --- shared ----------------------------------------------------------------

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 3 && ctx.measureText(s + "…").width > maxW) s = s.slice(0, -1);
  return s + "…";
}

/** The Wikimedia credit line. Every beat the demo face appears in renders it. */
function credit(ctx: CanvasRenderingContext2D, w: number, h: number, text: string, at: "top" | "bottom" = "bottom"): void {
  const u = w / 1080;
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(244,242,236,0.4)";
  ctx.font = `400 ${Math.round(18 * u)}px ${SANS}`;
  ctx.fillText(text, w * 0.04, at === "top" ? h * 0.03 : h * 0.985);
}
