import type { Pt } from "../engine/geometry.js";
import type { SidePoints } from "../engine/sideMetrics.js";
import type { ScoredMetric } from "../engine/types.js";
import type { OverlayFade } from "./measureOverlay.js";

// ---------------------------------------------------------------------------
// Side-profile measurement overlays — the profile's answer to measureOverlay.
//
// The front draws every measurement on the face when you hover its row; that is
// the credibility feature, a number in a table turned into a line across the
// photograph. The side had none of it: thirteen dots and a list. So the profile
// read as less serious than the front when it is measuring the harder, more
// decisive things — chin projection, gonial angle, facial convexity.
//
// This draws each side metric's real construction on the profile photo, in that
// photo's own pixel space (the thirteen points are already stored in pixels).
// A span is the two points a ratio compares; an angle is the vertex it opens at;
// a drop is a perpendicular onto a reference line, which is how projection and
// every E-line offset are actually defined. Nothing is invented — each recipe is
// the same geometry computeSideMetrics() uses, drawn instead of summed.
// ---------------------------------------------------------------------------

const ACCENT = "#FFFFFF";
const WARM = "rgba(255,255,255,0.5)";

type Prim =
  | { kind: "span"; a: Pt; b: Pt; label?: string; color?: string }
  | { kind: "angle"; v: Pt; a: Pt; b: Pt; label?: string }
  // Perpendicular from p onto the line la→lb (the reference), with the offset
  // segment carrying the label. This is projection and the Ricketts E-line.
  | { kind: "drop"; p: Pt; la: Pt; lb: Pt; label?: string }
  // A measured span plus a dashed vertical through one end, for the two metrics
  // read against true vertical (mandibular plane, forehead slope).
  | { kind: "vref"; a: Pt; b: Pt; through: Pt; label?: string };

function fmt(m: ScoredMetric): string {
  return `${m.value.toFixed(m.def.decimals ?? 1)}${m.def.unit ?? ""}`;
}

// Below-point helper for the submental-cervical vertical leg.
function below(p: Pt, len: number): Pt {
  return { x: p.x, y: p.y + len };
}

// Each recipe returns the primitives for one metric, given the verified points.
const RECIPES: Record<string, (p: SidePoints, m: ScoredMetric, span: number) => Prim[]> = {
  gonialAngle: (p, m) => [{ kind: "angle", v: p.gonion, a: p.condylion, b: p.menton, label: fmt(m) }],
  ramusMandible: (p, m) => [
    { kind: "span", a: p.condylion, b: p.gonion, color: WARM },
    { kind: "span", a: p.gonion, b: p.menton, label: fmt(m) },
  ],
  submentalCervical: (p, m, span) => [
    { kind: "angle", v: p.cervicale, a: p.menton, b: below(p.cervicale, span * 0.5), label: fmt(m) },
  ],
  mandibularPlane: (p, m) => [{ kind: "vref", a: p.gonion, b: p.menton, through: p.menton, label: fmt(m) }],
  chinProjection: (p, m) => [{ kind: "drop", p: p.pogonion, la: p.nasion, lb: p.subnasale, label: fmt(m) }],
  // The H angle opens at the chin, between the facial plane and the lip line,
  // so the vertex is pogonion and the two arms are the points that define them.
  chinRecession: (p, m) => [{ kind: "angle", v: p.pogonion, a: p.nasion, b: p.labialeSuperius, label: fmt(m) }],
  facialConvexity: (p, m) => [{ kind: "angle", v: p.subnasale, a: p.glabella, b: p.pogonion, label: fmt(m) }],
  totalFacialConvexity: (p, m) => [{ kind: "angle", v: p.pronasale, a: p.glabella, b: p.pogonion, label: fmt(m) }],
  nasofrontalAngle: (p, m) => [{ kind: "angle", v: p.nasion, a: p.glabella, b: p.pronasale, label: fmt(m) }],
  nasolabialAngle: (p, m) => [{ kind: "angle", v: p.subnasale, a: p.pronasale, b: p.labialeSuperius, label: fmt(m) }],
  nasalProjection: (p, m) => [{ kind: "drop", p: p.pronasale, la: p.nasion, lb: p.subnasale, label: fmt(m) }],
  upperLipELine: (p, m) => [{ kind: "drop", p: p.labialeSuperius, la: p.pronasale, lb: p.pogonion, label: fmt(m) }],
  lowerLipELine: (p, m) => [{ kind: "drop", p: p.labialeInferius, la: p.pronasale, lb: p.pogonion, label: fmt(m) }],
  lowerThirdDepth: (p, m) => [
    { kind: "span", a: p.nasion, b: p.menton, color: WARM },
    { kind: "span", a: p.subnasale, b: p.menton, label: fmt(m) },
  ],
  foreheadSlope: (p, m) => [{ kind: "vref", a: p.glabella, b: p.trichion, through: p.glabella, label: fmt(m) }],
  midfaceRatioSide: (p, m) => [{ kind: "span", a: p.tragion, b: p.pronasale, label: fmt(m) }],
};

export function hasSideOverlay(metricId: string): boolean {
  return metricId in RECIPES;
}

const DRAW_MS = 320;
const STAGGER = 0.45;
const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// Foot of the perpendicular from p onto the infinite line through a and b.
function foot(p: Pt, a: Pt, b: Pt): Pt {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy || 1e-6;
  const t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  return { x: a.x + vx * t, y: a.y + vy * t };
}

