import test from "node:test";
import assert from "node:assert/strict";
import { measurementsOf } from "./calibrationSet.js";
import type { Report } from "./types.js";

// Only `metrics` is read, so the rest of a Report is noise here.
const reportWith = (metrics: Array<[string, "front" | "side", number]>): Report =>
  ({
    metrics: metrics.map(([id, view, value]) => ({ def: { id, view }, value })),
  }) as unknown as Report;

test("merges front and side into one row", () => {
  const front = reportWith([["fwhr", "front", 1.9], ["lipRatio", "front", 0.5]]);
  const side = reportWith([["chinProjection", "side", 12], ["gonialAngle", "side", 121]]);
  assert.deepEqual(measurementsOf(front, side), {
    fwhr: 1.9,
    lipRatio: 0.5,
    chinProjection: 12,
    gonialAngle: 121,
  });
});

test("a front-only face is still a full front row", () => {
  const front = reportWith([["fwhr", "front", 1.9]]);
  assert.deepEqual(measurementsOf(front), { fwhr: 1.9 });
});

// The property the corpus format depends on: an absent view contributes
// nothing rather than nulls, which is the same shape as a metric that
// postdates the face. One absence mechanism, not two.
test("an unmeasurable metric is omitted, never written as null", () => {
  const front = reportWith([
    ["fwhr", "front", 1.9],
    ["foreheadRatio", "front", Number.NaN],
    ["midfaceRatio", "front", Number.POSITIVE_INFINITY],
  ]);
  const out = measurementsOf(front);
  assert.deepEqual(out, { fwhr: 1.9 });
  assert.ok(!("foreheadRatio" in out));
  assert.ok(!("midfaceRatio" in out));
});

test("no reports is an empty row, not a crash", () => {
  assert.deepEqual(measurementsOf(), {});
});
