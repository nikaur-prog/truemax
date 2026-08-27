import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TIERS, earnedCents, reachedTier, nextTier, combineLatest } from "./tiers.js";

// The money math. Every case here is a payout dispute pre-settled.

test("below the first rung earns nothing", () => {
  assert.equal(earnedCents(DEFAULT_TIERS, { views: 99_999, comments: 500 }), 0);
});

test("views without the comment floor earn nothing — the bot filter holds", () => {
  assert.equal(earnedCents(DEFAULT_TIERS, { views: 400_000, comments: 49 }), 0);
});

test("a reached tier pays its own amount, not the sum of the rungs", () => {
  assert.equal(earnedCents(DEFAULT_TIERS, { views: 550_000, comments: 250 }), 100_000);
});

test("the tier paid is the highest BOTH floors satisfy", () => {
  // A million views but only 150 comments: the 250k rung is the last one whose
  // comment floor is met.
  const t = reachedTier(DEFAULT_TIERS, { views: 1_200_000, comments: 150 });
  assert.equal(t?.cents, 50_000);
});

test("the progress bar tracks the SHORTER of the two floors", () => {
  const n = nextTier(DEFAULT_TIERS, { views: 90_000, comments: 10 });
  assert.equal(n?.tier.views, 100_000);
  // 90% of views but only 20% of comments — the bar must not say 90%.
  assert.ok(Math.abs((n?.progress ?? 0) - 0.2) < 1e-9);
});

test("past the top rung there is no next tier to sell", () => {
  assert.equal(nextTier(DEFAULT_TIERS, { views: 2_000_000, comments: 400 }), null);
});

test("totals combine the LATEST snapshot per video, not the maximum", () => {
  // Video A was revised down (purged views). Paying on the retracted number
  // is how a league loses its books.
  const totals = combineLatest([
    { submissionId: "a", at: 1, views: 120_000, comments: 60 },
    { submissionId: "a", at: 2, views: 80_000, comments: 55 },
    { submissionId: "b", at: 1, views: 30_000, comments: 10 },
  ]);
  assert.deepEqual(totals, { views: 110_000, comments: 65 });
});

test("an unordered ladder still resolves by view floor", () => {
  const shuffled = [DEFAULT_TIERS[2], DEFAULT_TIERS[0], DEFAULT_TIERS[3], DEFAULT_TIERS[1]];
  assert.equal(earnedCents(shuffled, { views: 260_000, comments: 120 }), 50_000);
});
