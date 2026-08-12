import type { FaceLandmarkerResult, NormalizedLandmark } from "@mediapipe/tasks-vision";
import { landmarkIntegrityIssues } from "./geometry.ts";

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
