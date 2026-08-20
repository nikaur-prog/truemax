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
  //
  // BIZYGOMATIC WIDTH. This reverses an earlier change, so the reasoning it
  // overturns is kept: 116/345 were chosen because MediaPipe has no skeletal
  // "zygion" landmark and 234/454 were judged to be the face-oval/sideburn
  // pair rather than the cheekbone. The soft-tissue worry there is real. The
  // conclusion was still wrong, for three reasons that were not available at
  // the time.
  //
  //   1. The published definition is the SILHOUETTE, not the skeleton. In the
  //      facial-width-to-height literature bizygomatic width is the maximum
  //      horizontal distance from the left facial boundary to the right — a
  //      boundary measurement taken from a photograph, which is exactly what
  //      the face oval gives and what an inset cheek point does not.
  //
  //   2. Measured, over 60 reference faces (tools/bizygo-check.mjs): 116/345
  //      span 89.2% of the face at their own height, mean and median within
  //      0.2 points of each other. That is not an approximation of the width,
  //      it is a consistent 10.8% underestimate of it.
  //
  //   3. Two metrics that divide by it read high against an independent
  //      product by 10.1% and 6.0%, which is what a denominator that short
  //      produces.
  //
  // 234/454 rather than the widest pair on the oval. 127/356 is marginally
  // wider (1.165 against 1.160 in eye-to-chin units) but sits at height 0.078,
  // barely below the eye line, where the silhouette really is temple and
  // sideburn. 234/454 sits at 0.199 — the same height as the pair being
  // replaced, so this changes WHERE ACROSS the face we measure and not how
  // far down, which is the single thing that was wrong. Its width also varies
  // slightly LESS across faces in relative terms (5.16% against 5.36%), so
  // the hair worry does not show up in the numbers.
  //
  // Named for what it is now. The old name invited the old mistake back.
  ZYGION_R: 234,
  ZYGION_L: 454,
  // The malar prominence, kept, because two different questions want two
  // different points and collapsing them is what went wrong the first time.
  //
  //   How WIDE is the face here?  The silhouette. ZYGION.
  //   How HIGH is the cheekbone?  The prominence itself. MALAR.
  //
  // cheekboneHeight is (malar.y - eyeMid.y) / (menton.y - eyeMid.y) — a
  // vertical position with no width in it. Pointing it at the silhouette pair
  // instead moved it 41% on men and 12% on women, which is not a correction of
  // anything, just a different measurement wearing the same name.
  MALAR_R: 116,
  MALAR_L: 345,
  GONION_R: 58,
  GONION_L: 288,
  // Mid-ramus points on the jaw outline, between the corner and the chin
  JAW_MID_R: 172,
  JAW_MID_L: 397,
  // The visible OUTLINE of the cheek, between the widest point of the face and
  // the jaw corner. These are silhouette points, not structural ones, and that
  // distinction is the whole reason they exist: MALAR and GONION sit on bone,
  // while these follow whatever soft tissue is draped over it. The gap between
  // the two is the only thing in a frontal photograph that reports facial fat.
  CHEEK_OUT_R: 234, // widest oval point, cheekbone height
  CHEEK_MID_R: 132, // mid-cheek, between cheekbone and jaw corner
  CHEEK_OUT_L: 454,
  CHEEK_MID_L: 361,
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
  [116, 345],
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
  // Original image-space points. A few measurements (notably canthal tilt)
  // are more faithfully read in the photograph after correcting only the
  // image roll than after reconstructing depth from MediaPipe's estimated z.
  imagePt(i: number): Pt;
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
  imageRollDeg: number;
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

export const FACE_LANDMARK_COUNT = 478;

