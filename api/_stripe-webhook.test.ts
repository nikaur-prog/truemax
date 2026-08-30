import assert from "node:assert/strict";
import test from "node:test";
import {
  configuredWebhookSecrets,
  entitlementFromSubscription,
  verifyWebhookEvent,
} from "./stripe-webhook.js";

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

test("a Customer Portal upgrade follows the current price, not stale Checkout metadata", () => {
  const result = entitlementFromSubscription(
    subscription({
      metadata: { supabase_user_id: "00000000-0000-0000-0000-000000000001", tier: "starter" },
      items: { data: [{ price: { id: "price_max_live" }, current_period_end: 1_800_000_000 }] },
    }) as never,
    { STRIPE_MAX_PRICE_ID: "price_max_live" },
  );
  assert.equal(result?.tier, "max");
});

test("a Customer Portal downgrade also follows the current price", () => {
  const result = entitlementFromSubscription(
    subscription({
      items: { data: [{ price: { id: "price_starter_live" }, current_period_end: 1_800_000_000 }] },
    }) as never,
    { STRIPE_STARTER_PRICE_ID: "price_starter_live" },
  );
  assert.equal(result?.tier, "starter");
});

test("unrelated Stripe subscriptions are ignored", () => {
  const result = entitlementFromSubscription(subscription({ metadata: {} }) as never);
  assert.equal(result, null);
});

test("webhook verification accepts either configured endpoint secret", () => {
  const attempted: string[] = [];
  const event = verifyWebhookEvent(
    (_payload, _signature, secret) => {
      attempted.push(secret);
      if (secret !== "whsec_second") throw new Error("signature mismatch");
      return { id: "evt_valid" };
    },
    "raw body",
    "t=1,v1=signature",
    configuredWebhookSecrets({
      STRIPE_WEBHOOK_SECRET: "whsec_first",
      SIGNING_SECRET: "whsec_second",
    }),
  );

  assert.deepEqual(event, { id: "evt_valid" });
  assert.deepEqual(attempted, ["whsec_first", "whsec_second"]);
});

test("duplicate webhook secrets are only attempted once", () => {
  const secrets = configuredWebhookSecrets({
    STRIPE_WEBHOOK_SECRET: "whsec_same",
    SIGNING_SECRET: "whsec_same",
  });
  assert.deepEqual(secrets, ["whsec_same"]);
});

// ---------------------------------------------------------------------------
// Where the conversion is reported from, and when.
//
// The handler drives Stripe and Supabase and cannot be imported here, so these
// are source assertions on the ORDER of the handler. Order is exactly what
// would rot, and it is what was wrong: reporting sat in the middle of the
// function, before the subscription entitlement was applied, awaiting a fetch
// with no timeout. A hanging ad network could therefore strand a paying
// customer without access, which is the most expensive possible failure of a
// reporting call.
const { readFileSync } = await import("node:fs");
const webhookSource = readFileSync(new URL("./stripe-webhook.ts", import.meta.url), "utf8");
const attributionSource = readFileSync(new URL("./_attribution.ts", import.meta.url), "utf8");

test("nothing owed to a person ever queues behind the ad network", () => {
  const entitlement = webhookSource.indexOf('rpc("apply_stripe_entitlement"');
  const report = webhookSource.indexOf("if (conversion) await reportPurchase(conversion)");
  assert.ok(entitlement > -1 && report > -1, "both the fulfilment and the report must exist");
  // The only reportPurchase call is inside settle(), and every success path
  // returns through settle. A second call site anywhere else would be a path
  // that reports before fulfilment again.
  const calls = webhookSource.match(/await reportPurchase\(/g) ?? [];
  assert.equal(calls.length, 1, "exactly one reporting call, and it lives in settle()");
  // No success return may bypass it.
  const body = webhookSource.slice(webhookSource.indexOf("let conversion"));
  assert.doesNotMatch(body, /return json\(\{ received: true/, "success returns go through settle()");
});

test("subscription revenue is reported, not just the trial that opened it", () => {
  // The subscription products open on a seven-day trial, so the Checkout
  // Session completes at amount_total 0. The first real charge and every
  // renewal arrive as invoice.paid, which the handler used to ignore entirely
  // — so the ads were credited with the trials and none of the money.
  assert.match(webhookSource, /event\.type === "invoice\.paid"/);
  assert.match(webhookSource, /invoice\.amount_paid/);
  // Read from the SUBSCRIPTION's metadata: an invoice has no memory of the
  // click that started the subscription unless the subscription carries it.
  assert.match(webhookSource, /parent\?\.subscription_details\?\.metadata/);
  // Both shapes, because Stripe moved the field and no apiVersion is pinned.
  assert.match(webhookSource, /invoice\.subscription_details\?\.metadata/);
  // A zero invoice is the trial opening, not a sale.
  assert.match(webhookSource, /invoice\.amount_paid > 0/);
});

test("the reporting call is bounded", () => {
  // fetch has no default timeout, so an unbounded call to somebody else's
  // server inside a payment webhook is a way to strand a paying customer.
  assert.match(attributionSource, /new AbortController\(\)/);
  assert.match(attributionSource, /signal: abort\.signal/);
  assert.match(attributionSource, /clearTimeout\(timer\)/);
});

test("HTTP 200 from TikTok is not taken as success", () => {
  // The Events API answers 200 and puts the outcome in the body. Checking only
  // the status recorded rejected requests and partial failures as "sent",
  // which reads downstream as an ad that is not converting.
  assert.match(attributionSource, /payload\.code !== 0/);
  assert.match(attributionSource, /partial_failure/);
  assert.match(attributionSource, /failed_events/);
});
