import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { FrameStats } from "./captureGuide.ts";
import type { Occlusion } from "./occlusion.ts";
import {
  frontPhotoRejection,
  headCoveringRejection,
  sidePhotoRejection,
  type SideSilhouetteCheck,
} from "./photoEligibility.ts";
import type { QualityCheck } from "./quality.ts";

const quality = (overrides: Partial<QualityCheck> = {}): QualityCheck => ({
  faceFound: true,
  yawDeg: 0,
  pitchDeg: 0,
  rollDeg: 0,
  faceWidthFrac: 0.42,
  smileScore: 0.05,
  frontal: true,
  largeEnough: true,
  neutralExpression: true,
  pass: true,
  issues: [],
  ...overrides,
});

const stats: FrameStats = { luma: 128, sharpness: 0.45 };
const occlusion: Occlusion = {
  bridge: 1,
  glasses: false,
  glassesStrong: false,
};
const landmarks = [
  { x: 0.2, y: 0.1, z: 0 },
  { x: 0.8, y: 0.9, z: 0 },
] as NormalizedLandmark[];
const silhouette = (overrides: Partial<SideSilhouetteCheck> = {}): SideSilhouetteCheck => ({
  usable: true,
  reason: null,
  headHeightFrac: 0.72,
  headWidthFrac: 0.55,
  nasalRelief: 0.06,
  ...overrides,
});

test("a clear straight front photo passes the upload gate", () => {
  assert.equal(frontPhotoRejection(quality(), stats, occlusion, landmarks, 1200, 1600), null);
});

test("front uploads reject diagonal pose instead of silently pose-correcting it", () => {
  const rejection = frontPhotoRejection(quality({ yawDeg: 11 }), stats, occlusion, landmarks, 1200, 1600);
  assert.match(rejection?.title ?? "", /turned too far/i);
});

test("front uploads reject covered eyes, blur and cropped faces", () => {
  assert.match(
    frontPhotoRejection(quality(), stats, { ...occlusion, glassesStrong: true }, landmarks, 1200, 1600)?.detail ?? "",
    /Remove glasses/i,
  );
  assert.match(
    frontPhotoRejection(quality(), { ...stats, sharpness: 0.2 }, occlusion, landmarks, 1200, 1600)?.title ?? "",
    /blurred/i,
  );
  const cropped = [{ x: 0.01, y: 0.1, z: 0 }, landmarks[1]] as NormalizedLandmark[];
  assert.match(frontPhotoRejection(quality(), stats, occlusion, cropped, 1200, 1600)?.title ?? "", /cut off/i);
});

test("side uploads reject a detected three-quarter view", () => {
  const rejection = sidePhotoRejection(quality({ yawDeg: 42 }), stats, silhouette(), 1200, 1600);
  assert.match(rejection?.title ?? "", /not sideways enough/i);
});

test("a detected turn still rejects a profile whose anatomy is cropped", () => {
  const rejection = sidePhotoRejection(
    quality({ yawDeg: 70 }),
    stats,
    silhouette({ usable: false, reason: "cropped" }),
    1200,
    1600,
  );
  assert.match(rejection?.title ?? "", /cut off/i);
});

test("a strong three-quarter turn is still not a full profile", () => {
  const rejection = sidePhotoRejection(quality({ yawDeg: 70 }), stats, silhouette(), 1200, 1600);
  assert.match(rejection?.title ?? "", /not sideways enough/i);
});

test("detector loss is not accepted as proof of a side profile", () => {
  const noFace = quality({ faceFound: false, pass: false });
  const rejection = sidePhotoRejection(
    noFace,
    stats,
    silhouette({ usable: false, reason: "not-profile", nasalRelief: 0.01 }),
    1200,
    1600,
  );
  assert.match(rejection?.title ?? "", /couldn't verify a full side profile/i);
});

test("a full profile may pass through its independently verified silhouette", () => {
  const noFace = quality({ faceFound: false, pass: false });
  assert.equal(sidePhotoRejection(noFace, stats, silhouette(), 1200, 1600), null);
});

test("hat and hood segmentation produce specific retake copy", () => {
  assert.match(
    headCoveringRejection({ available: true, hatLikely: true, hoodLikely: false, topCoverRatio: 0.2, sideCoverRatio: 0 })?.title ?? "",
    /hat or accessory/i,
  );
  assert.match(
    headCoveringRejection({ available: true, hatLikely: false, hoodLikely: true, topCoverRatio: 0, sideCoverRatio: 0.2 })?.detail ?? "",
    /Take the hood down/i,
  );
});
