import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { Occlusion } from "./occlusion.js";
import type { QualityCheck } from "./quality.js";
import type { HeadCoveringCheck } from "./headCovering.js";
import {
  FRONT_PITCH_OK,
  FRONT_ROLL_OK,
  FRONT_SMILE_OK,
  FRONT_YAW_OK,
  PHOTO_SHARP_WARN,
  lightOk,
} from "./captureGuide.js";
import type { FrameStats } from "./captureGuide.js";

// Upload validation blocks only conditions that make facial geometry genuinely
// unavailable. Once MediaPipe has returned an intact mesh, the pixel dimensions
// of the original file are not a useful proxy for whether that geometry can be
// measured: screenshots, downloads and social-media images are routinely under
// 480 px on one edge while still carrying a clear, large face. Skin observations
// can report lower confidence separately; they must not prevent the landmark
// scan from running.

// Uploaded stills get a wider pose envelope than the live shutter guide. The
// guide can ask for a cleaner capture before a photo exists; rejecting a usable
// photo after the user selected it is much more costly. These remain inside the
// pose-correction envelope in quality.ts.
const UPLOAD_FRONT_YAW_BLOCK = 25;
const UPLOAD_FRONT_PITCH_BLOCK = 25;
const UPLOAD_FRONT_ROLL_BLOCK = 16;

export interface PhotoRejection {
  title: string;
  detail: string;
}

export interface SideSilhouetteCheck {
  usable: boolean;
  reason: "no-head" | "cropped" | "too-small" | "not-profile" | null;
  headHeightFrac: number;
  headWidthFrac: number;
  nasalRelief: number;
}

export function headCoveringRejection(check: HeadCoveringCheck): PhotoRejection | null {
  if (check.hoodLikely) {
    return {
      title: "Sorry, a hood or clothing appears to cover the sides of your face.",
      detail: "Take the hood down and keep both cheeks, ears, hairline and jaw edge fully visible.",
    };
  }
  if (check.hatLikely) {
    return {
      title: "Sorry, a hat or accessory appears to cover the upper face.",
      detail: "Remove hats, caps and anything casting a brim shadow over the forehead or brows.",
    };
  }
  return null;
}

export function landmarkBox(lm: NormalizedLandmark[]): { x: number; y: number; w: number; h: number } {
  let x0 = 1;
  let x1 = 0;
  let y0 = 1;
  let y1 = 0;
  for (const p of lm) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

export function frontPhotoRejection(
  quality: QualityCheck,
  _stats: FrameStats,
  _occlusion: Occlusion | null,
  lm: NormalizedLandmark[] | null,
  _width: number,
  _height: number,
): PhotoRejection | null {
  if (!quality.faceFound || !lm) {
    return {
      title: "Sorry, we couldn't verify a clear face in that photo.",
      detail: "Use one unfiltered photo with your whole face visible, looking directly at the camera.",
    };
  }

  const box = landmarkBox(lm);
  if (box.x < 0.005 || box.y < 0.005 || box.x + box.w > 0.995 || box.y + box.h > 0.995) {
    return {
      title: "Sorry, part of your face is cut off.",
      detail: "Choose a photo showing your full forehead, both cheeks, ears, jaw and chin with space around them.",
    };
  }

  if (Math.abs(quality.yawDeg) > UPLOAD_FRONT_YAW_BLOCK) {
    return {
      title: "Sorry, your face is turned too far in this photo.",
      detail: "For the front scan, look straight at the lens with both ears and both cheeks equally visible.",
    };
  }
  if (Math.abs(quality.pitchDeg) > UPLOAD_FRONT_PITCH_BLOCK) {
    return {
      title: "Sorry, the camera angle is too high or low.",
      detail: "Keep the camera at eye level and your chin neutral—not tipped up or tucked down.",
    };
  }
  if (Math.abs(quality.rollDeg) > UPLOAD_FRONT_ROLL_BLOCK) {
    return {
      title: "Sorry, your head is tilted in this photo.",
      detail: "Hold your head upright so the eye line is level.",
    };
  }
  return null;
}

// Conditions that reduce repeatability without making the landmark geometry
// impossible. They are shown after capture and carried into the result as
// confidence context; none spends the user's attempt by forcing a retake.
export function frontPhotoWarnings(
  quality: QualityCheck,
  stats: FrameStats,
  occlusion: Occlusion | null,
): string[] {
  const warnings: string[] = [];
  if (Math.abs(quality.yawDeg) > FRONT_YAW_OK) warnings.push("Turned slightly from the camera");
  if (Math.abs(quality.pitchDeg) > FRONT_PITCH_OK) warnings.push("Camera angle may affect repeatability");
  if (Math.abs(quality.rollDeg) > FRONT_ROLL_OK) warnings.push("Head tilt was corrected");
  if (quality.smileScore > FRONT_SMILE_OK) warnings.push("Expression may affect mouth and cheek measurements");
  if (occlusion?.glassesStrong) warnings.push("Glasses may lower eye-area confidence");
  if (!lightOk(stats)) warnings.push("Lighting lowers photo confidence");
  if (stats.sharpness < PHOTO_SHARP_WARN) warnings.push("Soft focus lowers landmark confidence");
  return warnings;
}

export function sidePhotoRejection(
  quality: QualityCheck,
  stats: FrameStats,
  silhouette: SideSilhouetteCheck,
  _width: number,
  _height: number,
): PhotoRejection | null {
  void stats;
  // Side landmark placement is reviewable. Once a real face has made a useful
  // turn, prefer giving the person our best thirteen-point estimate over
  // inventing a crop failure from a noisy background silhouette. The user can
  // drag any missed point before a score exists. Only a clearly frontal shot
  // is blocked here; detector uncertainty and silhouette "crop" guesses are
  // allowed through to that review step.
  // Both gates below read a pose estimated from a HALF-OCCLUDED mesh. On a real
  // profile the far side of the face is gone, and MediaPipe's yaw and pitch get
  // correspondingly noisy — yaw in particular reads well short of the true turn,
  // so the better the profile, the more these two under-report it. That is the
  // wrong way round for a gate, and it is why photographs that are obviously
  // fine to a human were being refused.
  //
  // So both are widened to catch only what is unambiguous: a shot that is
  // plainly still frontal, and a chin plainly buried in the chest. Everything
  // between goes to the thirteen-point review, where the person can see their
  // own photograph and drag anything that missed — which is the same reasoning
  // the comment above already applies to silhouette crop guesses.
  if (quality.faceFound && Math.abs(quality.yawDeg) < 25) {
    return {
      title: "Sorry, you are not sideways enough in this photo.",
      detail: "Turn farther until the nose is in silhouette and one ear faces the camera.",
    };
  }
  if (quality.faceFound && (quality.pitchDeg < -20 || quality.pitchDeg > 38)) {
    return {
      title: "Sorry, your chin angle hides part of the profile.",
      detail: "Keep your head level so the jaw corner and the line under your chin are visible.",
    };
  }
  if (!quality.faceFound && silhouette.reason === "no-head") {
    return {
      title: "Sorry, we couldn't find a face in that photo.",
      detail: "Use a photo containing one visible head. TrueMax will estimate the profile points for you to review.",
    };
  }
  return null;
}
