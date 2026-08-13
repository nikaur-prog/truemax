import { FaceLandmarker } from "@mediapipe/tasks-vision";
import { SHAPE_MODEL } from "../engine/shapeModel.js";
import { shapeSubset } from "../engine/shape.js";
import type { Sex } from "../engine/types.js";

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

// Mirror pairs for the face oval, taken from the ring's topology rather than
// from where its points happen to sit.
//
// The oval is a closed ring of 36 landmarks. Two of them lie on the midline —
// the crown and the chin — and they cut the ring into two arcs of equal length
// that run down opposite sides of the face. Step k of one arc is the mirror of
// step k of the other, by construction, whatever the underlying mean shape
// looks like. Nearest-neighbour matching gets the same answer for 34 of the 36
// and then fails on the two furthest from the midline, which is precisely where
// a mismatch shows: at the jaw.
//
// Returned as subset indices, so the result plugs straight into the shape
// vector. Empty if either midline landmark is missing from the subset.
let OVAL_PAIRS: Array<[number, number]> | null = null;
function ovalPairs(): Array<[number, number]> {
  if (OVAL_PAIRS) return OVAL_PAIRS;
  const subset = shapeSubset();
  const index = new Map(subset.map((id, i) => [id, i]));

  const next = new Map<number, number>();
  for (const c of FaceLandmarker.FACE_LANDMARKS_FACE_OVAL) next.set(c.start, c.end);
  const ring: number[] = [];
  const seen = new Set<number>();
  let cur: number | undefined = next.keys().next().value;
  while (cur !== undefined && !seen.has(cur)) {
    seen.add(cur);
    ring.push(cur);
    cur = next.get(cur);
  }

  // 10 is the crown, 152 the chin: MediaPipe's two midline oval landmarks.
  const top = ring.indexOf(10);
  const bottom = ring.indexOf(152);
  const pairs: Array<[number, number]> = [];
  // The midline points are their own mirror, and saying so is what pulls them
  // onto x = 0. Left to the nearest-neighbour search they matched something
  // else, failed the mutual check, and stayed where the raw mean put them —
  // the crown sat 4% of a face width off centre, which reads as a lean.
  for (const id of [10, 152]) {
    const i = index.get(id);
    if (i !== undefined) pairs.push([i, i]);
  }
  if (top >= 0 && bottom >= 0) {
    const n = ring.length;
    // Walk away from the crown in both directions at the same rate. The two
    // walks meet at the chin, and everything they pass on the way is a pair.
    for (let k = 1; ; k++) {
      const a = ring[(top + k) % n];
      const b = ring[(top - k + n * 2) % n];
      if (a === b || a === 152 || b === 152) break;
      const ia = index.get(a);
      const ib = index.get(b);
      if (ia !== undefined && ib !== undefined) pairs.push([ia, ib]);
    }
  }
  OVAL_PAIRS = pairs;
  return pairs;
}

