import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { LM } from "../engine/geometry.ts";
import type { ScoredMetric } from "../engine/types.ts";

// ---------------------------------------------------------------------------
// Measurement overlays: draw the actual measurement on the face.
//
// This is the credibility feature. A number in a table is a claim; the same
// number drawn across the cheekbones is evidence. Everything here is rendered
// in IMAGE space from the raw landmarks, so what the user sees is literally
// where the engine measured.
// ---------------------------------------------------------------------------

const ACCENT = "#8FF3E0";
const WARM = "#FFC98B";

type Seg =
  | { kind: "span"; a: number | Pt2; b: number | Pt2; label?: string; color?: string }
  | { kind: "angle"; v: number | Pt2; a: number | Pt2; b: number | Pt2; label?: string }
  | { kind: "rule"; y: number | Pt2; label?: string; color?: string }
  | { kind: "axis"; x: number | Pt2 };

interface Pt2 {
  x: number;
  y: number;
}

// Per-metric drawing recipe. Numbers are landmark indices; the renderer
// resolves them against the raw landmark list.
const RECIPES: Record<string, (m: ScoredMetric) => Seg[]> = {
  fwhr: (m) => [
    { kind: "span", a: LM.ZYGO_R, b: LM.ZYGO_L, label: `${m.value.toFixed(2)}×` },
    { kind: "span", a: mid(LM.EYE_R_TOP, LM.EYE_L_TOP), b: LM.LIP_TOP, color: WARM },
  ],
  jawCheekRatio: (m) => [
    { kind: "span", a: LM.ZYGO_R, b: LM.ZYGO_L, color: WARM },
    { kind: "span", a: LM.GONION_R, b: LM.GONION_L, label: `${m.value.toFixed(3)}` },
  ],
  gonialProxy: (m) => [
    { kind: "angle", v: LM.GONION_R, a: LM.JAW_MID_R, b: LM.MENTON, label: `${m.value.toFixed(1)}°` },
    { kind: "angle", v: LM.GONION_L, a: LM.JAW_MID_L, b: LM.MENTON },
  ],
  jawFrontalAngle: (m) => [
    { kind: "angle", v: LM.MENTON, a: LM.GONION_R, b: LM.GONION_L, label: `${m.value.toFixed(1)}°` },
  ],
  canthalTilt: (m) => [
    { kind: "span", a: LM.EYE_R_INNER, b: LM.EYE_R_OUTER, label: `${m.value.toFixed(1)}°` },
    { kind: "span", a: LM.EYE_L_INNER, b: LM.EYE_L_OUTER },
  ],
  browTilt: (m) => [
    { kind: "span", a: LM.BROW_R_MEDIAL, b: LM.BROW_R_LATERAL, label: `${m.value.toFixed(1)}°` },
    { kind: "span", a: LM.BROW_L_MEDIAL, b: LM.BROW_L_LATERAL },
  ],
  browPosition: (m) => [
    { kind: "span", a: LM.BROW_R_MID, b: LM.IRIS_R, label: `${m.value.toFixed(3)}` },
    { kind: "span", a: LM.BROW_L_MID, b: LM.IRIS_L },
  ],
  eyeAspectRatio: (m) => [
    { kind: "span", a: LM.EYE_R_TOP, b: LM.EYE_R_BOTTOM, label: `${m.value.toFixed(2)}` },
    { kind: "span", a: LM.EYE_R_OUTER, b: LM.EYE_R_INNER, color: WARM },
  ],
  eyeSeparationRatio: (m) => [
    { kind: "span", a: LM.IRIS_R, b: LM.IRIS_L, label: `${m.value.toFixed(3)}` },
    { kind: "span", a: LM.ZYGO_R, b: LM.ZYGO_L, color: WARM },
  ],
  intercanthalEyeWidth: (m) => [
    { kind: "span", a: LM.EYE_R_INNER, b: LM.EYE_L_INNER, label: `${m.value.toFixed(2)}×` },
    { kind: "span", a: LM.EYE_R_OUTER, b: LM.EYE_R_INNER, color: WARM },
  ],
  fifthsEyeRatio: (m) => [
    { kind: "span", a: LM.EYE_R_OUTER, b: LM.EYE_R_INNER, label: `${m.value.toFixed(3)}` },
    { kind: "span", a: LM.ZYGO_R, b: LM.ZYGO_L, color: WARM },
  ],
  noseMouthRatio: (m) => [
    { kind: "span", a: 98, b: 327, label: `${m.value.toFixed(2)}×` },
    { kind: "span", a: LM.MOUTH_R, b: LM.MOUTH_L, color: WARM },
  ],
  noseIntercanthal: (m) => [
    { kind: "span", a: 98, b: 327, label: `${m.value.toFixed(2)}×` },
    { kind: "span", a: LM.EYE_R_INNER, b: LM.EYE_L_INNER, color: WARM },
  ],
  nasalIndex: (m) => [
    { kind: "span", a: 98, b: 327, label: `${m.value.toFixed(2)}` },
    { kind: "span", a: LM.NASION, b: LM.SUBNASALE, color: WARM },
  ],
  mouthIPD: (m) => [
    { kind: "span", a: LM.MOUTH_R, b: LM.MOUTH_L, label: `${m.value.toFixed(2)}×` },
    { kind: "span", a: LM.IRIS_R, b: LM.IRIS_L, color: WARM },
  ],
  lipRatio: (m) => [
    { kind: "span", a: LM.LIP_TOP, b: LM.LIP_UPPER_INNER, color: WARM },
    { kind: "span", a: LM.LIP_LOWER_INNER, b: LM.LIP_BOTTOM, label: `${m.value.toFixed(2)}×` },
  ],
  lipHeightLowerThird: (m) => [
    { kind: "span", a: LM.LIP_TOP, b: LM.LIP_BOTTOM, label: `${m.value.toFixed(1)}%` },
    { kind: "span", a: LM.SUBNASALE, b: LM.MENTON, color: WARM },
  ],
  mouthCornerTilt: (m) => [
    { kind: "span", a: LM.MOUTH_R, b: LM.MOUTH_L, label: `${m.value.toFixed(1)}°` },
  ],
  philtrumChinRatio: (m) => [
    { kind: "span", a: LM.SUBNASALE, b: LM.LIP_TOP, color: WARM },
    { kind: "span", a: LM.LIP_LOWER_INNER, b: LM.MENTON, label: `${m.value.toFixed(2)}×` },
  ],
  chinHeightRatio: (m) => [
    { kind: "span", a: LM.LIP_LOWER_INNER, b: LM.MENTON, label: `${m.value.toFixed(2)}` },
    { kind: "span", a: LM.SUBNASALE, b: LM.MENTON, color: WARM },
  ],
  chinWidthRatio: (m) => [
    { kind: "span", a: LM.CHIN_SIDE_R, b: LM.CHIN_SIDE_L, label: `${m.value.toFixed(2)}` },
    { kind: "span", a: LM.GONION_R, b: LM.GONION_L, color: WARM },
  ],
  lowerFacePct: (m) => [
    { kind: "span", a: LM.SUBNASALE, b: LM.MENTON, label: `${m.value.toFixed(1)}%` },
    { kind: "span", a: LM.GLABELLA, b: LM.MENTON, color: WARM },
  ],
  topThirdEst: (m) => [
    { kind: "span", a: LM.FOREHEAD_TOP, b: LM.GLABELLA, label: `${m.value.toFixed(1)}%` },
    { kind: "span", a: LM.FOREHEAD_TOP, b: LM.MENTON, color: WARM },
  ],
  middleLowerBalance: (m) => [
    { kind: "span", a: LM.GLABELLA, b: LM.SUBNASALE, label: `${m.value.toFixed(2)}×` },
    { kind: "span", a: LM.SUBNASALE, b: LM.MENTON, color: WARM },
  ],
  facialIndex: (m) => [
    { kind: "span", a: LM.FOREHEAD_TOP, b: LM.MENTON, label: `${m.value.toFixed(2)}` },
    { kind: "span", a: LM.ZYGO_R, b: LM.ZYGO_L, color: WARM },
  ],
  midfaceRatio: (m) => [
    { kind: "span", a: LM.IRIS_R, b: LM.IRIS_L, label: `${m.value.toFixed(2)}` },
    { kind: "span", a: mid(LM.IRIS_R, LM.IRIS_L), b: LM.LIP_TOP, color: WARM },
  ],
  cheekboneHeight: (m) => [
    { kind: "rule", y: LM.ZYGO_R, label: `${m.value.toFixed(2)}` },
    { kind: "span", a: mid(LM.IRIS_R, LM.IRIS_L), b: LM.MENTON, color: WARM },
  ],
  midlineDeviation: (m) => [
    { kind: "axis", x: mid(LM.IRIS_R, LM.IRIS_L) },
    { kind: "span", a: LM.NOSE_TIP, b: LM.MENTON, label: `${m.value.toFixed(1)}%` },
  ],
  eyeMouthParallel: (m) => [
    { kind: "span", a: LM.IRIS_R, b: LM.IRIS_L, color: WARM },
    { kind: "span", a: LM.MOUTH_R, b: LM.MOUTH_L, label: `${m.value.toFixed(1)}°` },
  ],
  canthalAsymmetry: (m) => [
    { kind: "span", a: LM.EYE_R_INNER, b: LM.EYE_R_OUTER, label: `${m.value.toFixed(1)}°` },
    { kind: "span", a: LM.EYE_L_INNER, b: LM.EYE_L_OUTER, color: WARM },
  ],
  mirrorDeviation: (m) => [
    { kind: "axis", x: mid(LM.IRIS_R, LM.IRIS_L) },
    { kind: "span", a: LM.ZYGO_R, b: LM.ZYGO_L, label: `${m.value.toFixed(1)}%` },
  ],
};

