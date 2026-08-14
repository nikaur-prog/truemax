import test from "node:test";
import assert from "node:assert/strict";
import { TRIAL_SCANS, canSeeDepth, canSeePlan, depthFor, freeScansLeft, tierOf } from "./depth.js";
import type { Entitlement, EntitlementTier } from "./entitlement.js";

const ent = (tier: EntitlementTier, status = "active"): Entitlement => ({
  tier,
  status,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
});

test("the score and the ranking are never gated", () => {
  // The pitch is "we show the actual math". A paywall over the number itself
  // would make that a lie on the first screen, so "rating" is the floor and
  // there is no level below it.
  for (const scanCount of [0, 1, 2, 50]) {
    assert.notEqual(depthFor({ entitlement: null, scanCount }), undefined);
    assert.ok(["rating", "depth", "plan"].includes(depthFor({ entitlement: null, scanCount })));
  }
});

test("the first two scans are in full depth, the third is not", () => {
  assert.equal(depthFor({ entitlement: null, scanCount: 0 }), "depth");
  assert.equal(depthFor({ entitlement: null, scanCount: 1 }), "depth");
  assert.equal(depthFor({ entitlement: null, scanCount: 2 }), "rating");
  assert.equal(depthFor({ entitlement: null, scanCount: 9 }), "rating");
});

test("two scans, because one scan cannot show a delta", () => {
  // Guards the number itself. Dropping to one would end the trial before
  // anybody has seen their score move, which is the half of the product a
  // screenshot cannot convey.
  assert.equal(TRIAL_SCANS, 2);
});

test("starter buys depth, max buys the plan", () => {
  assert.equal(depthFor({ entitlement: ent("starter"), scanCount: 99 }), "depth");
  assert.equal(depthFor({ entitlement: ent("max"), scanCount: 99 }), "plan");
  assert.equal(canSeePlan({ entitlement: ent("starter"), scanCount: 0 }), false);
  assert.equal(canSeePlan({ entitlement: ent("max"), scanCount: 0 }), true);
});

test("a subscription is never downgraded by the scan count", () => {
  // The order of the checks matters: somebody who subscribed during their trial
  // must be served by the subscription, not cut off at the third scan.
  assert.equal(depthFor({ entitlement: ent("starter"), scanCount: 500 }), "depth");
  assert.equal(canSeeDepth({ entitlement: ent("max"), scanCount: 500 }), true);
});

test("a trialing subscription counts as live", () => {
  assert.equal(tierOf(ent("max", "trialing")), "max");
  assert.equal(depthFor({ entitlement: ent("max", "trialing"), scanCount: 0 }), "plan");
});

test("a lapsed subscription is free again", () => {
  for (const status of ["canceled", "past_due", "unpaid", "incomplete_expired", "none"]) {
    assert.equal(tierOf(ent("max", status)), "free", status);
    // And it falls back to the scan allowance rather than to depth — otherwise
    // cancelling would be a way to keep the paid product.
    assert.equal(depthFor({ entitlement: ent("max", status), scanCount: 5 }), "rating", status);
  }
});

test("a failed entitlement read locks rather than unlocks", () => {
  // loadEntitlement throws on a network failure and the caller passes null. The
  // safe direction is the paywall: it shows a wall to a paying customer, who can
  // retry, rather than handing the paid product to everybody during an outage.
  assert.equal(depthFor({ entitlement: null, scanCount: 5 }), "rating");
});

test("the remaining-scan count only speaks to free accounts", () => {
  assert.equal(freeScansLeft({ entitlement: null, scanCount: 0 }), 2);
  assert.equal(freeScansLeft({ entitlement: null, scanCount: 1 }), 1);
  assert.equal(freeScansLeft({ entitlement: null, scanCount: 2 }), 0);
  assert.equal(freeScansLeft({ entitlement: null, scanCount: 7 }), 0, "never negative");
  // A paying account has no allowance to report, and a sentence about free
  // scans on a paid screen reads as a downgrade notice.
  assert.equal(freeScansLeft({ entitlement: ent("starter"), scanCount: 0 }), 0);
});

test("a purchased credit opens depth past the allowance, and only depth", () => {
  // The non-subscription road through the gate. Credits never grant the plan
  // tier — that is Max's — and a member's depth comes from the membership, so
  // credits change nothing for them.
  assert.equal(depthFor({ entitlement: null, scanCount: 5, credits: 1 }), "depth");
  assert.equal(depthFor({ entitlement: null, scanCount: 5, credits: 0 }), "rating");
  assert.notEqual(depthFor({ entitlement: null, scanCount: 5, credits: 99 }), "plan");
  assert.equal(depthFor({ entitlement: ent("max"), scanCount: 5, credits: 1 }), "plan");
});

test("a staff account is never gated, and never spends anything to get there", () => {
  // The owner and testers have to scan repeatedly to check the product. This is
  // the only flag in the file that opens everything, so it is also the one that
  // most needs pinning: it must come from the caller (a database row), default
  // to closed, and not depend on tier or count.
  assert.equal(depthFor({ entitlement: null, scanCount: 999, admin: true }), "plan");
  assert.equal(depthFor({ entitlement: ent("max", "canceled"), scanCount: 999, admin: true }), "plan");
  assert.equal(canSeePlan({ entitlement: null, scanCount: 999, admin: true }), true);
});

test("staff defaults to off, so a failed read locks rather than unlocks", () => {
  // loadIsAdmin throws on a network failure and the caller passes false. Same
  // direction as every other gate here: a wall a real user can retry past,
  // never the paid product handed to everybody during an outage.
  assert.equal(depthFor({ entitlement: null, scanCount: 999 }), "rating");
  assert.equal(depthFor({ entitlement: null, scanCount: 999, admin: false }), "rating");
});
