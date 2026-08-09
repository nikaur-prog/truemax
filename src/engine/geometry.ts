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
  ipd: number;
  rollDeg: number; // roll that was removed (for reporting)
}

// Convert normalized landmarks to pixel space (undoing the aspect-ratio
// distortion of normalized coords), then rotate so the eye line is horizontal.
// All metrics measure in this roll-corrected space, so a tilted head doesn't
// skew vertical/horizontal measurements.
export function buildGeometry(
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
): Geom {
  const px: Pt[] = landmarks.map((l) => ({ x: l.x * width, y: l.y * height }));

  const irisR = px[LM.IRIS_R];
  const irisL = px[LM.IRIS_L];
  let rollNorm = Math.atan2(irisL.y - irisR.y, irisL.x - irisR.x);
  // The iris pair may be in either image order; fold roll into (-90°, 90°]
  if (rollNorm > Math.PI / 2) rollNorm -= Math.PI;
  if (rollNorm < -Math.PI / 2) rollNorm += Math.PI;
  const cx = (irisR.x + irisL.x) / 2;
  const cy = (irisR.y + irisL.y) / 2;
  const cos = Math.cos(-rollNorm);
  const sin = Math.sin(-rollNorm);

  const rot: Pt[] = px.map((p) => ({
    x: cx + (p.x - cx) * cos - (p.y - cy) * sin,
    y: cy + (p.x - cx) * sin + (p.y - cy) * cos,
  }));

  return {
    pt: (i: number) => rot[i],
    ipd: dist(rot[LM.IRIS_R], rot[LM.IRIS_L]),
    rollDeg: (rollNorm * 180) / Math.PI,
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
