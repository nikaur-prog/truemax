import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { Occlusion } from "./occlusion.ts";
import type { QualityCheck } from "./quality.ts";
import type { HeadCoveringCheck } from "./headCovering.ts";
import {
  FRONT_PITCH_OK,
  FRONT_ROLL_OK,
  FRONT_SMILE_OK,
  FRONT_YAW_OK,
  PHOTO_BRIGHT,
  PHOTO_DARK,
  PHOTO_SHARP_WARN,
} from "./captureGuide.ts";
import type { FrameStats } from "./captureGuide.ts";

// Upload validation is deliberately fail-closed. A file chooser used to bypass
// every live-camera gate and send any detected face into scoring. That becomes
// especially indefensible when the same pixels feed a skin screen: landmark
// pose correction cannot restore a hidden cheek, and a soft/filtered image can
// erase exactly the visible findings the user asked the app to inspect.

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
  stats: FrameStats,
  occlusion: Occlusion | null,
  lm: NormalizedLandmark[] | null,
  width: number,
  height: number,
): PhotoRejection | null {
  if (!quality.faceFound || !lm) {
    return {
      title: "Sorry, we couldn't verify a clear face in that photo.",
      detail: "Use one unfiltered photo with your whole face visible, looking directly at the camera.",
    };
  }

  const box = landmarkBox(lm);
  if (box.x < 0.025 || box.y < 0.02 || box.x + box.w > 0.975 || box.y + box.h > 0.985) {
    return {
      title: "Sorry, part of your face is cut off.",
      detail: "Choose a photo showing your full forehead, both cheeks, ears, jaw and chin with space around them.",
    };
  }

  const facePixels = Math.min(box.w * width, box.h * height);
  if (Math.min(width, height) < 480 || facePixels < 280) {
    return {
      title: "Sorry, that photo is too small for a skin and landmark scan.",
      detail: "Use the original photo rather than a screenshot or thumbnail, with your face filling most of the frame.",
    };
  }

  if (Math.abs(quality.yawDeg) > FRONT_YAW_OK) {
    return {
      title: "Sorry, your face is turned too far in this photo.",
      detail: "For the front scan, look straight at the lens with both ears and both cheeks equally visible.",
    };
  }
  if (Math.abs(quality.pitchDeg) > FRONT_PITCH_OK) {
    return {
      title: "Sorry, the camera angle is too high or low.",
      detail: "Keep the camera at eye level and your chin neutral—not tipped up or tucked down.",
    };
  }
  if (Math.abs(quality.rollDeg) > FRONT_ROLL_OK) {
    return {
      title: "Sorry, your head is tilted in this photo.",
      detail: "Hold your head upright so the eye line is level.",
    };
  }
  if (quality.smileScore > FRONT_SMILE_OK) {
    return {
      title: "Sorry, we need a neutral expression.",
      detail: "Relax your mouth and jaw. Smiling changes the lip, cheek and jaw measurements.",
    };
  }
  if (occlusion?.glassesStrong) {
    return {
      title: "Sorry, the eye area appears to be covered.",
      detail: "Remove glasses and anything crossing the eyes or brows, then use a clear photo without a hat or hood.",
    };
  }
  if (stats.luma < PHOTO_DARK) {
    return {
      title: "Sorry, the face is too dark to inspect accurately.",
      detail: "Use soft, even light from in front. Avoid a bright window behind you.",
    };
  }
  if (stats.luma > PHOTO_BRIGHT) {
    return {
      title: "Sorry, highlights are blown out in this photo.",
      detail: "Move out of direct sunlight so skin colour and texture remain visible.",
    };
  }
  if (stats.sharpness < PHOTO_SHARP_WARN) {
    return {
      title: "Sorry, that photo is too soft or blurred.",
      detail: "Use an in-focus original with no beauty filter, portrait blur, smoothing or heavy compression.",
    };
  }
  return null;
}

export function sidePhotoRejection(
  quality: QualityCheck,
  stats: FrameStats,
  silhouette: SideSilhouetteCheck,
  width: number,
  height: number,
): PhotoRejection | null {
  if (Math.min(width, height) < 480) {
    return {
      title: "Sorry, that profile photo is too small.",
      detail: "Use the original image with the full head and neck visible—not a screenshot or thumbnail.",
    };
  }
  if (stats.luma < PHOTO_DARK || stats.luma > PHOTO_BRIGHT) {
    return {
      title: "Sorry, the profile is not evenly lit enough.",
      detail: "Use soft light from the side of the camera so the brow, nose, lips, chin and jaw edge are all visible.",
    };
  }
  if (stats.sharpness < PHOTO_SHARP_WARN) {
    return {
      title: "Sorry, that profile photo is too blurred.",
      detail: "Use a sharp original with no portrait blur, smoothing or beauty filter.",
    };
  }
  if (silhouette.reason === "cropped") {
    return {
      title: "Sorry, part of the profile is cut off.",
      detail: "Show the full forehead, nose, lips, chin, jaw, ear and neck with space around the head.",
    };
  }
  if (quality.faceFound && Math.abs(quality.yawDeg) < 75) {
    return {
      title: "Sorry, you are not sideways enough in this photo.",
      detail: "Use a full 90° profile: one ear toward the camera, nose in silhouette, eyes looking straight ahead.",
    };
  }
  if (quality.faceFound && (quality.pitchDeg < -8 || quality.pitchDeg > 26)) {
    return {
      title: "Sorry, your chin angle hides part of the profile.",
      detail: "Keep your head level so the jaw corner and the line under your chin are visible.",
    };
  }
  if (!silhouette.usable) {
    const copy: Record<NonNullable<SideSilhouetteCheck["reason"]>, PhotoRejection> = {
      "no-head": {
        title: "Sorry, we couldn't verify a head in that profile photo.",
        detail: "Use a clear photo against a plain background, with your full head and neck visible.",
      },
      cropped: {
        title: "Sorry, part of the profile is cut off.",
        detail: "Show the full forehead, nose, lips, chin, jaw, ear and neck with space around the head.",
      },
      "too-small": {
        title: "Sorry, the profile is too small in the frame.",
        detail: "Move closer or use a tighter original photo while keeping the full head visible.",
      },
      "not-profile": {
        title: "Sorry, we couldn't verify a full side profile.",
        detail: "Use a full 90° profile against a plain background, or use the guided camera instead.",
      },
    };
    return copy[silhouette.reason ?? "not-profile"];
  }
  return null;
}
