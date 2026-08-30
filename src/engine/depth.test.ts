import test from "node:test";
import assert from "node:assert/strict";
import { canSeeDepth, canSeePlan, depthFor, tierOf } from "./depth.js";
import type { Entitlement, EntitlementTier } from "./entitlement.js";

const ent = (tier: EntitlementTier, status = "active"): Entitlement => ({
  tier,
  status,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
});

test("the score and the ranking are never gated", () => {
  // The pitch is "we show the actual math". A paywall over the number itself
  // would make that a lie on the first screen, so nothing depthFor can return
  // hides it — "rating" is the floor and there is no level below it.
  //
  // Asserted as "at least rating" rather than by listing the union, which the
  // type already guarantees and which made this test pass for any value at all.
  for (const scanCount of [0, 1, 2, 50]) {
    assert.ok(canSeeDepth({ entitlement: null, scanCount }) || depthFor({ entitlement: null, scanCount }) === "rating");
  }
});

test("the measurements never expire on a free account", () => {
  // This asserted the opposite until the wall moved: two scans at depth, then
  // "rating" — the score alone with the region tabs blurred. The line is now
  // measurement is free, coaching is paid, so the geometry stays on every
  // scan and the plan is what costs money.
  for (const scanCount of [0, 1, 2, 9, 500]) {
    assert.equal(depthFor({ entitlement: null, scanCount }), "depth", `at ${scanCount} scans`);
  }
});

test("free never reaches the plan, however many scans it runs", () => {
  // The half of the old assertion that still matters. Depth being free is a
  // pricing decision; the plan being paid is the pricing decision, and no
  // amount of scanning may walk into it.
  for (const scanCount of [0, 2, 9, 500]) {
    assert.notEqual(depthFor({ entitlement: null, scanCount }), "plan", `at ${scanCount} scans`);
  }
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
    // It falls back to the free floor, which is now depth rather than rating.
    // What must not survive the lapse is the PLAN — otherwise cancelling would
    // be a way to keep the paid product.
    assert.equal(depthFor({ entitlement: ent("max", status), scanCount: 5 }), "depth", status);
    assert.notEqual(depthFor({ entitlement: ent("max", status), scanCount: 5 }), "plan", status);
  }
});

test("a failed entitlement read locks rather than unlocks", () => {
  // loadEntitlement throws on a network failure and the caller passes null. The
  // safe direction is the paywall: show a wall to a paying customer, who can
  // retry, rather than hand the paid product to everybody during an outage.
  //
  // What "locks" means moved with the ladder. A null entitlement now lands on
  // the free floor, and the free floor includes the measurements — that is a
  // pricing decision, not a leak. The invariant is that it never lands on the
  // plan, and that is what this pins.
  assert.notEqual(depthFor({ entitlement: null, scanCount: 5 }), "plan");
  assert.equal(depthFor({ entitlement: null, scanCount: 5 }), "depth");
});

test("a purchased credit never grants the plan, and is now a no-op below it", () => {
  // Credits bought one full-depth scan without a subscription. Depth is free
  // now, so the grant does nothing for anyone still holding one — which is the
  // right direction for a credit to fail in: it can only ever have bought
  // something the holder now has anyway, never something taken away.
  //
  // The rule it must still obey is unchanged and is the one pinned here:
  // credits are not a road to the plan tier, at any quantity.
  assert.equal(depthFor({ entitlement: null, scanCount: 5, credits: 1 }), "depth");
  assert.equal(depthFor({ entitlement: null, scanCount: 5, credits: 0 }), "depth");
  assert.notEqual(depthFor({ entitlement: null, scanCount: 5, credits: 99 }), "plan");
  // A member's access comes from the membership, so credits change nothing.
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
  // never the paid product handed to everybody during an outage. The paid
  // product is the plan, so that is what an absent or false flag must not
  // reach.
  assert.notEqual(depthFor({ entitlement: null, scanCount: 999 }), "plan");
  assert.notEqual(depthFor({ entitlement: null, scanCount: 999, admin: false }), "plan");
});
