# Pricing decision required

## What is actually saved

An earlier TrueMax account handoff says:

> Subscriptions (the $6.99 / $11.99 tiers) hang off this identity but are a
> separate piece — RevenueCat for the app, Stripe for the web.

It does not record the currency, billing interval, package names, or which
features belong to each amount.

The current payment implementation is different: it supports one free tier and
one recurring `max` tier, configured by a single `STRIPE_MAX_PRICE_ID`. The
database constraint, checkout endpoint and account screen all implement only
`free | max`.

## Decision needed before live checkout

Choose one model and record the currency and interval:

1. **Free + one Max subscription** — keep the current code and choose the Max
   amount.
2. **Free + two paid subscriptions** — define the name and features for the
   $6.99 package and the $11.99 package, then extend Stripe, entitlements and
   feature gates together.

Do not create live Stripe prices until this is resolved. A display price and a
server entitlement model must not disagree.
