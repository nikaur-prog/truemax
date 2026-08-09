import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

export interface Pt {
  x: number;
  y: number;
}

// Named landmark indices on MediaPipe's 478-point canonical mesh.
// "R"/"L" are the subject's right/left (R appears on the image's left in an
// unmirrored photo). Metrics that need image-space left/right sort at runtime.
export const LM = {
  // Iris centers — interpupillary distance is the global scale reference
  IRIS_R: 468,
  IRIS_L: 473,
  // Eyes
  EYE_R_OUTER: 33,
  EYE_R_INNER: 133,
  EYE_R_TOP: 159,
  EYE_R_BOTTOM: 145,
  EYE_L_INNER: 362,
  EYE_L_OUTER: 263,
  EYE_L_TOP: 386,
  EYE_L_BOTTOM: 374,
  // Brows (lower edge mid + medial/lateral ends)
  BROW_R_MID: 52,
  BROW_R_MEDIAL: 55,
  BROW_R_LATERAL: 46,
  BROW_L_MID: 282,
  BROW_L_MEDIAL: 285,
  BROW_L_LATERAL: 276,
  // Vertical axis
  FOREHEAD_TOP: 10, // top of the mesh (mid-forehead — the mesh has no hairline)
  GLABELLA: 9,
  NASION: 168,
  SUBNASALE: 2,
  MENTON: 152,
  // Nose — alar candidates per side; width uses the widest extent
  ALAR_R: [48, 49, 64, 98] as const,
  ALAR_L: [278, 279, 294, 327] as const,
  NOSE_TIP: 1,
  // Mouth / lips
  MOUTH_R: 61,
  MOUTH_L: 291,
  LIP_TOP: 0, // labiale superius (vermilion top center)
  LIP_UPPER_INNER: 13, // stomion upper
  LIP_LOWER_INNER: 14, // stomion lower
  LIP_BOTTOM: 17, // labiale inferius (vermilion bottom center)
  // Face contour
  ZYGO_R: 234,
  ZYGO_L: 454,
  GONION_R: 58,
  GONION_L: 288,
  // Mid-ramus points on the jaw outline, between the corner and the chin
  JAW_MID_R: 172,
  JAW_MID_L: 397,
  CHIN_SIDE_R: 149,
  CHIN_SIDE_L: 378,
} as const;

// Mirrored landmark pairs used for symmetry metrics
export const MIRROR_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [33, 263],
  [133, 362],
  [159, 386],
  [145, 374],
  [61, 291],
  [234, 454],
  [58, 288],
  [172, 397],
  [136, 365],
  [150, 379],
  [176, 400],
  [148, 377],
  [105, 334],
  [46, 276],
  [98, 327],
];

export interface Geom {
  pt(i: number): Pt;
  // Distance between the two eye centers, used as the global scale reference.
  //
  // NOT interpupillary distance: iris centers track GAZE, so they shift
  // between photos of the same person and inject noise into every metric
  // normalized by them. Measured reliability of IPD-normalized metrics was
  // ~0 (photo-to-photo variation exceeded between-person variation). Each eye
  // center is the midpoint of that eye's inner and outer canthus, which is
  // fixed to the skull and gaze-independent.
  interEye: number;
  eyeR: Pt;
  eyeL: Pt;
  // Head pose that was removed, measured from the landmark cloud itself
  rollDeg: number;
  yawDeg: number;
  pitchDeg: number;
}

interface V3 {
  x: number;
  y: number;
  z: number;
}

const sub3 = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot3 = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross3 = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const scale3 = (a: V3, k: number): V3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
function norm3(a: V3): V3 {
  const m = Math.hypot(a.x, a.y, a.z) || 1e-9;
  return scale3(a, 1 / m);
}

// Midline landmarks (forehead → menton) used to fit the head's vertical axis.
const MIDLINE = [10, 151, 9, 8, 168, 6, 197, 195, 5, 4, 1, 2, 164, 0, 13, 14, 17, 18, 200, 199, 175, 152];

// MediaPipe's landmark z is compressed relative to x/y, which makes the
// estimated head axes under-tilt and leaves residual foreshortening. A face
// rotated by θ recovers as `u·sqrt(cos²θ + k²sin²θ)` for compression k, so a
// single scale restores full correction. Tuned by sweeping for minimum score
// disagreement across different photos of the same person
// (tools/convergence.mjs).
// 4.5 measured as the optimum: it halves cross-photo score disagreement for
// the same person (0.80 → 0.40 average, 1.1 → 0.5 worst).
export const POSE_CALIBRATION = { zScale: 4.5 };

