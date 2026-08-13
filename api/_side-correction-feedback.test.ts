import assert from "node:assert/strict";
import test from "node:test";
import { SIDE_POINTS } from "../src/engine/sideMetrics.js";
import {
  SIDE_FEEDBACK_CONSENT_VERSION,
  createSideFeedbackIntent,
  movedSidePointIds,
} from "../src/engine/sideFeedbackPayload.js";
import type { SidePoints } from "../src/engine/sideMetrics.js";
import { isJpeg, jpegDimensions, parseSideFeedbackMetadata } from "./side-correction-feedback.js";

function points(): SidePoints {
  return Object.fromEntries(SIDE_POINTS.map(({ id }, index) => [id, {
    x: 40 + index * 4,
    y: 50 + index * 5,
  }])) as SidePoints;
}

test("declining correction feedback creates no upload intent", () => {
  assert.equal(createSideFeedbackIntent(
    false,
    "b42ad7cd-2285-4f0a-82f8-f075588101f9",
    points(),
    "mesh",
  ), null);
});

test("consent snapshots the automatic points instead of retaining a mutable reference", () => {
  const original = points();
  const intent = createSideFeedbackIntent(
    true,
    "b42ad7cd-2285-4f0a-82f8-f075588101f9",
    original,
    "silhouette",
  );
  assert.ok(intent);
  original.nasion.x += 50;
  assert.notEqual(intent.automaticPoints.nasion.x, original.nasion.x);
});

test("feedback parser accepts the full labelled pair and identifies only moved points", () => {
  const automatic = points();
  const corrected = points();
  corrected.tragion.x += 12;
  const parsed = parseSideFeedbackMetadata(JSON.stringify({
    submissionId: "b42ad7cd-2285-4f0a-82f8-f075588101f9",
    consentVersion: SIDE_FEEDBACK_CONSENT_VERSION,
    faceDir: 1,
    width: 400,
    height: 500,
    seedMethod: "mesh",
    automaticPoints: automatic,
    correctedPoints: corrected,
  }));
  assert.equal(parsed.seedMethod, "mesh");
  assert.deepEqual(movedSidePointIds(automatic, corrected), ["tragion"]);
});

test("feedback parser rejects missing landmarks and files must have JPEG boundaries", () => {
  const automatic = points();
  delete (automatic as Partial<SidePoints>).nasion;
  assert.throws(() => parseSideFeedbackMetadata(JSON.stringify({
    submissionId: "b42ad7cd-2285-4f0a-82f8-f075588101f9",
    consentVersion: SIDE_FEEDBACK_CONSENT_VERSION,
    faceDir: -1,
    width: 400,
    height: 500,
    seedMethod: "silhouette",
    automaticPoints: automatic,
    correctedPoints: points(),
  })), /nasion/);
  assert.equal(isJpeg(new Uint8Array([0xff, 0xd8, 0x00, 0xff, 0xd9])), true);
  assert.equal(isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), false);
});

test("JPEG dimensions are read from the file instead of trusting client metadata", () => {
  const jpeg = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    0x01, 0xf4, // 500 high
    0x01, 0x90, // 400 wide
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
  assert.deepEqual(jpegDimensions(jpeg), { width: 400, height: 500 });
  assert.equal(jpegDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), null);
});
