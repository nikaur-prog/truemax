# TrueMax Stage 1 verification

Verified: 20 August 2026

Scope: privacy, account/scan isolation, stale-state invalidation, live data boundaries, production deployment.

## Exit result

Stage 1 passes its exit gate: no tested path returned another user's photo, scan, result, correction, goal, pending claim or creator state, and no stale async callback could render after its owner/scan context changed.

This result does not mark later capture, calibration, billing, creator-rendering or launch gates complete.

## Source and automated evidence

- Owner-scoped browser keys and IndexedDB records replace global photo/history/calibration state. Legacy global records are quarantined rather than claimed.
- `ScanSession` binds async work to immutable scan ID, owner and epoch; reset, new scan, sign-out and identity changes invalidate old tokens.
- Anonymous pending scans use a short-lived one-time possession token and bind to the first authenticated identity that claims them.
- Quick and standard photo validation no longer hard-fail usable faces for blur, lighting or other recoverable quality issues.
- Quick, Basic, Full, cards, history and creator inputs use canonical 0–10 scores; percentile is a separate derived field.
- `npm test`: 363 tests, 362 passed, 0 failed, 1 existing TODO for the consented repeat-photo fixture.
- `npm run build`: passed with 243 modules transformed.
- `git diff --check`: passed.

## Live Supabase evidence

Applied and recorded migrations:

- `20260819090000_add_scan_id_to_side_feedback.sql`
- `20260819091000_harden_funnel_event_privileges.sql`
- `20260819100000_side_feedback_consent_audit.sql`
- `20260819192625_harden_scan_credit_privileges.sql`

Adversarial transaction:

- Used two existing auth identities with `SET LOCAL ROLE authenticated` and per-request JWT claims.
- Passed 20 assertions covering own-row read/update, cross-user read/update denial, wrong-owner and wrong-scan feedback revocation denial, correct atomic revocation/audit/cleanup, browser privilege revocation and private-bucket policy state.
- Committed only cleanup; follow-up counts were `0` fixture scans, `0` fixture consent events and `0` fixture cleanup rows.

Anonymous boundary probes:

- `side_landmark_feedback`, cleanup queue, consent audit and `funnel_events` Data API reads were denied.
- The private side-feedback bucket returned zero anonymously visible objects.
- Anonymous signed-URL creation returned no URL.
- `consume_scan_credit()` is not executable by anon/service roles; authenticated may consume only its resolved `auth.uid()` balance. Only `service_role` may call `grant_scan_credit()`.
- Leaked-password protection is enabled.
- Security Advisor: 0 errors. Its one remaining warning is intentional: signed-in users may call the `SECURITY DEFINER` credit consumer. Direct table writes are revoked, the function has an empty search path, resolves `auth.uid()` once, and cannot increase or spend another user's balance.

## Production/browser evidence

- Production deployment: `dpl_HaJVarjyMqRNt8cMx778rgSKY3NS`, Ready and promoted to `www.truemax.app`.
- `/` and `/quick` return 200 with CSP, HSTS, content-type, frame, referrer, permissions and cross-origin protections. `/quick` additionally returns `X-Robots-Tag: noindex, nofollow, noarchive`.
- `/api/health` returns `ok: true`, Node 24, and all named runtime configuration flags present.
- Chrome rendered the signed-out landing page and the Quick/Reel Creator entry; creator photo import controls were visible.
- Google OAuth returned to `www.truemax.app` as the intended account.
- Rapid sign-out/sign-in passed; returning through browser history did not restore the signed-out account.
- Two distinct browser contexts retained independent session transitions: signing out one did not sign out or reveal the other.
- Landing-page layout had no horizontal overflow or off-screen controls at 390×844 and 412×915 viewports.

## Preserved-worktree note

The deployed source came from a clean staging copy of the current audited worktree, not from a destructive reset or a replacement of the existing Claude changes. `.vercelignore` explicitly excludes local calibration inputs, secrets, build caches and render exports. The current worktree still needs an intentional commit/PR before `main` can be treated as the recoverable source release baseline.