// ---------------------------------------------------------------------------
// Pose normalization. MediaPipe returns 3D landmarks, so instead of measuring
// in image space (where a turned or tilted head distorts every ratio) we
// reconstruct the head's OWN coordinate frame and measure in that:
//
//   lateral  — perpendicular to the facial symmetry plane, averaged over
//              mirrored landmark pairs
//   vertical — principal axis of the midline points, within the symmetry plane
//
// Projecting the cloud onto (lateral, vertical) yields a canonical frontal
// orthographic view, so yaw/pitch/roll are removed before any metric runs.
// Output keeps the screen convention: x grows right, y grows downward.
// ---------------------------------------------------------------------------
export function buildGeometry(
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
): Geom {
  // MediaPipe's z is scaled roughly like x, so both use image width.
  const p3: V3[] = landmarks.map((l) => ({
    x: l.x * width,
    y: l.y * height,
    z: (l.z ?? 0) * width * POSE_CALIBRATION.zScale,
  }));

  // Lateral axis: mean of subject-right → subject-left pair vectors.
  let acc: V3 = { x: 0, y: 0, z: 0 };
  for (const [r, l] of MIRROR_PAIRS) {
    const v = sub3(p3[l], p3[r]);
    acc = { x: acc.x + v.x, y: acc.y + v.y, z: acc.z + v.z };
  }
  const lateral = norm3(acc);

  // Vertical axis: fit the principal direction of the midline points inside
  // the plane perpendicular to `lateral` (a 2x2 eigenproblem in that basis).
  const seed: V3 = Math.abs(lateral.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
  const e1 = norm3(sub3(seed, scale3(lateral, dot3(seed, lateral))));
  const e2 = cross3(lateral, e1);

  const mlPts = MIDLINE.filter((i) => p3[i]).map((i) => p3[i]);
  const centroid = mlPts.reduce(
    (a, p) => ({ x: a.x + p.x / mlPts.length, y: a.y + p.y / mlPts.length, z: a.z + p.z / mlPts.length }),
    { x: 0, y: 0, z: 0 },
  );
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  for (const p of mlPts) {
    const d = sub3(p, centroid);
    const a = dot3(d, e1);
    const b = dot3(d, e2);
    saa += a * a;
    sbb += b * b;
    sab += a * b;
  }
  const theta = 0.5 * Math.atan2(2 * sab, saa - sbb);
  let vertical = norm3({
    x: e1.x * Math.cos(theta) + e2.x * Math.sin(theta),
    y: e1.y * Math.cos(theta) + e2.y * Math.sin(theta),
    z: e1.z * Math.cos(theta) + e2.z * Math.sin(theta),
  });
  // Orient it downward in face terms (forehead → menton)
  if (dot3(sub3(p3[LM.MENTON], p3[LM.FOREHEAD_TOP]), vertical) < 0) vertical = scale3(vertical, -1);

  const eyeC = (a: number, b: number): V3 => ({
    x: (p3[a].x + p3[b].x) / 2,
    y: (p3[a].y + p3[b].y) / 2,
    z: (p3[a].z + p3[b].z) / 2,
  });
  const eyeR3 = eyeC(LM.EYE_R_OUTER, LM.EYE_R_INNER);
  const eyeL3 = eyeC(LM.EYE_L_OUTER, LM.EYE_L_INNER);
  const origin = {
    x: (eyeR3.x + eyeL3.x) / 2,
    y: (eyeR3.y + eyeL3.y) / 2,
    z: (eyeR3.z + eyeL3.z) / 2,
  };

  const project = (p: V3): Pt => {
    const d = sub3(p, origin);
    return { x: dot3(d, lateral), y: dot3(d, vertical) };
  };
  const flat: Pt[] = p3.map(project);
  const eyeR = project(eyeR3);
  const eyeL = project(eyeL3);

  // Pose actually removed, for the capture-quality report.
  const yawDeg = (Math.asin(Math.max(-1, Math.min(1, lateral.z))) * 180) / Math.PI;
  const pitchDeg = (Math.asin(Math.max(-1, Math.min(1, -vertical.z))) * 180) / Math.PI;
  const rollDeg = (Math.atan2(lateral.y, lateral.x) * 180) / Math.PI;

  return {
    pt: (i: number) => flat[i],
    interEye: dist(eyeR, eyeL),
    eyeR,
    eyeL,
    rollDeg,
    yawDeg,
    pitchDeg,
  };
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function mid(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// Interior angle at vertex v formed by rays v→a and v→b, in degrees
export function angleAt(v: Pt, a: Pt, b: Pt): number {
  const a1 = Math.atan2(a.y - v.y, a.x - v.x);
  const a2 = Math.atan2(b.y - v.y, b.x - v.x);
  let d = Math.abs(a1 - a2);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return (d * 180) / Math.PI;
}

// Signed angle of the line a→b vs horizontal, in degrees.
// Positive = b is higher than a in face space (screen y grows downward).
export function lineTiltDeg(a: Pt, b: Pt): number {
  return (Math.atan2(a.y - b.y, Math.abs(b.x - a.x)) * 180) / Math.PI;
}
