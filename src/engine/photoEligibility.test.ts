import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { FrameStats } from "./captureGuide.js";
import type { Occlusion } from "./occlusion.js";
import {
  frontPhotoRejection,
  headCoveringRejection,
  sidePhotoRejection,
  type SideSilhouetteCheck,
} from "./photoEligibility.js";
import type { QualityCheck } from "./quality.js";

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

const stats: FrameStats = { luma: 128, lumaHigh: 190, darkShare: 0.01, sharpness: 0.45 };
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

test("front uploads reject only a genuinely diagonal pose", () => {
  const rejection = frontPhotoRejection(quality({ yawDeg: 27 }), stats, occlusion, landmarks, 1200, 1600);
  assert.match(rejection?.title ?? "", /turned too far/i);
});

// The gate still exists; it just sits where the measurements actually need it.
// A hand-held phone is never dead square to a face, and refusing eleven degrees
// of turn — comfortably inside the envelope assessQuality pose-corrects over —
// rejected photographs that were fine and asked people to fix a tilt the engine
// had already removed.
test("front uploads accept the ordinary imprecision of a hand-held phone", () => {
  assert.equal(frontPhotoRejection(quality({ yawDeg: 11 }), stats, occlusion, landmarks, 1200, 1600), null);
  assert.equal(frontPhotoRejection(quality({ yawDeg: 20 }), stats, occlusion, landmarks, 1200, 1600), null);
  assert.equal(frontPhotoRejection(quality({ pitchDeg: 15 }), stats, occlusion, landmarks, 1200, 1600), null);
});

test("a detectable face is not rejected because the downloaded image is small", () => {
  assert.equal(frontPhotoRejection(quality(), stats, occlusion, landmarks, 320, 460), null);
  assert.equal(sidePhotoRejection(quality({ yawDeg: 55 }), stats, silhouette(), 320, 460), null);
});

test("front uploads reject covered eyes, severe blur and cropped faces", () => {
  assert.match(
    frontPhotoRejection(quality(), stats, { ...occlusion, glassesStrong: true }, landmarks, 1200, 1600)?.detail ?? "",
    /Remove glasses/i,
  );
  assert.match(
    frontPhotoRejection(quality(), { ...stats, sharpness: 0.12 }, occlusion, landmarks, 1200, 1600)?.title ?? "",
    /blurred/i,
  );
  const cropped = [{ x: 0.001, y: 0.1, z: 0 }, landmarks[1]] as NormalizedLandmark[];
  assert.match(frontPhotoRejection(quality(), stats, occlusion, cropped, 1200, 1600)?.title ?? "", /cut off/i);
});

test("a usable webcam frame between the focus warning and block floor is accepted", () => {
  assert.equal(
    frontPhotoRejection(quality(), { ...stats, sharpness: 0.2 }, occlusion, landmarks, 1200, 1600),
    null,
  );
  assert.equal(
    sidePhotoRejection(quality({ faceFound: false, pass: false }), { ...stats, sharpness: 0.2 }, silhouette(), 1200, 1600),
    null,
  );
});

test("side uploads reject only a clearly frontal detected face", () => {
  assert.match(sidePhotoRejection(quality({ yawDeg: 20 }), stats, silhouette(), 1200, 1600)?.title ?? "", /not sideways enough/i);
  assert.equal(sidePhotoRejection(quality({ yawDeg: 42 }), stats, silhouette(), 1200, 1600), null);
});

test("a detected profile ignores a background silhouette crop false-positive", () => {
  const rejection = sidePhotoRejection(
    quality({ yawDeg: 70 }),
    stats,
    silhouette({ usable: false, reason: "cropped" }),
    1200,
    1600,
  );
  assert.equal(rejection, null);
});

test("a strong, measurable turn is accepted even when it is not mathematically 90 degrees", () => {
  const rejection = sidePhotoRejection(quality({ yawDeg: 70 }), stats, silhouette(), 1200, 1600);
  assert.equal(rejection, null);
});

test("a relaxed partial smile passes but a broad smile still blocks", () => {
  assert.equal(frontPhotoRejection(quality({ smileScore: 0.55 }), stats, occlusion, landmarks, 1200, 1600), null);
  assert.match(frontPhotoRejection(quality({ smileScore: 0.72 }), stats, occlusion, landmarks, 1200, 1600)?.title ?? "", /neutral expression/i);
});

test("detector uncertainty proceeds to review unless no head exists", () => {
  const noFace = quality({ faceFound: false, pass: false });
  assert.equal(sidePhotoRejection(noFace, stats, silhouette({ usable: false, reason: "not-profile", nasalRelief: 0.01 }), 1200, 1600), null);
  assert.equal(sidePhotoRejection(noFace, stats, silhouette({ usable: false, reason: "cropped" }), 1200, 1600), null);
  assert.match(sidePhotoRejection(noFace, stats, silhouette({ usable: false, reason: "no-head" }), 1200, 1600)?.title ?? "", /find a face/i);
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
