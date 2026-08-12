# Payments (Stripe + Supabase) — setup

Stripe Checkout, the Customer Portal, a signed webhook and a Supabase
entitlement read model already exist. They are a secure **single-Max-plan
skeleton**, not the final two-plan billing implementation.

See [`BILLING_CATALOG.md`](BILLING_CATALOG.md) for the connected-account audit,
target product catalog and the bugs that must be fixed before accepting money.
See [`PRICING_DECISION.md`](PRICING_DECISION.md) for the confirmed prices and
the unresolved trial duration.

## Current verified state (12 August 2026)

- Stripe MCP is authenticated to the TrueMax account
  `acct_1U3RfMJdkPdozJUk`.
- That connected account currently has no active products, prices or webhook
  endpoints.
- The entitlement tables and hardened RPC exist in the production Supabase
  project.
- The app code supports only `free | max` and one `STRIPE_MAX_PRICE_ID`.
- No sandbox checkout → webhook → entitlement → cancellation cycle has passed.
- Do not point the existing endpoint at a live price: it cannot yet represent
  Starter, scan credits, age restrictions or one-time trial eligibility.

## 1. Finalize the product rules

Before payment code or store offers are published, choose 7 or 30 days for the
trial and write the complete Starter/Max feature table. All remaining confirmed
rules are recorded in `PRICING_DECISION.md`.

## 2. Build the target server model

The next payment PR must:

1. add `starter` to the entitlement model;
2. add server-owned trial eligibility;
3. add an immutable scan-credit ledger;
4. permit only the four server-configured price IDs;
5. check the under-18 restriction again on the server;
6. prevent duplicate active subscriptions;
7. cancel billing safely as part of paid-account deletion; and
8. grant one-time credits only after Stripe reports a paid session.

The browser must never send an arbitrary Stripe Price ID or decide that it is
eligible for Max, a trial or the member scan price.

## 3. Create the catalog in a Stripe sandbox

Create these prices in a Stripe sandbox first:

```text
TrueMax Starter      $6.99 USD monthly
TrueMax Max          $11.99 USD monthly
TrueMax Extra Scan   $2.99 USD one-time member price
TrueMax Extra Scan   $5.99 USD one-time standard price
```

The two scan prices may belong to the same product, but only the server chooses
which price applies. Keep the trial on the Checkout subscription rather than
creating another Price.

Configure the Customer Portal for payment-method updates, cancellation,
invoice/receipt history and safe Starter/Max plan changes. Enable Stripe's
trial-ending notice, successful-payment email, failed-payment email and Smart
Retries. Keep the exact trial and renewal language visible before Checkout.

## 4. Add server-only Vercel Preview variables

```text
STRIPE_SECRET_KEY=sk_test_...
STRIPE_STARTER_PRICE_ID=price_...
STRIPE_MAX_PRICE_ID=price_...
STRIPE_MEMBER_SCAN_PRICE_ID=price_...
STRIPE_SCAN_PRICE_ID=price_...
SUPABASE_URL=https://ruvgkrlfmixfnmnzqgap.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
TRUEMAX_APP_URL=https://www.truemax.app
```

Supabase's new `sb_secret_...` server key is preferred. A legacy project can set
`SUPABASE_SERVICE_ROLE_KEY` instead. Neither key may start with `VITE_`; every
`VITE_` value is eligible for the public browser bundle.

Use sandbox/test secrets in Preview. Never paste a Stripe or Supabase secret
into source control or a chat message.

## 5. Register the sandbox webhook

After deploying the target payment PR, add a sandbox webhook destination:

```text
https://<the-preview-host>/api/stripe-webhook
```

Select the subscription, invoice, trial, paid Checkout, async-payment and refund
events implemented by that PR. Put the destination's `whsec_...` value into the
Preview environment as `STRIPE_WEBHOOK_SECRET`, then redeploy.

Stripe signs the exact raw request body. The handler must stay non-2xx on a
temporary server failure so Stripe retries it, but repeated events must remain
idempotent.

## 6. Sandbox acceptance test

Run at least these scenarios before creating live configuration:

1. Starter trial signup and conversion to a first paid invoice.
2. Max trial signup and conversion for an eligible adult.
3. Max rejected server-side for an under-18 account.
4. Second trial rejected for a previous trial user.
5. Second subscription rejected for an already subscribed account.
6. Upgrade, downgrade, cancel at period end and payment-method update in Portal.
7. Successful, failed and recovered renewal.
8. Weekly scan grant, expiry and no accidental rollover.
9. $2.99 member scan and $5.99 free-user scan.
10. Async payment: no credit until payment succeeds.
11. Refund/chargeback credit reversal.
12. Paid-account deletion cancels billing before deleting the identity.
13. Duplicate and out-of-order webhook replay does not duplicate or regress
    entitlement or credit state.

Only after these pass should the sandbox products be copied to live mode. Live
prices, `sk_live_...`, a separate live `whsec_...` and Production Vercel secrets
are separate objects and must be configured deliberately.
