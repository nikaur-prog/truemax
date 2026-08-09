import { FaceLandmarker } from "@mediapipe/tasks-vision";
import { SHAPE_MODEL } from "../engine/shapeModel.ts";
import { shapeSubset } from "../engine/shape.ts";
import type { Sex } from "../engine/types.ts";

// The idle outline in the capture frame is not decoration: it is the actual
// Procrustes mean shape of our male or female reference population. Switching
// the toggle morphs between the two average faces we measured, so the control
// shows you what it is about to compare you against.

const EDGE_SETS = () => [
  FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
  FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
  FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
  FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW,
  FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
  FaceLandmarker.FACE_LANDMARKS_LIPS,
];

// Connections between subset points, resolved once
let edges: Array<[number, number]> | null = null;
function subsetEdges(): Array<[number, number]> {
  if (edges) return edges;
  const subset = shapeSubset();
  const index = new Map(subset.map((id, i) => [id, i]));
  const out: Array<[number, number]> = [];
  for (const set of EDGE_SETS()) {
    for (const c of set) {
      const a = index.get(c.start);
      const b = index.get(c.end);
      if (a !== undefined && b !== undefined) out.push([a, b]);
    }
  }
  edges = out;
  return out;
}

// A Procrustes mean carries whatever orientation its alignment reference
// happened to have, which came out tilted. Rotate it upright using its own
// anatomy — eye line horizontal, chin below — so the average face reads as a
// face rather than a smear.
function canonicalize(shape: number[]): number[] {
  const subset = shapeSubset();
  const at = (id: number) => {
    const i = subset.indexOf(id);
    return i < 0 ? null : { x: shape[2 * i], y: shape[2 * i + 1] };
  };
  const r = at(33);
  const l = at(263);
  const chin = at(152);
  if (!r || !l) return shape;

  const angle = Math.atan2(l.y - r.y, l.x - r.x);
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const out = new Array(shape.length);
  for (let i = 0; i < shape.length / 2; i++) {
    const x = shape[2 * i];
    const y = shape[2 * i + 1];
    out[2 * i] = x * cos - y * sin;
    out[2 * i + 1] = x * sin + y * cos;
  }
  // Screen space grows downward, so the chin must end up below the eyes
  if (chin) {
    const ci = subset.indexOf(152);
    const ri = subset.indexOf(33);
    if (out[2 * ci + 1] < out[2 * ri + 1]) {
      for (let i = 0; i < out.length; i++) out[i] = -out[i];
    }
  }
  return out;
}

export interface OutlineHandle {
  morphTo(sex: Sex): void;
  stop(): void;
}

export function mountFaceOutline(canvas: HTMLCanvasElement, initial: Sex): OutlineHandle {
  const male = SHAPE_MODEL.male ? canonicalize(SHAPE_MODEL.male.meanShape) : null;
  const female = SHAPE_MODEL.female ? canonicalize(SHAPE_MODEL.female.meanShape) : null;
  if (!male || !female) return { morphTo: () => {}, stop: () => {} };

  let from = initial === "female" ? female : male;
  let to = from;
  let t = 1;
  let raf = 0;
  let breathe = 0;

  const frame = () => {
    t = Math.min(1, t + 0.06);
    breathe += 0.012;
    const e = t < 1 ? 1 - Math.pow(1 - t, 3) : 1;
    draw(canvas, from, to, e, breathe);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    morphTo(sex: Sex) {
      const next = sex === "female" ? female : male;
      if (next === to) return;
      // Freeze the current interpolated pose as the new start
      from = blend(from, to, t < 1 ? 1 - Math.pow(1 - t, 3) : 1);
      to = next;
      t = 0;
    },
    stop() {
      cancelAnimationFrame(raf);
    },
  };
}

function blend(a: number[], b: number[], t: number): number[] {
  return a.map((v, i) => v + (b[i] - v) * t);
}

function draw(
  canvas: HTMLCanvasElement,
  from: number[],
  to: number[],
  t: number,
  breathe: number,
): void {
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const shape = blend(from, to, t);
  const n = shape.length / 2;

  // Procrustes space is centred and unit-scaled; fit it into the frame
  let maxR = 0;
  for (let i = 0; i < n; i++) maxR = Math.max(maxR, Math.hypot(shape[2 * i], shape[2 * i + 1]));
  const scale = (Math.min(w, h) * 0.42) / (maxR || 1);
  const cx = w / 2;
  const cy = h / 2;
  const pulse = 1 + Math.sin(breathe) * 0.006;
  const P = (i: number) => ({
    x: cx + shape[2 * i] * scale * pulse,
    y: cy + shape[2 * i + 1] * scale * pulse,
  });

  ctx.strokeStyle = "rgba(14,122,104,0.30)";
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  for (const [a, b] of subsetEdges()) {
    const pa = P(a);
    const pb = P(b);
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
  }
  ctx.stroke();

  ctx.fillStyle = "rgba(14,122,104,0.55)";
  for (let i = 0; i < n; i++) {
    const p = P(i);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
