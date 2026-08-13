import test from "node:test";
import assert from "node:assert/strict";
import { hasMaxAccess, hasPaidAccess } from "./entitlement.js";
import type { Entitlement } from "./entitlement.js";

// The gate between "measured your face for free" and "paid for the method".
// Worth testing directly: every branch below is either giving away the paid
// product or withholding something someone has paid for, and both are the kind
// of bug that is invisible until it is expensive.

const ent = (over: Partial<Entitlement> = {}): Entitlement => ({
  tier: "max",
  status: "active",
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  ...over,
});

test("an active Max subscription unlocks Max", () => {
  assert.equal(hasMaxAccess(ent()), true);
});

test("a Max trial unlocks Max, because a trial is the product", () => {
  assert.equal(hasMaxAccess(ent({ status: "trialing" })), true);
});

test("Starter does not unlock Max at any status", () => {
  for (const status of ["active", "trialing"]) {
    assert.equal(hasMaxAccess(ent({ tier: "starter", status })), false, status);
  }
  // …but Starter is still a paid plan, and must not be treated as free.
  assert.equal(hasPaidAccess(ent({ tier: "starter" })), true);
});

test("a lapsed subscription locks, whatever tier it used to be", () => {
  // These are the statuses Stripe actually sends when money stops arriving.
  // Anything not explicitly allowed has to fail closed, or a cancelled account
  // keeps the paid product indefinitely.
  for (const status of ["canceled", "past_due", "unpaid", "incomplete", "paused", ""]) {
    assert.equal(hasMaxAccess(ent({ status })), false, `max/${status}`);
    assert.equal(hasPaidAccess(ent({ tier: "starter", status })), false, `starter/${status}`);
  }
});

test("free never has access", () => {
  assert.equal(hasMaxAccess(ent({ tier: "free", status: "none" })), false);
  assert.equal(hasPaidAccess(ent({ tier: "free", status: "none" })), false);
});

test("cancel-at-period-end keeps access until the period actually ends", () => {
  // Someone who cancels has paid through the end of the period. Cutting them
  // off at the moment they click cancel is taking money for nothing.
  assert.equal(hasMaxAccess(ent({ cancelAtPeriodEnd: true })), true);
});
