# TrueMax architecture and state map

Audit date: 19 August 2026; Stage 1 implementation updated 20 August 2026

Audited baseline: `5b055f8cdbddd1cbc5ba22ff76b5d4fb9f582431` on `main`
Working-tree status: intentionally dirty; the pre-existing Claude work listed in the master-plan handoff was preserved. No baseline tag was created because a tag cannot capture uncommitted work.

## Entry points and routes

| Surface | Entry point | Purpose |
|---|---|---|
| TrueMax Scan | `index.html` → `src/main.ts` | Front + side capture, account gate, analysis, results, history, plan and Max |
| Quick | `quick.html` → `src/quick.ts` | Internal creator/calibration workflows and front-only acquisition output |
| Auth portal | `auth.html` → `src/authPage.ts` | OAuth/email callback and password recovery |
| Calibration harness | `calib.html` → `src/calib.ts` | Offline scoring/calibration checks |
| Public static pages | `brand.html`, `privacy.html`, `terms.html` | Brand and legal pages |

`vercel.json` rewrites `/auth`, `/quick`, `/calib`, `/privacy`, `/terms`, and `/brand` to those files. Quick and calibration routes are `noindex`. The only scheduled job is `/api/cleanup-side-correction-feedback` at 03:15 UTC daily.

Server routes are:

- account and billing: `create-checkout-session`, `create-portal-session`, `reconcile-entitlement`, `stripe-config`, `stripe-webhook`, `delete-account`;
- private product services: `max-chat`, `tts`, `ai-image`, `side-correction-feedback`, `cleanup-side-correction-feedback`;
- operations: `health`, `db-probe`;
- aggregate event counter: `e`/`track` through the shared `_events` handler.

## Scan lifecycle

The standard scan is owned by `src/engine/scanSession.ts`:

```text
idle -> front -> side -> gate -> analyzing -> results
                       \------> analyzing -> results
results -> side -> analyzing -> results
```

Every attempt receives an immutable UUID and epoch token. Camera/upload work, pending auth state, history, thumbnails, and consented side corrections carry the same `scan_id`. Reset/resume advances the epoch, invalidating old callbacks. Anonymous-to-authenticated ownership may claim the same in-memory scan; persisted redirect recovery additionally requires the one-time claim token in `pendingAnalysis.ts`.

`scanGeneration` remains as a UI cancellation counter in `main.ts`, but persistence and rendering now require the state-machine token as well. Quick retains its separate creator-job generation guard; its persistent face library is owner-scoped.

## Browser state inventory

| State | Storage | Ownership / retention |
|---|---|---|
| Standard scan history | `localStorage`, `truemax:history:{sex}:{owner}` | Active `user:` or tab-anonymous owner; capped at 120 per reference population |
| Standard thumbnails | IndexedDB `truemax/scanPhotos` | `{owner, scan_id}`; 320 px JPEG; pruned with history |
| Pending auth scan | `localStorage` v2 + tab `sessionStorage` claim | 30-minute TTL; one-time token; bound to the first authenticated user that claims it; removed after use |
| Goals/coaching preferences | owner-scoped `localStorage` | Active browser/account owner |
| Weekly scan timestamp | owner-scoped `localStorage` | Active browser/account owner |
| Deferred onboarding answer | `localStorage`, explicit `user_id` key | Only the account that supplied it may flush it |
| Quick saved-face library | IndexedDB `truemax/faceLibrary` | Active browser/account owner; max 40; full-resolution local-only photos |
| Quick calibration rows | owner-scoped `localStorage` | Measurements/ratings only; no photograph in the row |
| Reference population, display mode/tone, save preference, Max-pet layout | `localStorage` | Deliberate device preferences, not scan/result ownership data |
| Visit count and anonymous owner | `sessionStorage` | Tab/session only |

Legacy unscoped history, pending-scan, saved-face, and calibration entries are not assigned to an authenticated identity. The standard settings/history deletion paths clear the active owner's history/photos; Quick exposes active-owner library/calibration deletion controls.

## Supabase data and access boundaries

