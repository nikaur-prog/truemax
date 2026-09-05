# Starter catalogue audit: the $6.99 renewal against the $7.99 price

Written 3 September 2026 at Codex's request. The owner's own Customer
Portal shows a Starter subscription renewing at $6.99 while the code, the
plan card and the health check all expect $7.99. This is a code-level
reading of what that means and what it does not. No price was changed.
The Stripe dashboard itself was not reachable from this environment, so
the catalogue facts below are the ones the code and the earlier audit
established; the two dashboard checks at the end are the owner's.

## What the code does with a subscription on an old price

`entitlementFromSubscription` in `api/stripe-webhook.ts` maps a
subscription to a tier by its Price id first, against the ids configured in
the environment, and falls back to the `tier` stamped in the subscription's
metadata at Checkout. A subscription on a Price id that is no longer
configured (the $6.99 Starter) therefore still resolves to `starter` through
the stamp, with a comment in the code naming exactly this case as "a
grandfathered catalogue item". Entitlement is correct for such a
subscriber: they keep Starter access at the price they signed up at.

`api/stripe-config.ts` reports only the configured ids. It says whether the
$7.99 Price resolves, is active, is live-mode and matches 799 cents. It
says nothing about subscriptions on other Prices, so the $6.99 renewal is
invisible to the health check by design rather than by omission.

`api/create-checkout-session.ts` sells Starter only at the configured id.
No new customer can reach the $6.99 price through TrueMax's Checkout.

`src/ui/maxTab.ts` already records the disagreement ("$7.99 on the plan
card against $6.99 in the portal") and deliberately quotes the Max price
plus "what you already pay comes off it" rather than computing a
difference, so the plan card is not printing a number the portal
contradicts.

## So: grandfathering or mismatch

Both are consistent with the evidence, and the code handles both safely.
The distinguishing fact is in the Stripe catalogue, not in the repo:

- If the $6.99 Price is **archived** (inactive), the only subscribers on it
  are people who signed up before the change, they keep it until they
  cancel or switch plans in the portal, and this is ordinary
  grandfathering. Nothing to do.
- If the $6.99 Price is still **active**, it is not sold by TrueMax's
  Checkout, but a Customer Portal plan switch or a manually created
  subscription could land on it, and the portal's plan picker may list it
  beside the $7.99 one. That is a catalogue mismatch worth closing.

Two dashboard checks, five minutes, owner only:

1. Products, Starter: is the $6.99 Price active or archived? If active and
   no new sales at $6.99 are intended, archive it. Archiving never touches
   existing subscriptions.
2. Customer Portal settings, plan switching: which Starter Price is listed?
   Only the $7.99 one should be.

The owner's own subscription being on the $6.99 Price is expected either
way: it predates the change. If it should renew at $7.99, that is a plan
switch in the portal or a subscription update in the dashboard, and it is
a decision about one customer, not a code change.

## What was not done

No price, product or subscription was modified. `stripe-config.ts` was not
widened to enumerate subscriptions, because a health endpoint that lists
customers' subscriptions is a different kind of endpoint and would need its
own access decision.
