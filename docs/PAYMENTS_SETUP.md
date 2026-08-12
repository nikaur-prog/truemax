# Payments (Stripe + Supabase) — setup

The payment code is complete but deliberately ships unconfigured. Checkout is
created by same-origin Vercel Functions, Stripe hosts the payment page, and a
signature-verified webhook writes the resulting entitlement to Supabase. No
Stripe secret or Supabase admin key is ever present in browser code.

## Current verified state (12 August 2026)

- The Stripe/Vercel/Supabase implementation exists in draft PR #16 and its
  Vercel preview builds successfully.
- The production Supabase project does **not** yet contain `entitlements` or
  `stripe_webhook_events`.
- Vercel currently contains only the two public Supabase browser variables.
  None of the server-side Stripe or Supabase variables below are present.
- Stripe product/price values cannot be read through the Supabase MCP. A Stripe
  dashboard/connector check is still required to confirm the claimed pricing.

## 1. Install the entitlement schema

Run `supabase/migrations/20260812000000_stripe_entitlements.sql` in the Supabase
SQL Editor (or apply it with the Supabase CLI/MCP). It creates:

- `entitlements`, readable only by the signed-in owner;
- `stripe_webhook_events`, inaccessible to browser roles; and
- `apply_stripe_entitlement`, a server-only, idempotent transaction that also
  rejects older webhook state arriving after a newer event.

Do this before enabling checkout. The checkout function intentionally refuses
to take payment if entitlement storage is missing.

## 2. Create the Stripe product and recurring price

First resolve [`docs/PRICING_DECISION.md`](PRICING_DECISION.md). An older handoff
mentions $6.99 and $11.99 tiers, while the current checkout and entitlement
schema implement Free plus one recurring Max price. Currency, interval and the
two-tier feature split were not preserved, so they must not be guessed.

In Stripe **test mode** first:

1. Product catalogue → Add product → name it `TrueMax Max`.
2. Add one recurring price using the billing interval and amount you decide.
3. Copy its `price_...` ID. This becomes `STRIPE_MAX_PRICE_ID`.
4. Settings → Billing → Customer portal: enable subscription cancellation and
   payment-method updates, then save the portal configuration.

The price is never accepted from the browser; the server reads the one allowed
price ID from its environment. Changing price later is a Vercel configuration
change, not a client release, and existing subscriptions retain the server-set
Max marker on their Stripe metadata.

## 3. Add server-only Vercel variables

Vercel → TrueMax → Settings → Environment Variables:

```text
STRIPE_SECRET_KEY=sk_test_...
STRIPE_MAX_PRICE_ID=price_...
SUPABASE_URL=https://ruvgkrlfmixfnmnzqgap.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
TRUEMAX_APP_URL=https://www.truemax.app
```

Supabase's new `sb_secret_...` server key is preferred. A legacy project can set
`SUPABASE_SERVICE_ROLE_KEY` instead. Neither key may start with `VITE_`, because
every `VITE_` variable is eligible for the public browser bundle.

Set these for Preview first. Add Production values only after the full test-mode
flow is green.

## 4. Deploy, then register the webhook

Deploy once so this endpoint exists:

```text
https://www.truemax.app/api/stripe-webhook
```

Stripe Workbench → Webhooks → Add destination. Select:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Copy the destination signing secret (`whsec_...`) into Vercel as
`STRIPE_WEBHOOK_SECRET`, then redeploy. Stripe signs the exact raw request body;
the function rejects any event whose signature does not match.

## 5. Test end to end

1. Sign in to the Vercel Preview deployment with a test account.
2. Account → Upgrade to Max.
3. Complete Stripe Checkout using a Stripe test payment method.
4. Confirm Stripe shows a successful Checkout Session and delivered webhook.
5. Confirm `public.entitlements` has that Supabase user ID with `tier = 'max'`
   and `status = 'active'`.
6. Return to Account and confirm **Max membership** appears.
7. Manage billing → cancel at period end. Confirm the next webhook updates
   `cancel_at_period_end` while access stays Max until Stripe ends the period.
8. Replay the same webhook in Stripe. The row must not duplicate or regress.

Only after this test passes should the Stripe account be switched to live mode,
with live `sk_live_...`, `price_...`, and `whsec_...` values added to Production.

## What this PR does not do

It establishes the trusted `free`/`max` entitlement and account controls. The
actual product split—exactly which result and plan components Max unlocks—is
Stage 2.3 and stays in its own reviewable change.
