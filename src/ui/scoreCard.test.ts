import test from "node:test";
import assert from "node:assert/strict";
import { scoreCardRank } from "./scoreCard.js";
import { aggregateScoreToPercentile } from "../engine/scoring.js";

test("the card names the correct side of the population", () => {
  assert.equal(scoreCardRank(1), "Bottom 1%");
  assert.equal(scoreCardRank(10), "Bottom 10%");
  // 47 rounds to the honest five-point display precision. At 48/49 the
  // displayed standing is exactly the median and therefore reads Top 50%.
  assert.equal(scoreCardRank(47), "Bottom 45%");
  assert.equal(scoreCardRank(50), "Top 50%");
  assert.equal(scoreCardRank(80), "Top 20%");
  assert.equal(scoreCardRank(95), "Top 5%");
  assert.equal(scoreCardRank(100), "Top 1%");
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
