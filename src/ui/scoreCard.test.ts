import test from "node:test";
import assert from "node:assert/strict";
import { topPct } from "./scoreCard.js";
import { aggregateScoreToPercentile } from "../engine/scoring.js";
import { statedPct } from "../engine/precision.js";

test("the card never prints a precision the sample cannot support", () => {
  // The whole reason this goes through statedPct. A card claiming "top 12.4%"
  // is making a resolution claim about a reference population that does not
  // support one, and it is the first thing a competitor would screenshot.
  for (let p = 1; p <= 99; p++) {
    const top = topPct(p);
    assert.equal(top, Math.max(1, 100 - statedPct(p)), `p=${p}`);
    assert.equal(top, Math.round(top), `p=${p} produced a fractional percentage`);
  }
});

test("top-N never reads as zero", () => {
  // "Top 0%" is nonsense and would appear for anyone the curve puts at the very
  // end. One is the floor.
  assert.ok(topPct(100) >= 1);
  assert.ok(topPct(99.9) >= 1);
});

test("a modest score gain is a large rank gain in the middle", () => {
  // The claim the card is built on: the scale is a population curve that is
  // steepest where most people sit, so 0.9 of a point near the median moves
  // rank far more than the number suggests. If this stops being true the card
  // should stop leading with the percentile, so it is asserted rather than
  // assumed.
  const now = aggregateScoreToPercentile(5.4);
  const potential = aggregateScoreToPercentile(6.3);
  assert.ok(potential > now, "potential must rank above current");
  assert.ok(
    potential - now > 15,
    `0.9 of a point near the median moved rank by only ${(potential - now).toFixed(1)} points`,
  );
});

test("rank gain is smaller out in the tail than in the middle", () => {
  // The same 0.9 of a point buys much less once somebody is already rare, which
  // is the honest shape of a curve and the reason the card cannot promise a
  // fixed improvement to everybody.
  const middle = aggregateScoreToPercentile(5.4) - aggregateScoreToPercentile(4.5);
  const tail = aggregateScoreToPercentile(8.4) - aggregateScoreToPercentile(7.5);
  assert.ok(middle > tail, `middle ${middle.toFixed(1)} should exceed tail ${tail.toFixed(1)}`);
});