// An average face should be bilaterally symmetric: individual asymmetries
// ought to cancel. With only ~10 female reference faces they do not, so the
// mean came out visibly crooked — uneven brows, a tilted mouth.
//
// Mirroring the shape and averaging each point with its mirror partner fixes
// that. The partner map is derived from the shape itself: after negating x,
// each point's counterpart is simply the nearest point, because the face is
// already close to symmetric.
//
// Geometry is not enough for the oval, though. Its pairs come from the ring's
// own topology instead — see ovalPairs — because the two points that geometry
// got wrong were exactly the ones that put a visible notch in the jaw.
function symmetrize(shape: number[]): number[] {
  const n = shape.length / 2;
  const partner = new Int32Array(n).fill(-1);
  for (const [i, j] of ovalPairs()) {
    partner[i] = j;
    partner[j] = i;
  }
  for (let i = 0; i < n; i++) {
    if (partner[i] >= 0) continue;
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
  // one of them is being dragged out of place. That rule removed most of the
  // crookedness, but it is also what left the jaw notch — it drops BOTH halves
  // of any disagreement, so the two oval points it could not resolve stayed
  // raw and asymmetric. The oval no longer relies on it.
  const fromTopology = new Set<number>();
  for (const [i, j] of ovalPairs()) {
    fromTopology.add(i);
    fromTopology.add(j);
  }
  for (let i = 0; i < n; i++) {
    if (fromTopology.has(i)) continue;
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
type Loop = number[] & { closed?: boolean; oval?: boolean };
let LOOPS: Loop[] | null = null;
function contourLoops(): Loop[] {
  if (LOOPS) return LOOPS;
  const subset = shapeSubset();
  const index = new Map(subset.map((id, i) => [id, i]));
  const loops: Loop[] = [];
  const sets = EDGE_SETS();
  for (const set of sets) {
    // The oval is the silhouette; every other set is an interior feature. The
    // capture guide draws those two at different weights, so the distinction is
    // tagged here rather than inferred from position in the array — a contour
    // set that resolved to more than one chain would silently shift the order.
    const isOval = set === sets[0];
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
      if (chain.length > 2) {
        loops.push(Object.assign(chain, {
          closed: next.get(cur ?? -1) === startId || chain.length > 8,
          oval: isOval,
        }));
      }
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

// The alignment guide should look like a face worth aiming at, not the
// population average — an average plotted as raw points reads as a diagram.
// Pushing the mean along the model's attractiveness axis gives an idealized
// archetype from the same data: slimmer and more tapered for the female
// reference, broader and squarer through the jaw for the male.
const CACHE = new Map<Sex, number[] | null>();
export function idealShape(sex: Sex): number[] | null {
  if (CACHE.has(sex)) return CACHE.get(sex)!;
  const m = SHAPE_MODEL[sex];
  const out = m
    ? symmetrize(canonicalize(m.meanShape.map((v, i) => v + m.axis[i] * IDEAL_SIGMA)))
    : null;
  CACHE.set(sex, out);
  return out;
}

// Width and height of a shape in its own Procrustes units. The capture guide
// has to turn "this face should be 46% of the frame wide" into a drawing scale,
// and the gate that phrase comes from measures the landmark bounding box. These
// agree because the oval is the outermost contour in the subset, so the shape's
// own bounds and the oval's are the same rectangle.
export function shapeExtent(shape: number[]): { w: number; h: number } {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < shape.length / 2; i++) {
    x0 = Math.min(x0, shape[2 * i]); x1 = Math.max(x1, shape[2 * i]);
    y0 = Math.min(y0, shape[2 * i + 1]); y1 = Math.max(y1, shape[2 * i + 1]);
  }
  return { w: x1 - x0, h: y1 - y0 };
}

export interface StrokeOpts {
  cx: number;
  cy: number;
  scale: number;
  stroke: string;
  lineWidth?: number;
  dash?: number[];
  // Alpha multiplier for the interior features (eyes, brows, lips, nose)
  // relative to the oval. 0 draws the silhouette alone.
  features?: number;
}

// Stroke a shape's contours into any context. Shared by the idle landing
// animation and the live capture guide so both draw the same face.
//
// Each contour is one continuous stroked path. Drawing it segment-by-segment
// with a vertex at every landmark looks like a wireframe; a smooth curve
// through the same points reads as a drawn silhouette.
//
// The curve passes THROUGH the landmarks (Catmull-Rom) rather than being pulled
// toward their midpoints. The previous version used quadratics aimed at each
// midpoint, which systematically cuts corners — and the corners of a face oval
// are the chin and the two jaw angles, so the one thing it rounded off was the
// jawline. It drew every face as a rounded square. Same data, same claim about
// what the outline is; it just stops smoothing away the shape.
export function strokeOutline(
  ctx: CanvasRenderingContext2D,
  shape: number[],
  o: StrokeOpts,
): void {
  const P = (i: number) => ({
    x: o.cx + shape[2 * i] * o.scale,
    y: o.cy + shape[2 * i + 1] * o.scale,
  });
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (o.dash) ctx.setLineDash(o.dash);
  for (const loop of contourLoops()) {
    const isOval = loop.oval === true;
    if (!isOval && o.features === 0) continue;
    ctx.globalAlpha = isOval ? 1 : (o.features ?? 1);
    ctx.strokeStyle = o.stroke;
    ctx.lineWidth = (o.lineWidth ?? 1.6) * (isOval ? 1 : 0.8);
    ctx.beginPath();
    spline(ctx, loop.map(P), loop.closed === true);
    ctx.stroke();
  }
  ctx.restore();
}

// Catmull-Rom through the given points, emitted as cubic beziers. `tension` at
// 6 is the standard uniform form; larger values pull the curve tighter to the
// straight line between points.
function spline(ctx: CanvasRenderingContext2D, pts: Array<{ x: number; y: number }>, closed: boolean): void {
  const n = pts.length;
  if (n < 2) return;
  const at = (i: number) => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  ctx.moveTo(pts[0].x, pts[0].y);
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    ctx.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 6,
      p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6,
      p2.y - (p3.y - p1.y) / 6,
      p2.x,
      p2.y,
    );
  }
  if (closed) ctx.closePath();
}

export interface OutlineHandle {
  morphTo(sex: Sex): void;
  stop(): void;
}

export function mountFaceOutline(canvas: HTMLCanvasElement, initial: Sex): OutlineHandle {
  const male = idealShape("male");
  const female = idealShape("female");
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
  const pulse = 1 + Math.sin(breathe) * 0.006;
  strokeOutline(ctx, shape, {
    cx: w / 2,
    cy: h / 2,
    scale: ((Math.min(w, h) * 0.42) / (maxR || 1)) * pulse,
    stroke: "rgba(14,122,104,0.55)",
    lineWidth: 1.6,
  });
}
