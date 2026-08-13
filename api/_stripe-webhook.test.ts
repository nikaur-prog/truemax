import assert from "node:assert/strict";
import test from "node:test";
import { entitlementFromSubscription } from "./stripe-webhook.js";

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_test",
    metadata: { supabase_user_id: "00000000-0000-0000-0000-000000000001", tier: "max" },
    customer: "cus_test",
    status: "active",
    cancel_at_period_end: false,
    items: {
      data: [{ price: { id: "price_original" }, current_period_end: 1_800_000_000 }],
    },
    ...overrides,
  };
}

test("active server-stamped subscriptions grant Max", () => {
  const result = entitlementFromSubscription(subscription() as never);
  assert.equal(result?.tier, "max");
  assert.equal(result?.status, "active");
  assert.equal(result?.priceId, "price_original");
  assert.equal(result?.currentPeriodEnd, new Date(1_800_000_000_000).toISOString());
});

test("trialing subscriptions grant Max", () => {
  const result = entitlementFromSubscription(subscription({ status: "trialing" }) as never);
  assert.equal(result?.tier, "max");
});

test("active server-stamped Starter subscriptions grant Starter", () => {
  const result = entitlementFromSubscription(subscription({
    metadata: { supabase_user_id: "00000000-0000-0000-0000-000000000001", tier: "starter" },
  }) as never);
  assert.equal(result?.tier, "starter");
});

test("past-due subscriptions revoke Max until billing is fixed", () => {
  const result = entitlementFromSubscription(subscription({ status: "past_due" }) as never);
  assert.equal(result?.tier, "free");
  assert.equal(result?.status, "past_due");
});

test("cancel-at-period-end keeps access while Stripe still reports active", () => {
  const result = entitlementFromSubscription(subscription({ cancel_at_period_end: true }) as never);
  assert.equal(result?.tier, "max");
  assert.equal(result?.cancelAtPeriodEnd, true);
});

test("an existing server-stamped subscription survives a price replacement", () => {
  const result = entitlementFromSubscription(subscription({
    items: { data: [{ price: { id: "price_grandfathered" }, current_period_end: 1_800_000_000 }] },
  }) as never);
  assert.equal(result?.tier, "max");
  assert.equal(result?.priceId, "price_grandfathered");
});

test("unrelated Stripe subscriptions are ignored", () => {
  const result = entitlementFromSubscription(subscription({ metadata: {} }) as never);
  assert.equal(result, null);
});
