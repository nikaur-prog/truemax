import test from "node:test";
import assert from "node:assert/strict";
import {
  hasMaxAccess,
  hasMaxOrStaffAccess,
  hasPaidAccess,
  recoverMaxEntitlement,
  resolveBillingIdentity,
} from "./entitlement.js";
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

test("staff can use the Max surface without a customer subscription", () => {
  const free = ent({ tier: "free", status: "none" });
  assert.equal(hasMaxOrStaffAccess(free, true), true);
  assert.equal(hasMaxOrStaffAccess(free, false), false);
});

test("an explicit Max entry repairs a stale entitlement and re-reads it", async () => {
  const rows = [
    ent({ tier: "free", status: "none" }),
    ent({ tier: "max", status: "active" }),
  ];
  let repairs = 0;
  const recovered = await recoverMaxEntitlement(
    async () => rows.shift()!,
    async () => {
      repairs += 1;
      return true;
    },
  );

  assert.equal(repairs, 1);
  assert.equal(hasMaxAccess(recovered), true);
  assert.equal(rows.length, 0, "the repaired projection was not read again");
});

test("an already-live Max entitlement never calls Stripe reconciliation", async () => {
  let repairs = 0;
  const recovered = await recoverMaxEntitlement(
    async () => ent(),
    async () => {
      repairs += 1;
      return true;
    },
  );

  assert.equal(hasMaxAccess(recovered), true);
  assert.equal(repairs, 0);
});

test("cancel-at-period-end keeps access until the period actually ends", () => {
  // Someone who cancels has paid through the end of the period. Cutting them
  // off at the moment they click cancel is taking money for nothing.
  assert.equal(hasMaxAccess(ent({ cancelAtPeriodEnd: true })), true);
});

test("billing binds the access token to the same account seen on both sides", async () => {
  const expectedIds: Array<string | undefined> = [];
  const users = [{ id: "alice" }, { id: "alice" }];
  const result = await resolveBillingIdentity(
    async () => users.shift() ?? null,
    async (expectedUserId) => {
      expectedIds.push(expectedUserId);
      return "alice-token";
    },
  );

  assert.deepEqual(expectedIds, ["alice"]);
  assert.deepEqual(result, { ok: true, accessToken: "alice-token", payerId: "alice" });
});

test("billing stops when the account changes while identity is being resolved", async () => {
  const users = [{ id: "alice" }, { id: "bob" }];
  const result = await resolveBillingIdentity(
    async () => users.shift() ?? null,
    async () => "alice-token",
  );

  assert.deepEqual(result, { ok: false, reason: "identity_changed" });
});

test("billing stops when the token does not belong to the first account", async () => {
  let userReads = 0;
  const result = await resolveBillingIdentity(
    async () => {
      userReads += 1;
      return { id: "alice" };
    },
    async (expectedUserId) => {
      assert.equal(expectedUserId, "alice");
      return null;
    },
  );

  assert.equal(userReads, 1, "do not continue to checkout after the session changes");
  assert.deepEqual(result, { ok: false, reason: "identity_changed" });
});
