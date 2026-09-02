import assert from "node:assert/strict";
import test from "node:test";
import { SIDE_POINTS } from "../engine/sideMetrics.js";
import { parseCloudSidePlacement } from "./sideCloudPlacement.js";

test("cloud side placement requires and scales all thirteen points", () => {
  const points = Object.fromEntries(SIDE_POINTS.map(({ id }, index) => [
    id,
    { x: 0.2 + index * 0.01, y: 0.1 + index * 0.02 },
  ]));
  const confidence = Object.fromEntries(SIDE_POINTS.map(({ id }, index) => [id, 0.4 + index * 0.04]));
  const result = parseCloudSidePlacement({ points, confidence, faceDir: 1, version: "pass-v2" }, 1_000, 500);

  assert.ok(result);
  assert.deepEqual(result.points.trichion, { x: 200, y: 50 });
  assert.equal(result.points.tragion.x, 320);
  assert.equal(result.faceDir, 1);
  assert.equal(result.seedVersion, "pass-v2");
  assert.ok(result.confidence > 0.6 && result.confidence < 0.7);
});

test("cloud side placement rejects partial, out-of-frame and incomplete-confidence results", () => {
  const points = Object.fromEntries(SIDE_POINTS.map(({ id }) => [id, { x: 0.5, y: 0.5 }]));
  const confidence = Object.fromEntries(SIDE_POINTS.map(({ id }) => [id, 0.8]));

  const partial = { ...points };
  delete partial.tragion;
  assert.equal(parseCloudSidePlacement({ points: partial, confidence, faceDir: 1 }, 500, 500), null);

  const outside = { ...points, pronasale: { x: 1.1, y: 0.5 } };
  assert.equal(parseCloudSidePlacement({ points: outside, confidence, faceDir: 1 }, 500, 500), null);

  const partialConfidence = { ...confidence };
  delete partialConfidence.gonion;
  assert.equal(parseCloudSidePlacement({ points, confidence: partialConfidence, faceDir: 1 }, 500, 500), null);
});
