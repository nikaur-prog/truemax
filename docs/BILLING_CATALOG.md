# TrueMax billing catalog and implementation review

Last reviewed: 12 August 2026 (Pacific/Auckland)

## Connected Stripe account

The Stripe MCP connection is authenticated to account `acct_1U3RfMJdkPdozJUk`
(`TrueMax`). At review time the connected account returned:

- no active products;
- no active prices; and
- no webhook endpoints.

This audit did not create anything. The connector did not expose whether its
current scope was sandbox/test or live, so no mutation was attempted. Product
setup must start in a clearly labelled Stripe sandbox and be copied to live only
after the full flow passes.

## Target Stripe catalog

Stripe should handle payment terms and money. Supabase should handle scan
allowances and product access.

| Stripe product | Price type | Amount | Server key |
| --- | --- | ---: | --- |
| TrueMax Starter | Recurring monthly | $6.99 USD | `STRIPE_STARTER_PRICE_ID` |
| TrueMax Max | Recurring monthly | $11.99 USD | `STRIPE_MAX_PRICE_ID` |
| TrueMax Extra Scan | One-time member price | $2.99 USD | `STRIPE_MEMBER_SCAN_PRICE_ID` |
| TrueMax Extra Scan | One-time standard price | $5.99 USD | `STRIPE_SCAN_PRICE_ID` |

The seven-day trial belongs on the Checkout-created subscription, not in a
second product or price.

Consumer Checkout creates ordinary Billing invoices and receipts, so the MVP
does not need a separate Invoicing API flow. Use Dashboard-created one-off
invoices only for exceptional manual support cases.

## Existing implementation

The current code has good security foundations:

- Stripe and Supabase secret keys stay in same-origin Vercel Functions;
- Checkout uses a server-owned price ID rather than accepting one from the
  browser;
- webhook signatures are checked against the exact request body;
- webhook event IDs are idempotent and older events cannot normally overwrite
  newer entitlement state;
- entitlement rows are server-written and owner-readable under RLS; and
- the Customer Portal is used for self-service billing.

The current funnel branch also adds `free | starter | max`, atomic trial
reservation, duplicate-subscription blocking, server-side adult enforcement,
safe paid-account deletion and the post-analysis offer. It does not yet
implement one-time scan purchases, weekly scan grants, native-store receipts or
the immutable credit ledger.

## Bugs and gaps to fix before accepting money

1. **One-time scan payments are not fulfilled.** Credits must be granted only
   after a paid Checkout event. Async payment methods must not receive a credit
   from an unpaid `checkout.session.completed` event.
2. **There is no immutable scan-credit ledger.** A balance alone is too easy to
   corrupt. Store grants, purchases, use, expiry and refunds as ledger entries.
3. **Past-due access is revoked immediately.** Decide whether a short grace
   period is intended and align it with Stripe Smart Retries and customer
   emails.
4. **Same-second webhook ordering is ambiguous.** Stripe event timestamps have
   second precision. The database currently permits a later-processed event
   with the same timestamp to overwrite state; add a deterministic status or
   event ordering rule before launch.

## Target Supabase model

- `profiles`: onboarding answers, age band and consent version. Keep sensitive
  free text optional and separate from Auth metadata.
- `entitlements`: `free | starter | max`, billing source (`stripe | apple |
  google`), status and renewal dates.
- `trial_redemptions`: one server-owned redemption per account/person.
- `scan_credit_ledger`: immutable grants and debits with source, expiry,
  payment reference and reversal reference.
- `billing_customers`: stable provider customer IDs, separated from feature
  entitlement state.

The initial free analysis is an application entitlement, not a zero-dollar
Stripe subscription. Weekly scan allowances are also application grants, not
Stripe metered usage.

## Webhook coverage

At minimum, handle subscription lifecycle, successful and failed invoices,
trial-ending reminders, paid one-time Checkout sessions, async payment success
and refunds. Every provider event must be idempotent. Refunds or chargebacks for
an unused extra scan should reverse its credit; a used credit needs an explicit
support policy.

## Safe rollout order

1. Complete the Starter/Max feature table and weekly-credit rules.
2. Add the immutable credit-ledger migration with RLS tests.
3. Extend Checkout using a server allowlist for the two one-time scan price IDs.
4. Extend signed webhooks and add replay/out-of-order tests.
5. Create the four prices in a Stripe sandbox and configure Customer Portal,
   recovery emails, trial notices and Radar.
6. Add Vercel Preview secrets and run end-to-end sandbox tests.
7. Copy products to live mode, create a separate live webhook and set live
   Production secrets only after the sandbox gate is green.