// Marker for "midpoint of these two landmarks", resolved at draw time
function mid(a: number, b: number): Pt2 {
  return { x: -1 - a, y: -1 - b } as Pt2;
}
const isMidMarker = (p: Pt2) => p.x < 0 && p.y < 0;

export function hasOverlay(metricId: string): boolean {
  return metricId in RECIPES;
}

// Every measurement row is tappable, so every row has to draw something. Most
// have a bespoke recipe above; the rest — chiefly the side-profile metrics,
// whose points live in a different image entirely — fall back to lighting the
// landmarks their region is measured from, with the value called out.
//
// This is deliberately honest about being less specific: it shows WHERE the
// number comes from without pretending to draw a span it cannot locate in this
// photograph. A row that did nothing when tapped would be worse.
const REGION_FALLBACK: Record<string, number[]> = {
  eyes: [33, 133, 159, 145, 362, 263, 386, 374],
  midface: [234, 454, 116, 345, 50, 280],
  jaw: [58, 288, 172, 397, 136, 365, 152],
  chin: [152, 148, 377, 17, 18, 200],
  nose: [1, 4, 6, 168, 98, 327],
  lips: [61, 291, 0, 13, 14, 17],
  proportions: [10, 9, 2, 152, 234, 454],
  symmetry: [10, 168, 1, 152, 33, 263],
};

