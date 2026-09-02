import assert from "node:assert/strict";
import test from "node:test";
import { SIDE_POINTS } from "../src/engine/sideMetrics.js";
import {
  SIDE_FEEDBACK_CONSENT_VERSION,
  createSideFeedbackIntent,
  movedSidePointIds,
} from "../src/engine/sideFeedbackPayload.js";
import type { SidePoints } from "../src/engine/sideMetrics.js";
import {
  SIDE_FEEDBACK_LIST_FIELDS,
  isJpeg,
  jpegDimensions,
  parseFeedbackRevocation,
  parseSideFeedbackMetadata,
} from "./side-correction-feedback.js";

const SCAN_ID = "a42ad7cd-2285-4f0a-82f8-f075588101f8";
const SUBMISSION_ID = "b42ad7cd-2285-4f0a-82f8-f075588101f9";

function points(): SidePoints {
  return Object.fromEntries(SIDE_POINTS.map(({ id }, index) => [id, {
    x: 40 + index * 4,
    y: 50 + index * 5,
  }])) as SidePoints;
}

test("declining correction feedback creates no upload intent", () => {
  assert.equal(createSideFeedbackIntent(
    false,
    SCAN_ID,
    SUBMISSION_ID,
    points(),
    "mesh",
  ), null);
});

test("consent snapshots the automatic points instead of retaining a mutable reference", () => {
  const original = points();
  const intent = createSideFeedbackIntent(
    true,
    SCAN_ID,
    SUBMISSION_ID,
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
    scanId: SCAN_ID,
    submissionId: SUBMISSION_ID,
    consentVersion: SIDE_FEEDBACK_CONSENT_VERSION,
    faceDir: 1,
    width: 400,
    height: 500,
    seedMethod: "mesh",
    automaticPoints: automatic,
    correctedPoints: corrected,
  }));
  assert.equal(parsed.seedMethod, "mesh");
  assert.equal(parsed.scanId, SCAN_ID);
  assert.deepEqual(movedSidePointIds(automatic, corrected), ["tragion"]);
});

test("feedback parser keeps the cloud seed version for comparable calibration", () => {
  const parsed = parseSideFeedbackMetadata(JSON.stringify({
    scanId: SCAN_ID,
    submissionId: SUBMISSION_ID,
    consentVersion: SIDE_FEEDBACK_CONSENT_VERSION,
    faceDir: 1,
    width: 400,
    height: 500,
    seedMethod: "vision",
    seedVersion: "pass-v2",
    automaticPoints: points(),
    correctedPoints: points(),
  }));
  assert.equal(parsed.seedMethod, "vision");
  assert.equal(parsed.seedVersion, "pass-v2");
});

test("feedback parser rejects missing landmarks and files must have JPEG boundaries", () => {
  const automatic = points();
  delete (automatic as Partial<SidePoints>).nasion;
  assert.throws(() => parseSideFeedbackMetadata(JSON.stringify({
    scanId: SCAN_ID,
    submissionId: SUBMISSION_ID,
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

test("revocation requires both immutable submission and scan IDs", () => {
  assert.deepEqual(parseFeedbackRevocation({
    submissionId: SUBMISSION_ID,
    scanId: SCAN_ID,
  }), {
    submissionId: SUBMISSION_ID,
    scanId: SCAN_ID,
  });
  assert.throws(() => parseFeedbackRevocation({ submissionId: SUBMISSION_ID }), /Scan ID/);
  assert.throws(() => parseFeedbackRevocation({
    submissionId: "not-a-uuid",
    scanId: SCAN_ID,
  }), /Submission ID/);
  assert.throws(() => parseFeedbackRevocation([]), /missing/);
});

test("account feedback lists expose lifecycle metadata only", () => {
  assert.equal(SIDE_FEEDBACK_LIST_FIELDS, "id,scan_id,created_at,expires_at,consent_version");
  assert.doesNotMatch(SIDE_FEEDBACK_LIST_FIELDS, /storage|points|sha|review|notes/);
});
