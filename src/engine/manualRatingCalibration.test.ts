import test from "node:test";
import assert from "node:assert/strict";
import { calibrateSupportingScores } from "./manualRatingCalibration.js";

test("supporting scores follow the primary while preserving strengths and weaknesses", () => {
  const original = [6.9, 6.6, 4.7, 4.4];
  const calibrated = calibrateSupportingScores(original, 7.5);

  assert.deepEqual(original, [6.9, 6.6, 4.7, 4.4], "the source scores must not be mutated");
  assert.deepEqual(calibrated, [8.8, 8.5, 6.6, 6.3]);
  assert.ok(calibrated[0] > calibrated[1]);
  assert.ok(calibrated[1] > calibrated[2]);
  assert.ok(calibrated[2] > calibrated[3]);
  const mean = calibrated.reduce((sum, score) => sum + score, 0) / calibrated.length;
  assert.ok(Math.abs(mean - 7.5) <= 0.05, `supporting mean ${mean} did not follow 7.5`);
});

test("a lower primary produces an unambiguously low supporting set", () => {
  assert.deepEqual(calibrateSupportingScores([6.9, 6.6, 4.7, 4.4], 3.5), [4.8, 4.4, 2.6, 2.3]);
});

test("extreme primary ratings compress the spread instead of clipping the ordering", () => {
  assert.deepEqual(calibrateSupportingScores([8, 6, 4], 9.5), [10, 9.5, 9]);
  assert.deepEqual(calibrateSupportingScores([8, 6, 4], 0.5), [1, 0.5, 0]);
});

test("empty and invalid inputs stay safe", () => {
  assert.deepEqual(calibrateSupportingScores([], 7), []);
  assert.deepEqual(calibrateSupportingScores([Number.NaN, 6], 7), [7.5, 6.5]);
  assert.deepEqual(calibrateSupportingScores([4, 6], Number.NaN), [4, 6]);
  assert.deepEqual(calibrateSupportingScores([Number.NaN], Number.NaN), [5]);
});
