import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FORMULA,
  engagementFactor,
  unlocked,
  unlockProgress,
  videoEarnedCents,
  creatorAccruedCents,
  poolScale,
  formulaFrom,
} from "./earnings.js";

// The money math, continuous edition. Every case is a payout dispute
// pre-settled — same discipline as tiers.test.ts.

const F = DEFAULT_FORMULA;

test("237k views at par engagement pays what it is worth, not zero", () => {
  // The whole point of replacing the ladder: ~237k comments-at-par ⇒ ~$475.
  const v = { views: 237_500, comments: 95 }; // exactly 0.40 per 1k = par
  assert.equal(creatorAccruedCents(F, [v]), 47_500);
});

test("below the unlock threshold nothing shows", () => {
  assert.equal(creatorAccruedCents(F, [{ views: 24_999, comments: 500 }]), 0);
  assert.equal(creatorAccruedCents(F, [{ views: 500_000, comments: 24 }]), 0);
});

test("crossing the threshold pays retroactively over ALL views", () => {
  // 24,900 views: $0. A hundred more views later: the whole run is worth
  // money, not just the hundred.
  const before = [{ views: 24_900, comments: 40 }];
  const after = [{ views: 25_000, comments: 40 }];
  assert.equal(creatorAccruedCents(F, before), 0);
  assert.ok(creatorAccruedCents(F, after) >= 5_000); // ≥ $50 for 25k at par-ish
});

test("silent comment sections earn half-rate, hot ones up to 1.3x", () => {
  assert.equal(engagementFactor(F, { views: 100_000, comments: 0 }), 0.5);
  assert.equal(engagementFactor(F, { views: 100_000, comments: 40 }), 1.0);
  assert.equal(engagementFactor(F, { views: 100_000, comments: 10_000 }), 1.3);
});

test("a botted video cannot dilute the rate on an honest one", () => {
  // E is per video: the farm upload earns half-rate on its own views and
  // leaves the honest video's full rate untouched.
  const honest = { views: 100_000, comments: 60 }; // above par
  const botted = { views: 100_000, comments: 2 }; // silent
  const together = creatorAccruedCents(F, [honest, botted]);
  const honestAlone = videoEarnedCents(F, honest);
  const bottedAlone = videoEarnedCents(F, botted);
  assert.equal(together, honestAlone + bottedAlone);
  assert.ok(bottedAlone < honestAlone);
});

test("per-video and per-creator caps hold", () => {
  // One monster video hits the video cap...
  assert.equal(videoEarnedCents(F, { views: 10_000_000, comments: 4_000 }), F.videoCapCents);
  // ...and a fleet of them hits the creator cap.
  const fleet = Array.from({ length: 10 }, () => ({ views: 10_000_000, comments: 4_000 }));
  assert.equal(creatorAccruedCents(F, fleet), F.creatorCapCents);
});

test("the unlock bar tracks the SHORTER floor", () => {
  // 90% of views but 20% of comments must not read as 90%.
  const p = unlockProgress(F, { views: 22_500, comments: 5 });
  assert.ok(Math.abs(p - 0.2) < 1e-9);
  assert.equal(unlocked(F, { views: 22_500, comments: 5 }), false);
});

test("the pool scales everyone pro-rata only when it must", () => {
  assert.equal(poolScale(500_000, 400_000), 1);
  assert.equal(poolScale(500_000, 1_000_000), 0.5);
  assert.equal(poolScale(500_000, 0), 1);
});

test("a stored formula fills gaps from defaults and survives junk", () => {
  assert.equal(formulaFrom(null), null);
  assert.equal(formulaFrom("x"), null);
  const f = formulaFrom({ rpmCents: 300 })!;
  assert.equal(f.rpmCents, 300);
  assert.equal(f.parCommentsPer1k, F.parCommentsPer1k);
  // A zero par would divide by zero downstream; it falls back instead.
  assert.equal(formulaFrom({ parCommentsPer1k: 0 })!.parCommentsPer1k, F.parCommentsPer1k);
});