// Cross-fade from whatever is currently drawn to a new measurement.
//
// Hovering down a list of measurements snapped from one set of lines to the
// next, which reads as flicker rather than as the overlay following you. This
// renders both states offscreen and dissolves between them.
//
// It is a cross-fade rather than a draw-on animation because the lines are the
// evidence: growing or scaling them into place would mean showing geometry
// that is briefly WRONG, on the one feature whose whole job is to prove the
// number is real. Opacity is the only property that can change here without
// lying.
export interface OverlayFade {
  cancel(): void;
}

const FADE_MS = 240;

export function transitionMeasurement(
  canvas: HTMLCanvasElement,
  paintNext: (target: HTMLCanvasElement) => void,
): OverlayFade {
  const w = canvas.width || 1;
  const h = canvas.height || 1;

  const from = document.createElement("canvas");
  from.width = w;
  from.height = h;
  if (canvas.width && canvas.height) from.getContext("2d")!.drawImage(canvas, 0, 0);

  const to = document.createElement("canvas");
  to.width = w;
  to.height = h;
  paintNext(to);

  const ctx = canvas.getContext("2d")!;
  let raf = 0;
  let start = 0;
  const frame = (now: number) => {
    if (!start) start = now;
    const t = Math.min(1, (now - start) / FADE_MS);
    const e = 1 - Math.pow(1 - t, 3);
    // The canvas may have been resized by whatever painted `to`; match it back
    // so both layers land on the same grid.
    if (canvas.width !== to.width || canvas.height !== to.height) {
      canvas.width = to.width;
      canvas.height = to.height;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1 - e;
    ctx.drawImage(from, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = e;
    ctx.drawImage(to, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
    if (t < 1) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return { cancel: () => cancelAnimationFrame(raf) };
}

export function drawMeasurement(
  canvas: HTMLCanvasElement,
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
  metric: ScoredMetric,
): boolean {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, width, height);

  const recipe = RECIPES[metric.def.id];
  if (!recipe) {
    drawRegionFallback(ctx, landmarks, width, height, metric);
    return true;
  }

  const P = (ref: number | Pt2): Pt2 => {
    if (typeof ref === "number") {
      const l = landmarks[ref];
      return { x: l.x * width, y: l.y * height };
    }
    if (isMidMarker(ref)) {
      const a = P(-1 - ref.x);
      const b = P(-1 - ref.y);
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    return ref;
  };

  const lw = Math.max(1.4, width / 420);
  const fs = Math.max(9, width / 62);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const seg of recipe(metric)) {
    const color = ("color" in seg && seg.color) || ACCENT;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lw;
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 5;

    if (seg.kind === "span") {
      const a = P(seg.a);
      const b = P(seg.b);
      line(ctx, a, b);
      tick(ctx, a, b, lw);
      if (seg.label) {
        // Sit the label just past the line's end so the face stays visible
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        label(ctx, seg.label, { x: b.x + (dx / len) * fs * 1.6, y: b.y + (dy / len) * fs * 1.6 }, fs, color);
      }
    } else if (seg.kind === "angle") {
      const v = P(seg.v);
      const a = P(seg.a);
      const b = P(seg.b);
      line(ctx, v, a);
      line(ctx, v, b);
      arc(ctx, v, a, b, width);
      if (seg.label) label(ctx, seg.label, v, fs, color);
    } else if (seg.kind === "rule") {
      const p = P(seg.y);
      line(ctx, { x: 0, y: p.y }, { x: width, y: p.y });
      if (seg.label) label(ctx, seg.label, { x: width * 0.5, y: p.y }, fs, color);
    } else {
      const p = P(seg.x);
      ctx.setLineDash([lw * 3, lw * 3]);
      line(ctx, { x: p.x, y: 0 }, { x: p.x, y: height });
      ctx.setLineDash([]);
    }
  }
  ctx.shadowBlur = 0;
  return true;
}

function line(ctx: CanvasRenderingContext2D, a: Pt2, b: Pt2): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

// End caps, so a span reads as a measurement rather than a stray line
function tick(ctx: CanvasRenderingContext2D, a: Pt2, b: Pt2, lw: number): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * lw * 3;
  const ny = (dx / len) * lw * 3;
  line(ctx, { x: a.x - nx, y: a.y - ny }, { x: a.x + nx, y: a.y + ny });
  line(ctx, { x: b.x - nx, y: b.y - ny }, { x: b.x + nx, y: b.y + ny });
}

function arc(ctx: CanvasRenderingContext2D, v: Pt2, a: Pt2, b: Pt2, width: number): void {
  const r = width * 0.045;
  const a1 = Math.atan2(a.y - v.y, a.x - v.x);
  const a2 = Math.atan2(b.y - v.y, b.x - v.x);
  ctx.beginPath();
  ctx.arc(v.x, v.y, r, Math.min(a1, a2), Math.max(a1, a2), Math.abs(a1 - a2) > Math.PI);
  ctx.stroke();
}

function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  at: Pt2,
  fs: number,
  color: string,
): void {
  ctx.font = `600 ${fs}px Inter Variable, Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const w = ctx.measureText(text).width + fs * 0.7;
  const h = fs * 1.55;
  const y = at.y;
  ctx.shadowBlur = 6;
  ctx.fillStyle = "rgba(16,17,19,0.82)";
  roundRect(ctx, at.x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  ctx.fillText(text, at.x, y);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}


// Light the region a metric is measured from, and call out its value. Used for
// every metric with no bespoke span — notably the side-profile ones, whose
// thirteen points were placed on a different photograph and have no position
// in this one.
function drawRegionFallback(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
  metric: ScoredMetric,
): void {
  const ids = (REGION_FALLBACK[metric.def.region] ?? []).filter((i) => landmarks[i]);
  if (!ids.length) return;

  let cx = 0;
  let cy = 0;
  for (const i of ids) {
    cx += landmarks[i].x * width;
    cy += landmarks[i].y * height;
  }
  cx /= ids.length;
  cy /= ids.length;

  const r = Math.max(3, width / 150);
  ctx.save();
  ctx.shadowColor = ACCENT;
  ctx.shadowBlur = width / 90;
  ctx.fillStyle = ACCENT;
  for (const i of ids) {
    ctx.beginPath();
    ctx.arc(landmarks[i].x * width, landmarks[i].y * height, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  const dec = metric.def.decimals ?? 2;
  label(
    ctx,
    `${metric.value.toFixed(dec)}${metric.def.unit ?? ""}`,
    { x: cx, y: cy },
    Math.max(11, width / 34),
    ACCENT,
  );
}
