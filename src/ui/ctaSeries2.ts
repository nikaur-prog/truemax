import { drawScore, drawMeasure, credit } from "./ctaSeries.js";
import type { CtaAssets } from "./ctaSeries.js";
import { easeOutCubic } from "./countUp.js";

// ---------------------------------------------------------------------------
// The universal CTA outro, v2 — the Kurzgesagt cut.
//
// Same discipline as v1 (every frame a pure function of t; the master is a
// render, not a recording), three upgrades on top:
//
//  1. The beats are timed by the VOICE. The VO is generated as one clip per
//     phrase; each beat's start IS its phrase's start, so "along with a
//     personalized coach" cuts to the chat the instant it is spoken. The
//     durations below are measured from the actual segment files by the
//     builder's constants — change the VO, re-measure, re-render.
//
//  2. Everything that is not the product itself wears the flat-vector look:
//     deep navy ground, floating soft shapes, grain, rounded type, long
//     eased motion. The two product beats (score card, measure pass) stay
//     exactly as the product draws them — the ad may not restyle the thing
//     it is advertising.
//
//  3. The story is a real use of the product: someone with acne and a
//     bloated face asks Max for help, gets a plan and products with Google
//     links (the same links the app now renders), and eight weeks later the
//     chart ends at their cleared, healthier face. Both actor photos are
//     AI-generated and tagged as such on screen, per
//     docs/AI_ACTOR_CONTENT_STRATEGY.md. Never presented as a customer.
// ---------------------------------------------------------------------------

export interface Cta2Beat {
  id: "score" | "measure" | "chat" | "plan" | "progress" | "linkbio" | "search";
  start: number;
  end: number;
}

// Measured segment durations (seconds) + a 0.18s breath between phrases.
// progress carries an extra 1.6s visual hold (the glow-up needs a beat of
// silence to land); search holds the endcard to the end.
export const CTA2_BEATS: readonly Cta2Beat[] = [
  { id: "score", start: 0.0, end: 2.53 },
  { id: "measure", start: 2.53, end: 5.4 },
  { id: "chat", start: 5.4, end: 11.93 },
  { id: "plan", start: 11.93, end: 17.75 },
  { id: "progress", start: 17.75, end: 21.88 },
  { id: "linkbio", start: 21.88, end: 23.86 },
  { id: "search", start: 23.86, end: 30.0 },
];

export const CTA2_SECONDS = 30;

/** Where each VO segment is mixed in: at its beat's start. */
export const CTA2_VO_STARTS: readonly number[] = CTA2_BEATS.map((b) => b.start);

const INK = "#f4f2ec";
const MINT = "#2f9e73";
const MINT_BRIGHT = "#79e8d2";
const MUT = "rgba(244,242,236,0.6)";
const NAVY = "#0d1626";
const NAVY_HI = "#16233b";
const PINK = "#fe2c55";

const SERIF = '"Fraunces Variable", Fraunces, Georgia, serif';
const SANS = '"Inter Variable", Inter, system-ui, sans-serif';
const MONO = '"SF Mono", ui-monospace, Menlo, monospace';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const seg = (local: number, a: number, b: number) => easeOutCubic(clamp01((local - a) / (b - a)));

export interface Cta2Assets extends CtaAssets {
  /** The AI actor with acne and a bloated face — the chat's attached photo. */
  actorBefore: CanvasImageSource & { width: number; height: number };
  /** The same actor at week 8: clear, rested, defined. */
  actorAfter: CanvasImageSource & { width: number; height: number };
  /** Frame of the teacher-Max clip at `local` seconds, if exploded. */
  teacherFrame: (local: number) => CanvasImageSource | null;
  /** Frame of the jump-clap celebration clip at `local` seconds. */
  celebrateFrame: (local: number) => CanvasImageSource | null;
  /** The cartoon person holding a blank phone, for the link-in-bio beat. */
  linkbioPerson: (CanvasImageSource & { width: number; height: number }) | null;
  /**
   * The blank screen's rect inside linkbioPerson, normalized 0..1, plus its
   * tilt in degrees — measured once from the generated still.
   */
  linkbioScreen: { x: number; y: number; w: number; h: number; rot: number };
  /** Real product-class recommendations, verbatim from recommendations.ts. */
  products: Array<{ title: string; what: string }>;
}

