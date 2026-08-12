# TrueMax MVP readiness audit

Audit date: 12 August 2026 (Pacific/Auckland)

## Verdict

**No-go for a public paid MVP today.** The core scanner is strong enough for a
closed alpha, and the account implementation is now reviewable, but the revenue
and trust boundaries have not been proven end to end. In particular, the Stripe
server variables are absent, Google and Apple are disabled, the free/Max split
is not enforced, and the privacy/terms/age surfaces do not exist.

This verdict assumes the MVP is:

- a web product for adults;
- cosmetic/self-improvement information, not a medical or diagnostic service;
- one free experience plus one recurring `Max` subscription;
- on-device photo processing, with no face photographs uploaded;
- allowed to keep scan history on one device at launch (cross-device sync can
  follow), provided the UI says so honestly.

Under that assumption, scan sync and analytics are useful but not launch
blockers. Legal pages, payment proof, tier enforcement, email deliverability,
and a mobile smoke test are blockers.

## Evidence snapshot

| Boundary | Status | Evidence |
|---|---|---|
| Domain and production | Pass | `https://www.truemax.app/` returns 200; Vercel production is Ready on `main`. |
| Core capture flow | Pass locally | Mobile-sized browser test completed front capture, rejected a false side photo, accepted a profile, showed 13-point verification, and reached the account gate. |
| Account UI | Built, not deployed | Modal and `/auth` portal cover signup, password login, magic link, Google, Apple, forgot password and new password. |
| Post-scan acquisition flow | Built, not deployed | The scan remains the default page; signup appears only after both captures; a reduced local copy is usable through an email/OAuth redirect for 30 minutes and is deleted after use or on the next app open after expiry. |
| Supabase schema | Pass | `scans`, `entitlements` and `stripe_webhook_events` exist with RLS. Anonymous reads/RPC return 401. |
| Supabase security | Pass with one intentional warning | Anonymous execute on `delete_own_account` was removed. The advisor still flags authenticated execution because that RPC intentionally lets a signed-in user delete only itself. |
| OAuth provider config | Fail | Public Auth settings report `google: false` and `apple: false`. Buttons remain disabled until Supabase is configured. |
| Email readiness | Partial | Email confirmation is on. Custom SMTP and real-device confirmation/magic/reset tests are not verified. |
| Stripe catalogue | Unverified | Supabase MCP cannot see Stripe products. Vercel has no `STRIPE_SECRET_KEY`, `STRIPE_MAX_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SECRET_KEY`, `SUPABASE_URL` or `TRUEMAX_APP_URL`. |
| Payment code | Built, not revenue-tested | Draft PR #16 builds; the entitlement schema is now live; no test checkout/webhook/cancel cycle has run. |
| Free vs Max enforcement | Fail | The reusable entitlement check exists, but result/plan features are not gated. |
| Legal and age | Fail | Privacy policy, terms and the under-18 rule are absent. |
| Measurement change | Awaiting merge | Cheekbone/bizygomatic fix and regenerated norms are in draft PR #15, not production. |
| Dependencies | Pass | Production dependency audit reports 0 known vulnerabilities; unit/type/build checks pass. |

## Hidden defects found and handled in the auth work

1. Production CSP allowed only same-origin connections, which blocked every
   Supabase Auth/API call. It now allows only the exact project HTTPS/WSS host.
2. `delete_own_account()` had an explicit anonymous execute grant in live
   Postgres. Anonymous access is removed and the function rejects a null user.
3. Scan RLS policies targeted `PUBLIC`, re-evaluated `auth.uid()` per row, and
   the update policy had no ownership `WITH CHECK`. All were repaired.
4. `/auth`, `/quick` and `/calib` clean routes returned 404. Exact Vercel
   rewrites are included.
5. The UI claimed scan sync already worked. Copy now says history is device-only.
6. Email confirmation or OAuth after a completed scan would have destroyed the
   in-memory capture on redirect. A short-lived, device-only resume record now
   preserves it.
7. The live Supabase project had no migration history and no payment tables.
   Account/payment migrations are now recorded and applied.

## Go-live gates

TrueMax is a paid web MVP only when all of these are green:

1. Merge and deploy PRs #15, #16 and the auth-gate PR in a conflict-safe order.
2. Set Supabase Site URL/redirect URLs and custom SMTP; test confirmation,
   magic link, reset and delete account using a real inbox.
3. Enable Google. Enable Apple if it is required for the web audience or before
   an iOS release; record Apple secret renewal ownership.
4. Add the six server-only payment variables in Vercel Preview, register the
   Stripe test webhook and enable the customer portal.
5. Complete test checkout → webhook → Max → cancel-at-period-end → replay.
6. Enforce the promised free/Max boundary in the product, not just the account
   badge.
7. Publish privacy policy and terms; implement the under-18 product rule.
8. Run front → side → signup → result → checkout on iPhone Safari and Android
   Chrome over cellular, with no console/network failure.

After these eight gates, the reasonable launch call is **limited public MVP**,
with the product explicitly framed as directional cosmetic measurement and the
known reference-sample limitations disclosed. It is not ready for claims of
clinical accuracy or objective attractiveness.
