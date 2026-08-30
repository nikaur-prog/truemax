import type { FaceLandmarkerResult, NormalizedLandmark } from "@mediapipe/tasks-vision";
import { landmarkIntegrityIssues } from "./geometry.js";

export interface QualityCheck {
  faceFound: boolean;
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
  faceWidthFrac: number; // bizygomatic width as a fraction of image width
  smileScore: number; // 0..1 from blendshapes — smiling skews mouth/jaw metrics
  frontal: boolean;
  largeEnough: boolean;
  neutralExpression: boolean;
  pass: boolean;
  issues: string[];
}

// Tolerances for "roughly frontal". Celebrity photos won't always pass —
// the UI warns but allows proceeding.
// Measurements are pose-corrected (see geometry.ts), so moderate yaw/pitch no
// longer distorts ratios. These thresholds mark where landmark accuracy itself
// degrades from self-occlusion, not where the geometry breaks.
const YAW_TOLERANCE_DEG = 28;
const PITCH_TOLERANCE_DEG = 26;

// Where the JAW starts going wrong, which is a long way before the thresholds
// above.
//
// Those two mark where landmarks self-occlude — the point at which the whole
// read degrades. The jaw fails much earlier and for a different reason, and it
// is not a geometry problem this engine can correct: MediaPipe's silhouette
// points slide ALONG the jawline as the head turns (see the gonialProxy note
// in metrics.ts), so the outline the measurements are built on is not the same
// outline at 12° as at 0°. Pose correction can rotate a landmark; it cannot
// know the landmark moved to a different part of the bone.
//
// All three front jaw metrics are built on the gonion points, so this is
// exactly the region that quietly comes back low from a tilted capture.
//
// It was already known — results.ts prints a caveat above 6° — but only AFTER
// the scan, which is the one moment retaking is no longer free. Warning at
// capture costs the person two seconds; warning afterwards costs them their
// weekly scan and hands them a jaw number that is mostly a statement about
// where they held the phone.
export const JAW_POSE_WARN_DEG = 6;
const MIN_FACE_WIDTH_FRAC = 0.2;
const SMILE_TOLERANCE = 0.42;

// Landmark indices (MediaPipe 478-point mesh)
const LEFT_FACE_EDGE = 234;
const RIGHT_FACE_EDGE = 454;

export function assessQuality(result: FaceLandmarkerResult): QualityCheck {
  if (!result.faceLandmarks.length) {
    return {
      faceFound: false,
      yawDeg: 0,
      pitchDeg: 0,
      rollDeg: 0,
      faceWidthFrac: 0,
      smileScore: 0,
      frontal: false,
      largeEnough: false,
      neutralExpression: false,
      pass: false,
      issues: ["No face detected"],
    };
  }

  const landmarks = result.faceLandmarks[0];
  const integrity = landmarkIntegrityIssues(landmarks);
  if (integrity.length) {
    return {
      faceFound: false,
      yawDeg: 0,
      pitchDeg: 0,
      rollDeg: 0,
      faceWidthFrac: 0,
      smileScore: 0,
      frontal: false,
      largeEnough: false,
      neutralExpression: false,
      pass: false,
      issues: ["Face landmarks were incomplete. Retake the photo"],
    };
  }
  const { yawDeg, pitchDeg, rollDeg } = headPose(result);

  const left = landmarks[LEFT_FACE_EDGE];
  const right = landmarks[RIGHT_FACE_EDGE];
  const faceWidthFrac = Math.abs(right.x - left.x);

  const blend = result.faceBlendshapes?.[0]?.categories ?? [];
  const smileScore = Math.max(
    0,
    ...blend
      .filter((c) => c.categoryName === "mouthSmileLeft" || c.categoryName === "mouthSmileRight")
      .map((c) => c.score),
  );

  const frontal = Math.abs(yawDeg) <= YAW_TOLERANCE_DEG && Math.abs(pitchDeg) <= PITCH_TOLERANCE_DEG;
  const largeEnough = faceWidthFrac >= MIN_FACE_WIDTH_FRAC;
  const neutralExpression = smileScore <= SMILE_TOLERANCE;

  const issues: string[] = [];
  if (Math.abs(yawDeg) > YAW_TOLERANCE_DEG)
    issues.push("Head is turned far enough that some landmarks are hidden. Face the camera more directly");
  if (Math.abs(pitchDeg) > PITCH_TOLERANCE_DEG)
    issues.push("Head is tilted steeply up/down. Keep it level for the cleanest read");
  // Only when the hard thresholds have NOT already fired: two chips saying the
  // head is turned, one of them softer, reads as the app being unsure rather
  // than as two different problems.
  const offAxis = Math.max(Math.abs(yawDeg), Math.abs(pitchDeg));
  if (frontal && offAxis > JAW_POSE_WARN_DEG)
    issues.push(
      `Head is ${offAxis.toFixed(0)}° off level. Jaw and chin read low from this angle. Straighten up for those to count`,
    );
  if (!largeEnough) issues.push("Face is small in frame. Move closer or crop tighter");
  if (!neutralExpression) issues.push("Smiling detected. Expression shifts mouth and jaw measurements");

  return {
    faceFound: true,
    yawDeg,
    pitchDeg,
    rollDeg,
    faceWidthFrac,
    smileScore,
    frontal,
    largeEnough,
    neutralExpression,
    pass: frontal && largeEnough && neutralExpression,
    issues,
  };
}

// Extract yaw/pitch/roll from the facial transformation matrix (column-major
// 4x4). Falls back to landmark symmetry if the matrix is unavailable.
function headPose(result: FaceLandmarkerResult): { yawDeg: number; pitchDeg: number; rollDeg: number } {
  const m = result.facialTransformationMatrixes?.[0]?.data;
  if (m && m.length === 16) {
    // Column-major: rotation columns are [m0 m1 m2], [m4 m5 m6], [m8 m9 m10]
    const yaw = Math.atan2(-m[8], Math.hypot(m[9], m[10]));
    const pitch = Math.atan2(m[9], m[10]);
    const roll = Math.atan2(m[4], m[0]);
    return {
      yawDeg: toDeg(yaw),
      pitchDeg: toDeg(pitch),
      rollDeg: toDeg(roll),
    };
  }
  return symmetryPose(result.faceLandmarks[0]);
}

// Fallback: estimate yaw from the nose tip's offset between the two face
// edges. Crude but only used if the transform matrix is missing.
function symmetryPose(landmarks: NormalizedLandmark[]): { yawDeg: number; pitchDeg: number; rollDeg: number } {
  const noseTip = landmarks[1];
  const left = landmarks[LEFT_FACE_EDGE];
  const right = landmarks[RIGHT_FACE_EDGE];
  const leftDist = Math.abs(noseTip.x - left.x);
  const rightDist = Math.abs(right.x - noseTip.x);
  const asym = (leftDist - rightDist) / (leftDist + rightDist);
  return { yawDeg: asym * 45, pitchDeg: 0, rollDeg: 0 };
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}