// --- the Kurzgesagt ground --------------------------------------------------
//
// Deep navy, a soft radial lift, slow-drifting translucent blobs, and a
// static grain layer. The blobs' positions come from a fixed table rather
// than any RNG — determinism is the whole contract.

const BLOBS = [
  { x: 0.12, y: 0.18, r: 0.16, s: 0.9, a: 0.05 },
  { x: 0.85, y: 0.12, r: 0.1, s: 1.3, a: 0.045 },
  { x: 0.9, y: 0.55, r: 0.2, s: 0.7, a: 0.04 },
  { x: 0.08, y: 0.66, r: 0.12, s: 1.1, a: 0.05 },
  { x: 0.5, y: 0.9, r: 0.22, s: 0.8, a: 0.035 },
  { x: 0.3, y: 0.4, r: 0.07, s: 1.6, a: 0.06 },
  { x: 0.72, y: 0.82, r: 0.09, s: 1.2, a: 0.055 },
];

let grainCache: HTMLCanvasElement | null = null;
function grain(): HTMLCanvasElement {
  if (grainCache) return grainCache;
  // A fixed LCG, so the grain is the same speckle on every build.
  const c = document.createElement("canvas");
  c.width = 270;
  c.height = 480;
  const g = c.getContext("2d")!;
  let state = 48271;
  const next = () => (state = (state * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(255,255,255,${0.02 + next() * 0.05})`;
    g.fillRect(Math.floor(next() * 270), Math.floor(next() * 480), 1, 1);
  }
  grainCache = c;
  return c;
}

function ground(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, w, h);
  const lift = ctx.createRadialGradient(w / 2, h * 0.38, 80, w / 2, h * 0.38, h * 0.75);
  lift.addColorStop(0, "rgba(47,90,158,0.16)");
  lift.addColorStop(1, "rgba(47,90,158,0)");
  ctx.fillStyle = lift;
  ctx.fillRect(0, 0, w, h);
  for (const b of BLOBS) {
    const drift = Math.sin(t * 0.4 * b.s + b.x * 7) * 0.012;
    const bx = (b.x + drift) * w;
    const by = (b.y + Math.cos(t * 0.3 * b.s + b.y * 9) * 0.01) * h;
    const grad = ctx.createRadialGradient(bx, by, 0, bx, by, b.r * w);
    grad.addColorStop(0, `rgba(121,232,210,${b.a})`);
    grad.addColorStop(1, "rgba(121,232,210,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(bx - b.r * w, by - b.r * w, b.r * w * 2, b.r * w * 2);
  }
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.drawImage(grain(), 0, 0, w, h);
  ctx.restore();
}

// --- shared bits ------------------------------------------------------------

function roundImage(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource & { width: number; height: number },
  x: number,
  y: number,
  dw: number,
  dh: number,
  r: number,
): void {
  const scale = Math.max(dw / img.width, dh / img.height);
  const sw = dw / scale;
  const sh = dh / scale;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, dw, dh, r);
  ctx.clip();
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) * 0.35, sw, sh, x, y, dw, dh);
  ctx.restore();
}

function aiTag(ctx: CanvasRenderingContext2D, x: number, y: number, u: number): void {
  ctx.save();
  ctx.font = `600 ${Math.round(17 * u)}px ${MONO}`;
  const text = "AI-GENERATED DEMONSTRATION";
  const tw = ctx.measureText(text).width + 18 * u;
  ctx.fillStyle = "rgba(0,0,0,0.62)";
  ctx.beginPath();
  ctx.roundRect(x, y, tw, 26 * u, 6 * u);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + 9 * u, y + 13.5 * u);
  ctx.restore();
}

const CHAT_PLAN = [
  "Here's your 8-week plan:",
  "Gentle cleanser + adapalene, nightly",
  "SPF 30 every morning",
  "Less late-night sodium, earlier sleep",
];

// --- beat 3: the chat -------------------------------------------------------

function drawChat(ctx: CanvasRenderingContext2D, w: number, h: number, local: number, a: Cta2Assets): void {
  const u = w / 1080;
  ground(ctx, w, h, local);

  ctx.textAlign = "center";
  ctx.save();
  ctx.globalAlpha = seg(local, 0.05, 0.45);
  ctx.fillStyle = MUT;
  ctx.font = `600 ${Math.round(26 * u)}px ${MONO}`;
  ctx.fillText("C O A C H   M A X", w / 2, h * 0.09);
  ctx.restore();

  // The person's message, photo attached.
  const inP = seg(local, 0.15, 0.6);
  if (inP > 0) {
    const bw = w * 0.72;
    const bx = w * 0.94 - bw + (1 - inP) * 60 * u;
    const by = h * 0.13;
    ctx.save();
    ctx.globalAlpha = inP;
    ctx.fillStyle = "rgba(47,158,115,0.92)";
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, 96 * u, 26 * u);
    ctx.fill();
    ctx.fillStyle = "#06231a";
    ctx.font = `500 ${Math.round(30 * u)}px ${SANS}`;
    ctx.textAlign = "left";
    const msg = "Please help me get rid of my acne and debloat";
    const typed = Math.floor(seg(local, 0.3, 1.5) * msg.length);
    ctx.fillText(msg.slice(0, typed), bx + 28 * u, by + 58 * u);
    ctx.restore();

    // The attached photo.
    const pIn = seg(local, 0.7, 1.2);
    if (pIn > 0) {
      const pw2 = w * 0.42;
      const ph2 = pw2 * 1.25;
      const px = w * 0.94 - pw2;
      const py = by + 120 * u + (1 - pIn) * 40 * u;
      ctx.save();
      ctx.globalAlpha = pIn;
      roundImage(ctx, a.actorBefore, px, py, pw2, ph2, 22 * u);
      aiTag(ctx, px + 12 * u, py + ph2 - 38 * u, u);
      ctx.restore();
    }
  }

  // Max types, then the plan arrives line by line.
  const replyIn = seg(local, 2.1, 2.5);
  if (replyIn > 0) {
    const bx = w * 0.06;
    const by = h * 0.52;
    const bw = w * 0.76;
    const lineH = 62 * u;
    const shown = CHAT_PLAN.map((_, i) => seg(local, 2.4 + i * 0.55, 2.9 + i * 0.55));
    const lines = shown.filter((s) => s > 0).length;
    const bh = 46 * u + Math.max(1, lines) * lineH;
    ctx.save();
    ctx.globalAlpha = replyIn;
    if (a.maxAvatar) ctx.drawImage(a.maxAvatar, bx, by - 100 * u, 84 * u, 84 * u);
    ctx.fillStyle = "rgba(255,255,255,0.96)";
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 26 * u);
    ctx.fill();
    ctx.textAlign = "left";
    for (let i = 0; i < CHAT_PLAN.length; i++) {
      if (shown[i] <= 0) continue;
      const text = CHAT_PLAN[i];
      const typed = Math.floor(clamp01((local - (2.4 + i * 0.55)) / 0.5) * text.length);
      ctx.fillStyle = i === 0 ? "#101418" : "rgba(16,20,24,0.75)";
      ctx.font = i === 0 ? `600 ${Math.round(30 * u)}px ${SANS}` : `500 ${Math.round(27 * u)}px ${SANS}`;
      const prefix = i === 0 ? "" : "•  ";
      ctx.fillText(prefix + text.slice(0, typed), bx + 30 * u, by + 60 * u + i * lineH);
    }
    ctx.restore();
  }

  // The products, with the same "Find on Google" the app renders.
  const prodIn = seg(local, 4.5, 5.1);
  if (prodIn > 0) {
    const n = Math.min(3, a.products.length);
    const cw = w * 0.283;
    const gap = w * 0.024;
    const x0 = (w - (cw * n + gap * (n - 1))) / 2;
    const y = h * 0.79 + (1 - prodIn) * 60 * u;
    ctx.save();
    ctx.globalAlpha = prodIn;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * (cw + gap);
      ctx.fillStyle = NAVY_HI;
      ctx.strokeStyle = "rgba(121,232,210,0.25)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x, y, cw, 150 * u, 18 * u);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.textAlign = "left";
      ctx.font = `600 ${Math.round(25 * u)}px ${SANS}`;
      ctx.fillText(a.products[i].title, x + 18 * u, y + 44 * u, cw - 36 * u);
      ctx.fillStyle = MINT_BRIGHT;
      ctx.font = `600 ${Math.round(21 * u)}px ${SANS}`;
      ctx.fillText("Find it on Google ↗", x + 18 * u, y + 116 * u);
    }
    ctx.restore();
  }
  ctx.textAlign = "center";
}

// --- beat 4: the plan, taught -----------------------------------------------

// `a` is gone from the body with teacher Max, and stays in the signature so
// every beat renderer is called the same way by the dispatcher below.
function drawPlan(ctx: CanvasRenderingContext2D, w: number, h: number, local: number, _a: Cta2Assets): void {
  const u = w / 1080;
  ground(ctx, w, h, local + 7);

  // The plan card glides in and takes the frame. It used to be 44% of the
  // width with teacher Max in a panel beside it; with him gone the card has
  // the room, and the beat is about what the plan SAYS.
  const inP = seg(local, 0, 0.7);
  const px = w * 0.08 - (1 - inP) * w * 0.3;
  const pw2 = w * 0.84;
  const py = h * 0.2;
  const ph2 = h * 0.52;
  ctx.save();
  ctx.globalAlpha = inP;
  ctx.fillStyle = NAVY_HI;
  ctx.strokeStyle = "rgba(121,232,210,0.22)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(px, py, pw2, ph2, 26 * u);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.font = `300 ${Math.round(44 * u)}px ${SERIF}`;
  ctx.fillText("Your 8-week plan", px + 32 * u, py + 70 * u);
  // The rows the chat just promised, now scheduled.
  const ROWS = ["Adapalene 0.1% — nightly", "SPF 30 — every morning", "Sodium down, sleep earlier", "Rescan every week"];
  for (let i = 0; i < ROWS.length; i++) {
    const rp = seg(local, 0.5 + i * 0.2, 0.9 + i * 0.2);
    if (rp <= 0) continue;
    ctx.save();
    ctx.globalAlpha *= rp;
    ctx.fillStyle = MINT_BRIGHT;
    ctx.beginPath();
    ctx.arc(px + 44 * u, py + (120 + i * 52) * u, 5 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(244,242,236,0.82)";
    ctx.font = `500 ${Math.round(26 * u)}px ${SANS}`;
    ctx.fillText(ROWS[i], px + 66 * u, py + (129 + i * 52) * u, pw2 - 100 * u);
    ctx.restore();
  }
  // The week chart: bars stepping up, drawn on, no invented numbers — the
  // bars are the plan's weeks, not a measurement.
  const bars = 8;
  const bw2 = (pw2 - 90 * u) / bars;
  for (let i = 0; i < bars; i++) {
    const bp = seg(local, 0.6 + i * 0.12, 1.0 + i * 0.12);
    if (bp <= 0) continue;
    const bh2 = (40 + i * 26) * u * bp;
    ctx.fillStyle = i === bars - 1 ? MINT_BRIGHT : "rgba(121,232,210,0.4)";
    ctx.beginPath();
    ctx.roundRect(px + 40 * u + i * bw2 + 6 * u, py + ph2 - 60 * u - bh2, bw2 - 12 * u, bh2, 8 * u);
    ctx.fill();
  }
  ctx.fillStyle = MUT;
  ctx.font = `600 ${Math.round(20 * u)}px ${MONO}`;
  ctx.fillText("WEEK 1", px + 40 * u, py + ph2 - 24 * u);
  ctx.textAlign = "right";
  ctx.fillText("WEEK 8", px + pw2 - 40 * u, py + ph2 - 24 * u);
  ctx.restore();

  // No Max here any more.
  //
  // He was cropped out of a clip into a panel on the right, pointing at the
  // plan card on the left. Removed at the owner's call: the clip framing
  // never read as well as the flat-vector beats around it, and the pointer
  // he holds was not even visible on his first entrance. The plan card takes
  // the width he was using — the beat is about what the plan SAYS, and a
  // card at nearly full width is more of it on screen for longer.

  // The three pillars, pinned to the plan card he is pointing at.
  const PILLS = ["PRODUCT", "DIET", "LIFESTYLE"];
  ctx.textAlign = "center";
  for (let i = 0; i < PILLS.length; i++) {
    const pp = seg(local, 2.0 + i * 0.45, 2.45 + i * 0.45);
    if (pp <= 0) continue;
    const x = px + pw2 * (0.22 + i * 0.28);
    const y = py + ph2 + 70 * u - pp * 16 * u;
    ctx.save();
    ctx.globalAlpha = pp;
    ctx.font = `600 ${Math.round(24 * u)}px ${MONO}`;
    const tw = ctx.measureText(PILLS[i]).width + 44 * u;
    ctx.fillStyle = "rgba(121,232,210,0.14)";
    ctx.strokeStyle = "rgba(121,232,210,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x - tw / 2, y - 26 * u, tw, 52 * u, 26 * u);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = MINT_BRIGHT;
    ctx.textBaseline = "middle";
    ctx.fillText(PILLS[i], x, y + 2 * u);
    ctx.restore();
  }
  ctx.textBaseline = "alphabetic";
}

/**
 * The eight-week trend, as a fraction of the chart's height at each week.
 *
 * Exported with its interpolator because the smoothness of this line is the
 * thing that was wrong with the beat, and a number that only exists inside a
 * draw call cannot be tested. See the note at the draw site.
 */
export const WEEK_TREND: readonly number[] = [0, 0.05, 0.11, 0.2, 0.31, 0.45, 0.62, 0.82, 1];

/** The trend at a fractional week, linearly between its own points. */
export function weekTrendAt(f: number): number {
  const last = WEEK_TREND.length - 1;
  const c = Math.max(0, Math.min(last, f));
  const i = Math.min(last - 1, Math.floor(c));
  return WEEK_TREND[i]! + (WEEK_TREND[i + 1]! - WEEK_TREND[i]!) * (c - i);
}

// --- beat 5: the progress, swiped up ----------------------------------------

function drawProgress2(ctx: CanvasRenderingContext2D, w: number, h: number, local: number, a: Cta2Assets): void {
  const u = w / 1080;
  // The swipe: the whole scene arrives from below in the first half-second.
  const swipe = seg(local, 0, 0.5);
  ctx.save();
  ctx.translate(0, (1 - swipe) * h);
  ground(ctx, w, h, local + 13);

  ctx.textAlign = "center";
  ctx.save();
  ctx.globalAlpha = seg(local, 0.3, 0.8);
  ctx.fillStyle = INK;
  ctx.font = `300 ${Math.round(58 * u)}px ${SERIF}`;
  ctx.fillText("Tracked, week by week", w / 2, h * 0.14);
  ctx.restore();

  // The chart, with the same person at both ends of it.
  const x0 = w * 0.16;
  const x1 = w * 0.84;
  const yBase = h * 0.62;
  const yTop = h * 0.34;
  const grow = seg(local, 0.55, 2.3);
  // Faint week gridlines under the trend, so the chart reads as a chart.
  ctx.strokeStyle = "rgba(244,242,236,0.09)";
  ctx.lineWidth = 2;
  for (let k = 0; k <= 8; k++) {
    const gx = x0 + ((x1 - x0) * k) / 8;
    ctx.beginPath();
    ctx.moveTo(gx, yTop - 40 * u);
    ctx.lineTo(gx, yBase + 20 * u);
    ctx.stroke();
  }
  // The trend. Reported as not smooth, and it was not, for two reasons that
  // both live in this loop.
  //
  //  1. It grew a WHOLE WEEK at a time. `k <= steps * grow` only admits a new
  //     point when steps*grow crosses an integer, so over the beat the line
  //     jumped forward eight times instead of extending. The dot was worse:
  //     its x was the continuous position and its y was WOB[floor(...)], so it
  //     slid along flat and then snapped up.
  //
  //  2. Complete, it was eight straight segments with visible corners at every
  //     week — a chart of a plan, drawn like a sawtooth.
  //
  // Sampled finely and drawn through a lerp of the same eight values now: the
  // shape is unchanged, the corners and the stutter are gone, and the head of
  // the line is wherever the clock actually is.
  const steps = WEEK_TREND.length - 1;
  const pointAt = (f: number): [number, number] => [
    x0 + ((x1 - x0) * f) / steps,
    yBase - (yBase - yTop) * weekTrendAt(f),
  ];
  const head = steps * grow;
  ctx.strokeStyle = MINT_BRIGHT;
  ctx.lineWidth = 6 * u;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  // A twentieth of a week per sample: finer than a pixel at this width, so the
  // polyline reads as a curve without needing a spline through the points.
  const SAMPLE = 0.05;
  for (let f = 0; f <= head + 1e-9; f = Math.min(head, f + SAMPLE)) {
    const [fx, fy] = pointAt(f);
    if (f === 0) ctx.moveTo(fx, fy);
    else ctx.lineTo(fx, fy);
    if (f >= head) break;
  }
  ctx.stroke();
  // The head of the line, on the line rather than near it.
  if (grow > 0) {
    const [fx, fy] = pointAt(head);
    ctx.fillStyle = MINT_BRIGHT;
    ctx.beginPath();
    ctx.arc(fx, Math.max(yTop, fy), 9 * u, 0, Math.PI * 2);
    ctx.fill();
  }

  const thumb = 250 * u;
  roundImage(ctx, a.actorBefore, x0 - thumb * 0.3, yBase + 40 * u, thumb, thumb, 26 * u);
  aiTag(ctx, x0 - thumb * 0.3 + 10 * u, yBase + 40 * u + thumb - 36 * u, u * 0.8);
  ctx.fillStyle = MUT;
  ctx.font = `600 ${Math.round(24 * u)}px ${MONO}`;
  ctx.fillText("WEEK 1", x0 - thumb * 0.3 + thumb / 2, yBase + 40 * u + thumb + 40 * u);

  if (grow > 0.96) {
    const ap = seg(local, 2.3, 2.8);
    ctx.save();
    ctx.globalAlpha = ap;
    const ax = x1 - thumb * 0.7;
    const ay = yTop - thumb - 60 * u;
    roundImage(ctx, a.actorAfter, ax, ay, thumb, thumb, 26 * u);
    ctx.strokeStyle = MINT_BRIGHT;
    ctx.lineWidth = 4 * u;
    ctx.beginPath();
    ctx.roundRect(ax, ay, thumb, thumb, 26 * u);
    ctx.stroke();
    aiTag(ctx, ax + 10 * u, ay + thumb - 36 * u, u * 0.8);
    ctx.fillStyle = MINT_BRIGHT;
    ctx.font = `600 ${Math.round(24 * u)}px ${MONO}`;
    ctx.fillText("WEEK 8", ax + thumb / 2, ay + thumb + 40 * u);
    ctx.restore();
  }

  // No Max here either. Same call as the plan beat: the celebrate clip was
  // a cropped panel in the corner competing with the one thing this beat is
  // for, which is the week-one face becoming the week-eight face.
  ctx.restore();
}

// --- beat 6: link in bio ----------------------------------------------------

function drawLinkBio2(ctx: CanvasRenderingContext2D, w: number, h: number, local: number, a: Cta2Assets): void {
  const u = w / 1080;
  ground(ctx, w, h, local + 21);
  if (!a.linkbioPerson) {
    // Asset missing: say the line plainly rather than drawing a broken phone.
    ctx.textAlign = "center";
    ctx.fillStyle = INK;
    ctx.font = `300 ${Math.round(74 * u)}px ${SERIF}`;
    ctx.fillText("Link in bio", w / 2, h * 0.5);
    return;
  }
  const img = a.linkbioPerson;
  const scale = Math.max(w / img.width, h / img.height) * (1 + 0.03 * clamp01(local / 2));
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = (w - dw) / 2;
  const dy = (h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);

  // The profile, drawn INTO the blank screen. TikTok-flavoured — dark
  // ground, pink follow — without pretending to be the real app.
  const s = a.linkbioScreen;
  const sx = dx + s.x * dw;
  const sy = dy + s.y * dh;
  const sw = s.w * dw;
  const sh = s.h * dh;
  ctx.save();
  ctx.translate(sx + sw / 2, sy + sh / 2);
  ctx.rotate((s.rot * Math.PI) / 180);
  ctx.translate(-sw / 2, -sh / 2);
  ctx.beginPath();
  ctx.roundRect(0, 0, sw, sh, sw * 0.06);
  ctx.clip();
  ctx.fillStyle = "#101014";
  ctx.fillRect(0, 0, sw, sh);
  const su = sw / 460;
  // Avatar + handle.
  if (a.mark) ctx.drawImage(a.mark, sw / 2 - 44 * su, 26 * su, 88 * su, 88 * su);
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.font = `600 ${Math.round(30 * su)}px ${SANS}`;
  ctx.fillText("@truemax", sw / 2, 152 * su);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = `500 ${Math.round(21 * su)}px ${SANS}`;
  ctx.fillText("Facial analysis that shows the math", sw / 2, 190 * su);
  // The bio link — the subject of the sentence, so it glows.
  const linkP = 0.75 + 0.25 * Math.sin(local * 5);
  ctx.fillStyle = `rgba(121,232,210,${0.75 + 0.2 * linkP})`;
  ctx.font = `600 ${Math.round(24 * su)}px ${MONO}`;
  ctx.fillText("truemax.app", sw / 2, 230 * su);
  // Follow — pink, then pressed. Sat just above the drawn finger's tip, so
  // the person in the still is the one doing the tapping.
  const tapped = local > 1.15;
  const press = seg(local, 1.15, 1.3) * (1 - seg(local, 1.35, 1.55));
  const followY = sh * 0.7;
  ctx.save();
  ctx.translate(sw * 0.46, followY);
  ctx.scale(1 - press * 0.08, 1 - press * 0.08);
  ctx.fillStyle = tapped ? "#1c1c22" : PINK;
  ctx.beginPath();
  ctx.roundRect(-110 * su, -30 * su, 220 * su, 60 * su, 12 * su);
  ctx.fill();
  if (tapped) {
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.fillStyle = "#ffffff";
  ctx.font = `600 ${Math.round(26 * su)}px ${SANS}`;
  ctx.textBaseline = "middle";
  ctx.fillText(tapped ? "Following" : "Follow", 0, 2 * su);
  ctx.textBaseline = "alphabetic";
  ctx.restore();
  // The made-videos grid: our own renders as thumbnails, ending above the
  // follow button so the finger never gets painted over.
  const gy = sh * 0.33;
  const cell = (sw - 16 * su) / 3;
  const thumbs: Array<CanvasImageSource & { width: number; height: number }> = [
    a.scoreCard, a.photo, a.actorAfter, a.scoreCard, a.photo, a.actorBefore,
  ];
  for (let i = 0; i < 6; i++) {
    const cx2 = 4 * su + (i % 3) * (cell + 4 * su);
    const cy2 = gy + Math.floor(i / 3) * (cell * 1.1 + 4 * su);
    roundImage(ctx, thumbs[i], cx2, cy2, cell, cell * 1.1, 6 * su);
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.font = `600 ${Math.round(16 * su)}px ${SANS}`;
    ctx.textAlign = "left";
    ctx.fillText("▶ " + ["312k", "1.1M", "87k", "428k", "96k", "204k"][i], cx2 + 8 * su, cy2 + cell * 1.1 - 10 * su);
  }
  // The grid's counts are set dressing on a drawn mock, not analytics; the
  // demo tag says so.
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.font = `600 ${Math.round(15 * su)}px ${MONO}`;
  ctx.fillText("SIMULATED PROFILE", sw / 2, 24 * su);
  ctx.restore();

  // The tap ripple over the follow button, in screen space.
  const rip = seg(local, 1.2, 1.7);
  if (rip > 0 && rip < 1) {
    ctx.save();
    ctx.translate(sx + sw / 2, sy + sh / 2);
    ctx.rotate((s.rot * Math.PI) / 180);
    ctx.translate(-sw / 2, -sh / 2);
    const su = sw / 460;
    ctx.globalAlpha = 1 - rip;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(sw * 0.46, sh * 0.7, 30 * su + rip * 70 * su, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// --- beat 7: search + endcard -----------------------------------------------

function drawSearch2(ctx: CanvasRenderingContext2D, w: number, h: number, local: number, a: Cta2Assets): void {
  const u = w / 1080;
  ground(ctx, w, h, local + 27);

  // Phase 1: the bar, the typing, the arrow, the click.
  const CLICK = 2.55;
  const toEnd = seg(local, CLICK + 0.35, CLICK + 0.7);
  if (toEnd < 1) {
    ctx.save();
    ctx.globalAlpha = 1 - toEnd;
    const bw = w * 0.84;
    const bh = 110 * u;
    const bx = (w - bw) / 2;
    const by = h * 0.44 - (toEnd * h * 0.1);
    const inP = seg(local, 0.05, 0.5);
    ctx.globalAlpha *= inP;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, bh / 2);
    ctx.fill();
    // The query types itself.
    const q = "www.truemax.app";
    const typed = Math.floor(seg(local, 0.4, 1.9) * q.length);
    ctx.fillStyle = "#14181d";
    ctx.font = `500 ${Math.round(40 * u)}px ${SANS}`;
    ctx.textAlign = "left";
    ctx.fillText(q.slice(0, typed) + (local % 0.8 < 0.4 && typed < q.length ? "|" : ""), bx + 54 * u, by + 68 * u);
    // The magnifier stays decoration; the ARROW is the button.
    const press = seg(local, CLICK, CLICK + 0.12) * (1 - seg(local, CLICK + 0.16, CLICK + 0.4));
    const clicked = local >= CLICK + 0.05;
    ctx.save();
    ctx.translate(bx + bw - bh / 2, by + bh / 2);
    ctx.scale(1 - press * 0.12, 1 - press * 0.12);
    ctx.fillStyle = clicked ? "#37b585" : MINT;
    ctx.beginPath();
    ctx.arc(0, 0, bh * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 6 * u;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-10 * u, 0);
    ctx.lineTo(12 * u, 0);
    ctx.moveTo(3 * u, -10 * u);
    ctx.lineTo(12 * u, 0);
    ctx.lineTo(3 * u, 10 * u);
    ctx.stroke();
    ctx.restore();
    // Click ripple off the arrow.
    const rip = seg(local, CLICK + 0.05, CLICK + 0.55);
    if (rip > 0 && rip < 1) {
      ctx.save();
      ctx.globalAlpha *= 1 - rip;
      ctx.strokeStyle = MINT_BRIGHT;
      ctx.lineWidth = 4 * u;
      ctx.beginPath();
      ctx.arc(bx + bw - bh / 2, by + bh / 2, bh * 0.36 + rip * 90 * u, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // The cursor rides in and clicks the arrow.
    const cIn = seg(local, 1.5, CLICK);
    if (cIn > 0) {
      const cx2 = w * 0.82 - (w * 0.82 - (bx + bw - bh / 2 + 8 * u)) * cIn;
      const cy2 = h * 0.72 - (h * 0.72 - (by + bh / 2 + 10 * u)) * cIn;
      const dip = 1 + 0.14 * press;
      ctx.save();
      ctx.translate(cx2, cy2);
      ctx.scale(dip * u, dip * u);
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "rgba(6,10,14,0.85)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 46);
      ctx.lineTo(11, 36);
      ctx.lineTo(19, 54);
      ctx.lineTo(27, 50);
      ctx.lineTo(19, 33);
      ctx.lineTo(33, 32);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  // Phase 2: the endcard, logo top-centre, held to the end.
  const endIn = seg(local, CLICK + 0.75, CLICK + 1.35);
  if (endIn > 0) {
    ctx.save();
    ctx.globalAlpha = endIn;
    ctx.textAlign = "center";
    if (a.mark) {
      const size = 150 * u * (0.85 + 0.15 * endIn);
      ctx.drawImage(a.mark, w / 2 - size / 2, h * 0.2 - size / 2 - (1 - endIn) * 30 * u, size, size);
    }
    ctx.fillStyle = INK;
    ctx.font = `300 ${Math.round(96 * u)}px ${SERIF}`;
    ctx.fillText("TrueMax", w / 2, h * 0.42);
    ctx.fillStyle = MINT_BRIGHT;
    ctx.font = `600 ${Math.round(40 * u)}px ${MONO}`;
    ctx.fillText("truemax.app", w / 2, h * 0.5);
    ctx.fillStyle = MUT;
    ctx.font = `500 ${Math.round(28 * u)}px ${SANS}`;
    ctx.fillText("Facial analysis that shows the actual math.", w / 2, h * 0.57);
    ctx.restore();
  }
}

// --- the frame --------------------------------------------------------------

export function drawCta2Frame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  a: Cta2Assets,
): void {
  ctx.save();
  const beat = CTA2_BEATS.find((b) => t >= b.start && t < b.end) ?? CTA2_BEATS[CTA2_BEATS.length - 1];
  const local = t - beat.start;
  switch (beat.id) {
    // The two product beats keep the product's own look — black ground,
    // real card, real constructions. The ad may not restyle the product.
    case "score":
      ctx.fillStyle = "#0d0f11";
      ctx.fillRect(0, 0, w, h);
      drawScore(ctx, w, h, local, a);
      break;
    case "measure":
      ctx.fillStyle = "#0d0f11";
      ctx.fillRect(0, 0, w, h);
      drawMeasure(ctx, w, h, local, beat.end - beat.start, a, { stillMeasureCamera: true });
      credit(ctx, w, h, a.credit);
      break;
    case "chat": drawChat(ctx, w, h, local, a); break;
    case "plan": drawPlan(ctx, w, h, local, a); break;
    case "progress": drawProgress2(ctx, w, h, local, a); break;
    case "linkbio": drawLinkBio2(ctx, w, h, local, a); break;
    case "search": drawSearch2(ctx, w, h, local, a); break;
  }
  ctx.restore();
}
