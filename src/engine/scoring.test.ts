import assert from "node:assert/strict";
import test from "node:test";
import { aggregateScoreToPercentile } from "./scoring.js";

test("headline midpoint stays anchored at the population median", () => {
  assert.equal(aggregateScoreToPercentile(5), 50);
});

test("editable scores invert the soft-floor curve below five", () => {
  assert.ok(aggregateScoreToPercentile(4.2) > 18);
  assert.ok(aggregateScoreToPercentile(4.2) < 24);
});

test("editable score percentiles remain monotonic", () => {
  assert.ok(aggregateScoreToPercentile(4.5) < aggregateScoreToPercentile(5));
  assert.ok(aggregateScoreToPercentile(5) < aggregateScoreToPercentile(6.5));
});
