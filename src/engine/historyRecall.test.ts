import test from "node:test";
import assert from "node:assert/strict";
import type { StoredScan } from "./history.js";

// The recall screen is DOM, but the thing that decides what it can show is the
// stored row, and that is plain data. These pin the contract between the two:
// which fields a recalled scan may rely on, and what must still work when they
// are absent — because every scan already on somebody's device predates them.

const legacy: StoredScan = {
  scanId: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
  date: "2026-08-01T10:00:00.000Z",
  sex: "male",
  overall: 5.2,
  regions: { eyes: 5.5, jaw: 4.4 },
  scoreVersion: 2,
};

const current: StoredScan = {
  ...legacy,
  scanId: "aaaaaaaa-aaaa-4aaa-8aaa-000000000002",
  overallPercentile: 62,
  pillars: { Harmony: 6.2, Angularity: 5.4 },
  regionPercentiles: { eyes: 55, jaw: 30 },
  potential: 7.4,
};

test("the recall fields are all optional — an old row is still a valid scan", () => {
  // THE test for the schema change. Everything already written to a device
  // lacks these four, and a required field would mean a type error today and a
  // crash tomorrow on the first person who has used the app before.
  const asStored: StoredScan = legacy;
  assert.equal(asStored.overallPercentile, undefined);
  assert.equal(asStored.pillars, undefined);
  assert.equal(asStored.regionPercentiles, undefined);
  assert.equal(asStored.potential, undefined);
  // And the fields a trend has always depended on are untouched.
  assert.equal(typeof asStored.overall, "number");
  assert.equal(typeof asStored.date, "string");
  assert.ok(asStored.regions);
});

test("a scan with no standing is distinguishable from one standing at zero", () => {
  // The difference decides whether the recall draws a curve or says the
  // standing was not kept, and `!scan.overallPercentile` would collapse the two
  // — putting a face at the very bottom of the reference set into the "we
  // didn't record this" branch.
  const bottom: StoredScan = { ...legacy, overallPercentile: 0 };
  const hasStanding = (s: StoredScan) =>
    typeof s.overallPercentile === "number" && Number.isFinite(s.overallPercentile);
  assert.equal(hasStanding(bottom), true, "0 is a real standing, not a missing one");
  assert.equal(hasStanding(legacy), false);
  assert.equal(hasStanding(current), true);
  assert.equal(hasStanding({ ...legacy, overallPercentile: NaN }), false);
});

test("widening the row did not change what a trend reads", () => {
  // comparableScans and the delta maths only ever look at overall, date and
  // scoreVersion. A recalled-scan field must never leak into that.
  const trendKeys = ["date", "overall", "scoreVersion", "sex"] as const;
  for (const k of trendKeys) {
    assert.deepEqual(current[k], legacy[k], `${k} drifted between the two shapes`);
  }
});

test("region scores and region percentiles are separate things", () => {
  // Both are keyed by region and both are numbers, which is exactly how one
  // ends up rendered as the other. The scores are 0-10; the percentiles are
  // 0-100, and the recall screen draws bars from the SCORES.
  assert.equal(current.regions.eyes, 5.5);
  assert.equal(current.regionPercentiles?.eyes, 55);
  assert.notEqual(current.regions.eyes, current.regionPercentiles?.eyes);
});
