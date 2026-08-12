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

The trial belongs on the Checkout-created subscription, not in a second product
or price. Its duration is deliberately unset until the contradiction in
`PRICING_DECISION.md` is resolved.

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

It currently supports only `free | max` and one `STRIPE_MAX_PRICE_ID`. It does
not yet implement Starter, one-time scan purchases, weekly scan grants, trial
eligibility, the post-analysis offer, native-store receipts or age gating.

## Bugs and gaps to fix before accepting money

1. **Deleting a paid account does not cancel Stripe.** The current database RPC
   deletes the Supabase identity and cascades the entitlement row, but the
   Stripe subscription can keep billing. Account deletion must cancel billing
   first, then delete the identity, and late Stripe events for the deleted user
   must be acknowledged safely.
2. **The checkout endpoint can create duplicate subscriptions.** The UI hides
   the upgrade button from a Max user, but the server does not reject a second
   direct POST. It also has a short race before the first webhook stores the
   Stripe customer. Enforce one active subscription per account server-side.
3. **Trial abuse is not prevented.** A Stripe trial must be backed by a
   server-owned, one-time trial redemption record; browser metadata is not an
   eligibility source.
4. **One-time scan payments are not fulfilled.** Credits must be granted only
   after a paid Checkout event. Async payment methods must not receive a credit
   from an unpaid `checkout.session.completed` event.
5. **There is no immutable scan-credit ledger.** A balance alone is too easy to
   corrupt. Store grants, purchases, use, expiry and refunds as ledger entries.
6. **Age gating is only a design request.** Max eligibility must be derived from
   a protected profile field and checked again inside the Checkout function.
7. **Past-due access is revoked immediately.** Decide whether a short grace
   period is intended and align it with Stripe Smart Retries and customer
   emails.
8. **Same-second webhook ordering is ambiguous.** Stripe event timestamps have
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

1. Resolve trial length and the Starter/Max feature table.
2. Fix account deletion and duplicate-subscription handling.
3. Add the new Supabase entitlement and credit-ledger migration with RLS tests.
4. Extend Checkout using a server allowlist for the four price IDs.
5. Extend signed webhooks and add replay/out-of-order tests.
6. Create the four prices in a Stripe sandbox and configure Customer Portal,
   recovery emails, trial notices and Radar.
7. Add Vercel Preview secrets and run end-to-end sandbox tests.
8. Copy products to live mode, create a separate live webhook and set live
   Production secrets only after the sandbox gate is green.