export function drawSideMeasurement(
  canvas: HTMLCanvasElement,
  points: SidePoints,
  w: number,
  h: number,
  metric: ScoredMetric,
  progress = 1,
): void {
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  const recipe = RECIPES[metric.def.id];
  if (!recipe) return;

  const lw = Math.max(1.4, w / 320);
  const fs = Math.max(10, w / 34);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const prims = recipe(points, metric, h);
  const share = 1 / Math.max(1, prims.length);
  const at = (i: number) => {
    if (progress >= 1) return 1;
    const s = i * share * STAGGER;
    return Math.max(0, Math.min(1, (progress - s) / (1 - s || 1)));
  };

  prims.forEach((prim, i) => {
    const u = ease(at(i));
    if (u <= 0) return;
    const done = u >= 0.999;
    const color = ("color" in prim && prim.color) || ACCENT;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lw;
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 5;

    if (prim.kind === "span") {
      const b = lerp(prim.a, prim.b, u);
      line(ctx, prim.a, b);
      if (done) {
        tick(ctx, prim.a, prim.b, lw);
        if (prim.label) labelPast(ctx, prim.label, prim.a, prim.b, fs, color);
      }
    } else if (prim.kind === "angle") {
      line(ctx, prim.v, lerp(prim.v, prim.a, u));
      line(ctx, prim.v, lerp(prim.v, prim.b, u));
      if (u > 0.55) arc(ctx, prim.v, prim.a, prim.b, w, (u - 0.55) / 0.45);
      if (prim.label && done) label(ctx, prim.label, prim.v, fs, color);
    } else if (prim.kind === "drop") {
      // Reference line first, faint; then the perpendicular carrying the number.
      ctx.strokeStyle = WARM;
      const refA = lerp(prim.la, prim.lb, 0.5 - 0.6 * u);
      const refB = lerp(prim.la, prim.lb, 0.5 + 0.6 * u);
      line(ctx, refA, refB);
      const f = foot(prim.p, prim.la, prim.lb);
      ctx.strokeStyle = color;
      line(ctx, f, lerp(f, prim.p, u));
      if (done) {
        tick(ctx, f, prim.p, lw);
        if (prim.label) labelPast(ctx, prim.label, f, prim.p, fs, color);
      }
    } else {
      // Measured span, plus a dashed true-vertical through one end.
      const b = lerp(prim.a, prim.b, u);
      line(ctx, prim.a, b);
      ctx.save();
      ctx.strokeStyle = WARM;
      ctx.setLineDash([lw * 3, lw * 3]);
      const vlen = h * 0.16 * u;
      line(ctx, { x: prim.through.x, y: prim.through.y - vlen }, { x: prim.through.x, y: prim.through.y + vlen });
      ctx.restore();
      if (prim.label && done) labelPast(ctx, prim.label, prim.a, prim.b, fs, color);
    }
  });
  ctx.shadowBlur = 0;
}

export function animateSideMeasurement(
  canvas: HTMLCanvasElement,
  points: SidePoints,
  w: number,
  h: number,
  metric: ScoredMetric,
): OverlayFade {
  let raf = 0;
  let start = 0;
  const frame = (now: number) => {
    if (!start) start = now;
    const t = Math.min(1, (now - start) / DRAW_MS);
    drawSideMeasurement(canvas, points, w, h, metric, t);
    if (t < 1) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return { cancel: () => cancelAnimationFrame(raf) };
}

// --- drawing primitives (pixel space) --------------------------------------

function line(ctx: CanvasRenderingContext2D, a: Pt, b: Pt): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function tick(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, lw: number): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * lw * 3;
  const ny = (dx / len) * lw * 3;
  line(ctx, { x: a.x - nx, y: a.y - ny }, { x: a.x + nx, y: a.y + ny });
  line(ctx, { x: b.x - nx, y: b.y - ny }, { x: b.x + nx, y: b.y + ny });
}

function arc(ctx: CanvasRenderingContext2D, v: Pt, a: Pt, b: Pt, w: number, u = 1): void {
  const r = w * 0.06;
  const a1 = Math.atan2(a.y - v.y, a.x - v.x);
  const a2 = Math.atan2(b.y - v.y, b.x - v.x);
  const lo = Math.min(a1, a2);
  const hi = Math.max(a1, a2);
  const t = Math.max(0, Math.min(1, u));
  ctx.beginPath();
  ctx.arc(v.x, v.y, r, lo, lo + (hi - lo) * t, Math.abs(a1 - a2) > Math.PI);
  ctx.stroke();
}

// A label sat just past the far end of a segment, so the face stays visible.
function labelPast(ctx: CanvasRenderingContext2D, text: string, a: Pt, b: Pt, fs: number, color: string): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  label(ctx, text, { x: b.x + (dx / len) * fs * 1.4, y: b.y + (dy / len) * fs * 1.4 }, fs, color);
}

function label(ctx: CanvasRenderingContext2D, text: string, at: Pt, fs: number, color: string): void {
  ctx.font = `600 ${fs}px Inter Variable, Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const tw = ctx.measureText(text).width + fs * 0.7;
  const th = fs * 1.5;
  ctx.shadowBlur = 6;
  ctx.fillStyle = "rgba(16,17,19,0.82)";
  roundRect(ctx, at.x - tw / 2, at.y - th / 2, tw, th, th / 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  ctx.fillText(text, at.x, at.y);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