| Object | Browser access | Boundary |
|---|---|---|
| `scans` | authenticated CRUD | RLS `auth.uid() = user_id` for select/insert/update/delete |
| `profiles` | authenticated select/insert/update | RLS `auth.uid() = user_id`; birth-date protection trigger |
| `entitlements`, `scan_credits`, `app_admins`, `max_chat_usage` | own-row read only | RLS `auth.uid() = user_id`; server RPCs mutate authoritative state |
| `stripe_webhook_events`, `trial_redemptions`, `funnel_events` | none | revoked from browser roles; server/service paths only |
| `side_landmark_feedback`, cleanup queue | none | revoked from browser roles; service route only; `user_id` + `scan_id`; 90-day expiry; owner-bound metadata listing and atomic revocation |
| `side_feedback_consent_events` | none | service-only pseudonymous grant/revoke/expire/delete audit; no `user_id`; 365-day maximum retention |
| Storage bucket `side-correction-feedback` | none | private, JPEG-only, 2 MB ceiling, no browser object policies; service uploads to `{user_id}/{submission_id}.jpg` |

The private feedback bucket intentionally does not issue client signed URLs because the account UI lists lifecycle metadata only and never displays the submitted photo. Settings calls the authenticated service route with both immutable UUIDs; the server binds them to the bearer-token user before deletion. A successful database revoke removes review access transactionally. Immediate object deletion is attempted next, while the protected cleanup queue covers storage failure and account deletion.

## External services and environment dependencies

| Domain | Canonical variables | Accepted aliases / defaults |
|---|---|---|
| Public Supabase client | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Valid built-in project publishable configuration is the fallback |
| Server Supabase | `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | `SUPABASE_SERVICE_ROLE_KEY` legacy alias |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, five price IDs | `SIGNING_SECRET` and `STRIPE_PRICE_*` legacy aliases |
| App origin | `TRUEMAX_APP_URL` | Request origin when unset |
| Max | `ANTHROPIC_API_KEY` | `MAX_CHAT_MODEL` optional |
| Creator voice | `ELEVENLABS_API_KEY` | voice/model IDs optional with code defaults |
| Creator image generation | `OPENAI_API_KEY` | none |
| Retention cron | `CRON_SECRET` | none |
| Build metadata | `VERCEL_GIT_COMMIT_SHA` | `dev` display fallback |

The linked Vercel project is `truemax` (`prj_IRWnQusofHlyGJDhJYjSEmjzHdqk`) on Node 24. Source-level dependency names are fully inventoried. On 19 August 2026, the production `/api/health` probe reported Node `v24.18.0` and every allowlisted required variable present. `/api/db-probe` authenticated to project `ruvgkrlfmixfnmnzqgap` with HTTP 200 and read `funnel_events` successfully. These probes expose shape/status only, not secret values.

Stripe's expected catalog is Starter monthly, Max monthly, optional Max annual, member extra scan, and standard extra scan. The webhook is the entitlement source of truth; success URL parameters do not unlock access.

## Security and privacy controls

- Content Security Policy limits scripts, connections, frames, devices, and media sources.
- API auth validates Supabase bearer tokens server-side; service keys are not referenced by browser source.
- Funnel analytics stores only allowlisted event/day counts. No user, session, IP, agent, photo, questionnaire, or token field exists.
- AI/voice routes log operational status, not upstream response bodies that can echo user content.
- Account and scan identity changes close owner-bound UI and invalidate active scan work.
- Settings can list and revoke only the active account's side-feedback submissions; the client token read is also bound to the user who opened Settings, preventing a late account switch from repainting the old modal.

## Stage 0 items not derivable from this checkout

- current open pull-request/review state;
- actual Stripe price/product resolution (the protected `/api/stripe-config` probe requires the operations secret);
- desktop/mobile benchmark recordings and measured FaceIQ motion timings;
- live two-device and deployed RLS/storage adversarial results.

These are release-gate tasks in the defect register, not assumptions filled in from code. No proprietary FaceIQ source, API, dataset, or formula was used.
