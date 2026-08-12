# TrueMax MVP readiness audit

Audit date: 12 August 2026 (Pacific/Auckland)

## Verdict

**No-go for a public paid MVP today.** The core scanner is strong enough for a
closed alpha, and the account implementation is now reviewable, but the revenue
and trust boundaries have not been proven end to end. In particular, the Stripe
server variables are absent, Apple is disabled, the free/Max split is not
enforced, and the privacy/terms/age surfaces do not exist.

This verdict assumes the MVP is:

- a web product with an explicitly designed under-18 mode;
- cosmetic/self-improvement information, not a medical or diagnostic service;
- one free analysis plus Starter and Max monthly subscriptions;
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
| OAuth provider config | Partial | Public Auth settings report `google: true` and `apple: false`. The app enables each button from that server-owned setting. |
| Email readiness | Partial | Email confirmation is on. Custom SMTP and real-device confirmation/magic/reset tests are not verified. |
| Stripe catalogue | Verified empty | The authenticated Stripe connector reports no active products, prices or webhook endpoints in the connected TrueMax account. |
| Payment code | Skeleton only | The entitlement schema is live and the secure single-Max flow builds, but it does not represent Starter, scan credits, age gates or one-time trial eligibility; no sandbox revenue cycle has run. |
| Free vs Max enforcement | Fail | The reusable entitlement check exists, but result/plan features are not gated. |
| Legal and age | Fail | Privacy policy, terms and the under-18 rule are absent. |
| Measurement integrity | Built locally, not deployed | Malar pair, rigid pose frame, roll-corrected canthal tilt, landmark guards and regenerated front norms are complete. Five unvalidated side constructions no longer affect scores. Human-rated validity is still a launch limitation. |
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
8. A same-page password sign-in could race the auth listener and append the
   finished scan to local history twice. The in-page continuation now claims
   the result before the redirect-resume listener runs.

## Go-live gates

TrueMax is a paid web MVP only when all of these are green:

1. Merge the stacked release in dependency order: #16 → #17 → #18 → #19 →
   #20 → `codex/analysis-integrity`. Do not merge #15 first: the newer analysis
   layer supersedes its cheekbone proxy and includes the broader geometry,
   landmark-integrity and recalibration fixes. Deploy only after the full stack
   is on `main`.
2. Verify the deployed `/auth`, `/quick` and `/calib` rewrites, then set
   Supabase Site URL/redirect URLs and custom SMTP; test confirmation,
   magic link, reset and delete account using a real inbox.
3. Run one real Google signup. Enable Apple if it is required for the web
   audience or before an iOS release; record six-month secret renewal ownership.
4. Resolve the 7-day versus 30-day trial, then implement the catalog and credit
   ledger in `BILLING_CATALOG.md` before adding server-only Preview variables.
5. Complete the full sandbox acceptance matrix in `PAYMENTS_SETUP.md`.
6. Enforce the promised free/Max boundary in the product, not just the account
   badge.
7. Publish privacy policy and terms; implement the under-18 product rule.
8. Run front → side → signup → result → checkout on iPhone Safari and Android
   Chrome over cellular, with no console/network failure.

After these eight gates, the reasonable launch call is **limited public MVP**,
with the product explicitly framed as directional cosmetic measurement and the
known reference-sample limitations disclosed. It is not ready for claims of
clinical accuracy or objective attractiveness.
