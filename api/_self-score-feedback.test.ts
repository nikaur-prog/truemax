import assert from "node:assert/strict";
import test from "node:test";
import { parseSelfScorePayload } from "./self-score-feedback.js";

const VALID = {
  scanId: "10000000-0000-4000-8000-000000000001",
  ourScore: 7.4,
  selfScore: 8.1,
  sex: "male",
  consentVersion: "self-score-v1",
};

test("self-score parsing accepts only finite numeric scores", () => {
  assert.deepEqual(parseSelfScorePayload(VALID), VALID);
  for (const score of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "8.1", null]) {
    assert.throws(() => parseSelfScorePayload({ ...VALID, selfScore: score }));
    assert.throws(() => parseSelfScorePayload({ ...VALID, ourScore: score }));
  }
});

test("self-score parsing enforces canonical bounds and immutable scan IDs", () => {
  for (const score of [0.9, 10.1]) {
    assert.throws(() => parseSelfScorePayload({ ...VALID, selfScore: score }));
  }
  assert.throws(() => parseSelfScorePayload({ ...VALID, scanId: "not-a-scan" }));
});