// MediaPipe normally returns all 478 points even when some are poor estimates.
// That makes an incomplete/NaN result especially dangerous: it can otherwise
// travel a long way through ratios before surfacing as a nonsense score.
export function landmarkIntegrityIssues(landmarks: NormalizedLandmark[]): string[] {
  if (!Array.isArray(landmarks) || landmarks.length < FACE_LANDMARK_COUNT) {
    return [`Expected ${FACE_LANDMARK_COUNT} face landmarks; received ${landmarks?.length ?? 0}`];
  }
  const issues: string[] = [];
  for (let i = 0; i < FACE_LANDMARK_COUNT; i++) {
    const p = landmarks[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z ?? 0)) {
      issues.push(`Landmark ${i} is missing or invalid`);
      if (issues.length >= 4) break;
    }
  }
  return issues;
}

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
  const integrity = landmarkIntegrityIssues(landmarks);
  if (integrity.length) throw new Error(`Face scan is incomplete: ${integrity.join("; ")}`);
  if (!(width > 0) || !(height > 0)) throw new Error("Face scan has invalid image dimensions");

  const image: Pt[] = landmarks.map((l) => ({ x: l.x * width, y: l.y * height }));
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

  // zScale exaggerates depth to get a better axis ESTIMATE, but projecting
  // onto exaggerated axes would stretch distances along whichever axis carries
  // more depth — fWHR came out 5.09 on a face whose width is visibly ~2.2x its
  // upper-face height. Convert the axes back into true (unscaled) space and
  // project the unscaled cloud, so the projection stays rigid and every
  // measurement means what its name says.
  const unscale = (v: V3): V3 => norm3({ x: v.x, y: v.y, z: v.z / POSE_CALIBRATION.zScale });
  const lateralT = unscale(lateral);
  const verticalUnscaled = unscale(vertical);
  // Anisotropically undoing zScale does not preserve perpendicularity. The
  // old code normalized the two axes independently, leaving a sheared basis;
  // on real reference faces that inflated median canthal asymmetry from about
  // 7° in the image to nearly 30° after "correction". Gram-Schmidt restores a
  // rigid orthonormal face frame before any metric is projected into it.
  const verticalT = norm3(
    sub3(verticalUnscaled, scale3(lateralT, dot3(verticalUnscaled, lateralT))),
  );
  const pTrue: V3[] = landmarks.map((l) => ({
    x: l.x * width,
    y: l.y * height,
    z: (l.z ?? 0) * width,
  }));

  const eyeC = (a: number, b: number): V3 => ({
    x: (pTrue[a].x + pTrue[b].x) / 2,
    y: (pTrue[a].y + pTrue[b].y) / 2,
    z: (pTrue[a].z + pTrue[b].z) / 2,
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
    return { x: dot3(d, lateralT), y: dot3(d, verticalT) };
  };
  const flat: Pt[] = pTrue.map(project);
  const eyeR = project(eyeR3);
  const eyeL = project(eyeL3);

  const imageEye = (a: number, b: number): Pt => ({
    x: (image[a].x + image[b].x) / 2,
    y: (image[a].y + image[b].y) / 2,
  });
  const imageEyeR = imageEye(LM.EYE_R_OUTER, LM.EYE_R_INNER);
  const imageEyeL = imageEye(LM.EYE_L_OUTER, LM.EYE_L_INNER);
  const imageRollDeg =
    (Math.atan2(imageEyeL.y - imageEyeR.y, imageEyeL.x - imageEyeR.x) * 180) / Math.PI;

  // Pose actually removed, for the capture-quality report.
  const yawDeg = (Math.asin(Math.max(-1, Math.min(1, lateral.z))) * 180) / Math.PI;
  const pitchDeg = (Math.asin(Math.max(-1, Math.min(1, -vertical.z))) * 180) / Math.PI;
  const rollDeg = (Math.atan2(lateral.y, lateral.x) * 180) / Math.PI;

  return {
    pt: (i: number) => flat[i],
    imagePt: (i: number) => image[i],
    interEye: dist(eyeR, eyeL),
    eyeR,
    eyeL,
    rollDeg,
    imageRollDeg,
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
