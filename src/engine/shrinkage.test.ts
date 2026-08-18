import test from "node:test";
import assert from "node:assert/strict";
import { aggregateScoreToPercentile } from "./scoring.js";
import { NOISE } from "./followUp.js";

// ---------------------------------------------------------------------------
// The scale's range, and the arithmetic that has to agree with the copy.
//
// This file pins the properties of the current conservative aggregate
// calibration. "5.0 is the exact middle face" and "8.0 is about 1 in 100"
// are claims a reader can check, so the tests check them too — and pin the
// round trip, because the original defect was that the forward and inverse
// paths disagreed and nothing noticed for months.
// ---------------------------------------------------------------------------

// Where a face at this population percentile displays, found by inverting the
// display curve rather than reimplementing it — so the test cannot drift away
// from the thing it is testing.
const scoreAtPct = (target: number): number => {
  let lo = 0.5;
  let hi = 9.9;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (aggregateScoreToPercentile(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};

test("the median is exactly 5.0", () => {
  assert.equal(aggregateScoreToPercentile(5.0), 50);
});

test("the scale is monotonic", () => {
  let previous = -1;
  for (let s = 3.3; s <= 9.9; s += 0.1) {
    const p = aggregateScoreToPercentile(Math.round(s * 10) / 10);
    assert.ok(p >= previous, `score ${s.toFixed(1)} gave ${p}, below the previous ${previous}`);
    previous = p;
  }
});

test("the top of the scale is reachable", () => {
  // 8.0 is the number the education screen names as roughly one in a hundred,
  // so the 99th percentile has to land on it.
  const top = scoreAtPct(99);
  assert.ok(top > 7.8 && top < 8.3, `99th percentile scores ${top.toFixed(2)}, expected ~8.0`);

  // And the range has to be usable across its whole length, not just at the
  // top: a scale where p90 and p99 are neighbours cannot separate the people
  // this product is for.
  const p90 = scoreAtPct(90);
  const p50 = scoreAtPct(50);
  assert.ok(top - p90 > 1.0, `p90 ${p90.toFixed(2)} and p99 ${top.toFixed(2)} are too close`);
  assert.ok(p90 - p50 > 1.2, `p50 ${p50.toFixed(2)} and p90 ${p90.toFixed(2)} are too close`);
});

test("score and percentile agree in both directions", () => {
  // Forward and inverse must use the same calibrated display curve.
  for (const p of [10, 25, 50, 75, 90, 95, 99]) {
    const score = scoreAtPct(p);
    const back = aggregateScoreToPercentile(Math.round(score * 10) / 10);
    assert.ok(
      Math.abs(back - p) < 1.5,
      `p${p} -> score ${score.toFixed(2)} -> p${back.toFixed(1)}: the round trip does not close`,
    );
  }
});

test("the rarity ladder matches what the engine can actually produce", () => {
  // The education screen prints these rungs. Each one must be a percentile a
  // face can genuinely reach, or the screen is teaching a scale that does not
  // exist.
  const eight = aggregateScoreToPercentile(8.0);
  assert.ok(eight > 97.5 && eight < 99.5, `8.0 reports p${eight}, expected ~99`);
  const seven = aggregateScoreToPercentile(7.0);
  assert.ok(seven > 92 && seven < 96, `7.0 reports p${seven}, expected ~94`);
});

test("the noise floor tracks the display spread", () => {
  // The coupling that would silently break everything. Two photographs of one
  // unchanged face differ by about 0.53 points on the calibrated scale, so a
  // follow-up floor below that INVENTS progress — it would cheerfully report a
  // one-point jump between two photographs of a face that did not change.
  //
  // The 0.6 floor rounds the estimate upward so it does not invent progress.
  assert.ok(NOISE >= 0.53, `${NOISE} is below the calibrated same-face spread and would invent progress`);
  assert.ok(NOISE < 0.8, `${NOISE} is too far above the calibrated spread and would hide genuine progress`);
});
