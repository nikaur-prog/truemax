import { FaceLandmarker } from "@mediapipe/tasks-vision";
import type { Pt } from "./geometry.ts";
import type { Geom } from "./geometry.ts";
import type { Sex } from "./types.ts";
import { SHAPE_MODEL } from "./shapeModel.ts";

// ---------------------------------------------------------------------------
// Shape descriptors.
//
// Individual ratios (jaw width : cheekbone width, nose : mouth, …) are each
// two landmarks divided by two more, so landmark jitter lands on the result
// undamped — measured reliability across photos of one person was near zero
// for a third of them. A shape descriptor instead uses the whole outline at
// once: align the point cloud to a reference by translation, scale and
// rotation (Procrustes), then read its position along directions learned from
// the reference population. Averaging ~130 points makes noise cancel rather
// than compound.
//
// The ratios are still computed and shown — they are what makes the analysis
// legible — but the score leans on the descriptor.
// ---------------------------------------------------------------------------

// Well-defined outline landmarks only: face oval, eyes, brows, lips, nose.
// The mesh interior is interpolated and carries little independent shape
// information, so including it would add noise and inflate the model.
function buildSubset(): number[] {
  const sets = [
    FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
    FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
    FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
    FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW,
    FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
    FaceLandmarker.FACE_LANDMARKS_LIPS,
  ];
  const ids = new Set<number>();
  for (const s of sets) for (const c of s) ids.add(c.start);
  // Nose ridge and alar points, which no contour set covers
  for (const i of [1, 2, 4, 5, 6, 19, 94, 98, 327, 48, 278, 168, 197]) ids.add(i);
  return [...ids].sort((a, b) => a - b);
}

let SUBSET: number[] | null = null;
export function shapeSubset(): number[] {
  return (SUBSET ??= buildSubset());
}

// Flattened [x0,y0,x1,y1,…] of the subset, in pose-normalized space.
export function extractShape(g: Geom): number[] {
  const out: number[] = [];
  for (const i of shapeSubset()) {
    const p = g.pt(i);
    out.push(p.x, p.y);
  }
  return out;
}

// Centre, scale to unit norm, and rotate to best match `ref` (full 2D
// Procrustes). What remains is pure shape.
export function procrustes(shape: number[], ref: number[]): number[] {
  const n = shape.length / 2;
  const pts: Pt[] = [];
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    cx += shape[2 * i] / n;
    cy += shape[2 * i + 1] / n;
  }
  let norm = 0;
  for (let i = 0; i < n; i++) {
    const x = shape[2 * i] - cx;
    const y = shape[2 * i + 1] - cy;
    pts.push({ x, y });
    norm += x * x + y * y;
  }
  norm = Math.sqrt(norm) || 1e-9;
  for (const p of pts) {
    p.x /= norm;
    p.y /= norm;
  }

  // Reference is assumed already centred and unit-scaled
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    const rx = ref[2 * i];
    const ry = ref[2 * i + 1];
    sxy += pts[i].x * ry - pts[i].y * rx;
    sxx += pts[i].x * rx + pts[i].y * ry;
  }
  const theta = Math.atan2(sxy, sxx);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  const out: number[] = new Array(shape.length);
  for (let i = 0; i < n; i++) {
    out[2 * i] = pts[i].x * cos - pts[i].y * sin;
    out[2 * i + 1] = pts[i].x * sin + pts[i].y * cos;
  }
  return out;
}

export function centreAndScale(shape: number[]): number[] {
  return procrustes(shape, shape.map((_, i) => (i % 2 === 0 ? 1 : 0)));
}

export function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function subtract(a: number[], b: number[]): number[] {
  return a.map((v, i) => v - b[i]);
}

// Position along the population→attractive direction, standardized against
// the population. Returns null when no model exists for that sex.
export function shapeZScore(shape: number[], sex: Sex): number | null {
  const model = SHAPE_MODEL[sex];
  if (!model || shape.length !== model.meanShape.length) return null;
  const aligned = procrustes(shape, model.meanShape);
  let proj = 0;
  for (let i = 0; i < aligned.length; i++) {
    proj += (aligned[i] - model.meanShape[i]) * model.axis[i];
  }
  return (proj - model.axisMean) / (model.axisSD || 1);
}
