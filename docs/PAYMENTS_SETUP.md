# Payments (Stripe + Supabase) — setup

Stripe Checkout, the Customer Portal, a signed webhook and a Supabase
entitlement read model exist. The web implementation now includes the
Starter/Max trial funnel, but it is not ready to take live money until the
catalog, migration, secrets and sandbox acceptance test are complete.

See [`BILLING_CATALOG.md`](BILLING_CATALOG.md) for the connected-account audit,
target product catalog and the bugs that must be fixed before accepting money.
See [`PRICING_DECISION.md`](PRICING_DECISION.md) for the confirmed prices and
seven-day trial decision.

## Current verified state (12 August 2026)

- Stripe MCP is authenticated to the TrueMax account
  `acct_1U3RfMJdkPdozJUk`.
- That connected account currently has no active products, prices or webhook
  endpoints.
- The entitlement tables and hardened RPC exist in the production Supabase
  project.
- The current branch supports `free | starter | max`, a one-trial-per-account
  reservation, server-side age enforcement and duplicate-subscription blocking.
- The post-analysis onboarding and responsive Starter/Max offer are built and
  browser-verified at desktop and phone viewports.
- No sandbox checkout → webhook → entitlement → cancellation cycle has passed.
- Do not add live prices yet: weekly and purchased scan-credit enforcement is
  still outstanding.

## 1. Finalize the remaining product rules

Before paid feature gates or store offers are published, write the complete
Starter/Max feature table and choose the weekly-credit renewal/rollover rules.
All confirmed rules are recorded in `PRICING_DECISION.md`.

## 2. Build the target server model

The current funnel PR completes Starter/Max entitlement, trial reservation,
server age enforcement, duplicate-subscription blocking and safe paid-account
deletion. Remaining work before taking money is:

1. add an immutable scan-credit ledger;
2. enforce the initial, trial, weekly and purchased scan allowances server-side;
3. add the two server-configured one-time scan Price IDs; and
4. grant one-time credits only after Stripe reports a paid session.

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

Select `checkout.session.completed`, `checkout.session.expired`, `customer.subscription.created`,
`customer.subscription.updated` and `customer.subscription.deleted` for the
current trial implementation. Add invoice, async-payment and refund events when
one-time scan credits are implemented. Put the destination's `whsec_...` into the
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
