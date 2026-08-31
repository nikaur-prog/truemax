# TrueMax billing catalog and launch state

Last reviewed: 31 August 2026 (Pacific/Auckland)

## Live Stripe catalog

Production uses the TrueMax live Stripe account. Product and price IDs stay in
Vercel server-side environment variables and are never accepted from the
browser.

| Offer | Price type | Amount | Server key |
| --- | --- | ---: | --- |
| TrueMax Starter | Recurring monthly | $7.99 USD | `STRIPE_STARTER_PRICE_ID` |
| TrueMax Max | Recurring monthly | $11.99 USD | `STRIPE_MAX_PRICE_ID` |
| TrueMax Max | Recurring yearly | $89.99 USD | `STRIPE_MAX_ANNUAL_PRICE_ID` |
| Extra scan | One-time standard | $5.99 USD | `STRIPE_SCAN_PRICE_ID` |
| Extra scan | One-time member | $2.99 USD | `STRIPE_MEMBER_SCAN_PRICE_ID` |
| Decline downsell | One-time eligible account | $2.99 USD | `STRIPE_DOWNSELL_PRICE_ID` |
| Voiced analysis | One-time | $2.99 USD | `STRIPE_VOICED_PRICE_ID` |

Starter and Max begin with one seven-day trial per account. An existing legacy
Starter subscription can remain on its original price; new Checkout Sessions
use the current $7.99 price.

## Shipped implementation

- Checkout resolves every price from a server-owned allowlist.
- Active or trialing subscribers cannot open a second subscription.
- Max eligibility is checked from the server-side date of birth and requires an
  adult account.
- Trial and decline-downsell reservations are atomic and one-time.
- Scan and voice credits are granted only after Stripe confirms payment.
- Async payment success and failure, subscription changes, paid invoices,
  refunds and disputes are handled by the signed webhook.
- Credits and fulfilment are idempotent. Refund and dispute reconciliation can
  revoke unused value or record debt after value has been consumed.
- Entitlements and credit ledgers are server-written and owner-readable under
  row-level security.
- The Customer Portal is the self-service billing surface.
- TikTok attribution metadata is allowlisted and copied to subscriptions for
  renewal reporting; it never carries face data or email to TikTok.

## Production verification

The live webhook listens for Checkout, subscription, invoice, refund and dispute
events. The protected `/api/stripe-config` probe is the authority for whether
every deployed price resolves with the expected amount, currency, cadence and
Stripe mode. Presence of an environment variable alone is not proof.

Before calling consumer billing launch-verified:

1. Complete Stripe identity verification.
2. Run the protected production catalog probe.
3. Complete one controlled live one-time purchase with a fresh account.
4. Confirm the webhook grants exactly one credit and the receipt is correct.
5. Refund the controlled purchase only with explicit owner approval, then
   confirm reconciliation.
6. Obtain the New Zealand GST decision before enabling automatic tax in API
   Checkout Sessions.

## Creator League payouts

Creator payouts are separate from consumer billing. They use Stripe Connect
recipient accounts and server-created Transfers from the funded TrueMax platform
balance. The browser never chooses a payout amount or destination.

Keep `LEAGUE_PAYOUTS_ENABLED=false` or unset until the Connect business model is
approved, the sandbox runbook in `LEAGUE_PAYOUT_LAUNCH.md` passes, the first pool
is funded and one controlled live creator transfer succeeds. Supported creator
countries are restricted by `LEAGUE_PAYOUT_COUNTRIES`, which defaults to `NZ`.

## Payment methods

Stripe Checkout dynamically presents only methods compatible with the customer,
currency and purchase type. Enabling a method in the Dashboard does not prove it
works for every one-time and recurring offer. Test each method the product plans
to advertise, including its delayed-payment, refund and dispute path, before
naming it as supported in marketing copy.
