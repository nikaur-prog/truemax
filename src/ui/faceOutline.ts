import { FaceLandmarker } from "@mediapipe/tasks-vision";
import { SHAPE_MODEL } from "../engine/shapeModel.ts";
import { shapeSubset } from "../engine/shape.ts";
import type { Sex } from "../engine/types.ts";

// The idle outline in the capture frame is not decoration: it is the actual
// Procrustes mean shape of our male or female reference population. Switching
// the toggle morphs between the two average faces we measured, so the control
// shows you what it is about to compare you against.

// How far along the attractiveness axis the guide silhouette sits.
const IDEAL_SIGMA = 0.035;

const EDGE_SETS = () => [
  FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
  FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
  FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
  FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW,
  FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
  FaceLandmarker.FACE_LANDMARKS_LIPS,
];

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

// An average face should be bilaterally symmetric: individual asymmetries
// ought to cancel. With only ~10 female reference faces they do not, so the
// mean came out visibly crooked — uneven brows, a tilted mouth.
//
// Mirroring the shape and averaging each point with its mirror partner fixes
// that. The partner map is derived from the shape itself: after negating x,
// each point's counterpart is simply the nearest point, because the face is
// already close to symmetric.
function symmetrize(shape: number[]): number[] {
  const n = shape.length / 2;
  const partner = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const mx = -shape[2 * i];
    const my = shape[2 * i + 1];
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < n; j++) {
      const d = (shape[2 * j] - mx) ** 2 + (shape[2 * j + 1] - my) ** 2;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    // Reject a match too far away to be a genuine mirror counterpart
    partner[i] = bestD < 0.0025 ? best : -1;
  }

  // Only trust mutual matches: if i thinks j is its mirror but j disagrees,
  // one of them is being dragged out of place — which is what put a notch in
  // the jaw outline.
  for (let i = 0; i < n; i++) {
    const j = partner[i];
    if (j >= 0 && partner[j] !== i) partner[i] = -1;
  }

  const out = shape.slice();
  for (let i = 0; i < n; i++) {
    const j = partner[i];
    if (j < 0) continue;
    out[2 * i] = (shape[2 * i] - shape[2 * j]) / 2;
    out[2 * i + 1] = (shape[2 * i + 1] + shape[2 * j + 1]) / 2;
  }
  return out;
}

// Order each contour's connections into a continuous chain so it can be
// stroked as one path rather than a pile of disconnected segments.
type Loop = number[] & { closed?: boolean };
let LOOPS: Loop[] | null = null;
function contourLoops(): Loop[] {
  if (LOOPS) return LOOPS;
  const subset = shapeSubset();
  const index = new Map(subset.map((id, i) => [id, i]));
  const loops: Loop[] = [];
  for (const set of EDGE_SETS()) {
    const next = new Map<number, number>();
    for (const c of set) next.set(c.start, c.end);
    const seen = new Set<number>();
    for (const startId of next.keys()) {
      if (seen.has(startId)) continue;
      const chain: number[] = [];
      let cur: number | undefined = startId;
      while (cur !== undefined && !seen.has(cur)) {
        seen.add(cur);
        const i = index.get(cur);
        if (i !== undefined) chain.push(i);
        cur = next.get(cur);
      }
      // Rings (oval, eyes, lips) come back to their start; brows do not
      if (chain.length > 2) loops.push(Object.assign(chain, { closed: next.get(cur ?? -1) === startId || chain.length > 8 }));
    }
  }
  // The nose has no contour set of its own, and a guide face without one
  // looks unfinished
  const nose = [168, 6, 197, 195, 5, 4, 1].map((id) => index.get(id)).filter((i): i is number => i !== undefined);
  if (nose.length > 3) loops.push(Object.assign(nose, { closed: false }));
  const alar = [98, 2, 327].map((id) => index.get(id)).filter((i): i is number => i !== undefined);
  if (alar.length === 3) loops.push(Object.assign(alar, { closed: false }));

  LOOPS = loops;
  return loops;
}

export interface OutlineHandle {
  morphTo(sex: Sex): void;
  stop(): void;
}

export function mountFaceOutline(canvas: HTMLCanvasElement, initial: Sex): OutlineHandle {
  // The alignment guide should look like a face worth aiming at, not the
  // population average — an average plotted as raw points reads as a diagram.
  // Pushing the mean along the model's attractiveness axis gives an idealized
  // archetype from the same data: slimmer and more tapered for the female
  // reference, broader and squarer through the jaw for the male.
  const idealize = (m: { meanShape: number[]; axis: number[] } | null) =>
    m ? symmetrize(canonicalize(m.meanShape.map((v, i) => v + m.axis[i] * IDEAL_SIGMA))) : null;
  const male = idealize(SHAPE_MODEL.male);
  const female = idealize(SHAPE_MODEL.female);
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

  // Draw each contour as one smooth stroked path. Segment-by-segment lines
  // with a dot at every vertex look like a wireframe; a continuous curve
  // reads as a drawn silhouette.
  ctx.strokeStyle = "rgba(14,122,104,0.55)";
  ctx.lineWidth = 1.6;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const loop of contourLoops()) {
    ctx.beginPath();
    for (let k = 0; k < loop.length; k++) {
      const p = P(loop[k]);
      if (k === 0) ctx.moveTo(p.x, p.y);
      else {
        const prev = P(loop[k - 1]);
        ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + p.x) / 2, (prev.y + p.y) / 2);
      }
    }
    if (loop.closed) {
      const first = P(loop[0]);
      const last = P(loop[loop.length - 1]);
      ctx.quadraticCurveTo(last.x, last.y, first.x, first.y);
      ctx.closePath();
    }
    ctx.stroke();
  }
}
