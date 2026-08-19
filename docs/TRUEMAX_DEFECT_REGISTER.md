# TrueMax defect register

Audit date: 19 August 2026; updated 20 August 2026

Severity: P0 release/emergency, P1 release-blocking, P2 important, P3 polish.

## Closed in the Stage 0/1 repair

| ID | Sev | Defect and reproduction | Resolution / evidence |
|---|---:|---|---|
| TM-001 | P0 | Sign in as account A, create history/goals/photos, then sign in as B on the same browser; unscoped browser keys could return A's state. | Owner-scoped browser keys and IndexedDB records; account isolation tests in `scanScope.test.ts`. |
| TM-002 | P0 | Capture for A, change identity or start over while async detection/reveal/storage is pending; a late callback could paint/persist stale state. | Explicit `ScanSession`, immutable scan ID + epoch, reset/identity invalidation, stale-token tests. |
| TM-003 | P0 | Leave an anonymous pending scan in shared browser storage, then sign in as another person. | v2 pending payload, 30-minute TTL, tab/redirect possession token and first-user binding. |
| TM-004 | P0 | Start a new scan after a prior front/side capture; old canvases/points could survive module state. | New-scan hard reset clears canvases, side data, result UI, creator attachments and pending work. |
| TM-005 | P1 | Basic could present a transformed `0–100` value while Quick/Full used `0–10`, making one face appear to have different scores. | All modes now consume canonical 0–10 report values; percentile remains a separate field and label. |
| TM-006 | P1 | Use a normal handheld or downloaded face photo; validator blocked on blur/lighting/size despite a usable mesh. | Quick proceeds on any detected face; standard scan hard-fails only unusable geometry and turns blur/lighting/smile into warnings. |
| TM-007 | P1 | Download a Quick card or rundown; client sent typed events that the API allowlist silently ignored. | One shared `FUNNEL_EVENTS` allowlist; regression test includes both events. |
| TM-008 | P1 | Open Quick on a browser previously used by another producer; global IndexedDB could display saved full-resolution faces. | Quick library and calibration rows are owner-scoped; legacy global records are quarantined. |
| TM-009 | P1 | Follow a consented correction from storage to product state; it had only a submission UUID and no scan linkage. | `scan_id` now flows through consent intent, metadata, API insert and migration; `(user_id, scan_id)` index and tests added. |
| TM-010 | P1 | Add `?dev` in production and make clipboard copy fail; normalized face points were dumped to the console. | Developer exporter is build-gated and never falls back to console. |
| TM-011 | P1 | Trigger upstream AI/voice failure; provider body could be logged and could echo user-entered content. | Logs retain status/sanitized error only; static privacy regression test. |
| TM-012 | P1 | Inspect `funnel_events` privileges; RLS had no policies, but browser roles were not explicitly revoked and the service RPC grant was implicit. | New hardening migration revokes browser/table/function access and grants only required service privileges. |
| TM-013 | P1 | PostgreSQL's default `PUBLIC` function privilege left `consume_scan_credit()` callable by anonymous roles even though its `auth.uid()` predicate could not spend another user's balance. | Migration `20260819192625_harden_scan_credit_privileges.sql` revokes inherited/browser grants, permits only authenticated consumption, permits only service-role grants, uses an empty search path and resolves the caller once. Live privilege checks and Security Advisor confirm the anonymous warning is gone. |
| TM-103 | P1 | A user could delete the whole account and wait for 90-day expiry, but could not revoke one side-feedback submission. | Settings now lists safe lifecycle metadata and calls an owner/scan/submission-bound revoke RPC. Row deletion and pseudonymous audit are atomic; private object deletion is immediate or queued. Focused privacy/API tests pass. |
| TM-101 | P1 | A drifted live schema could differ from the source RLS/storage migrations. | Applied and recorded all four Stage 1 migrations. A transaction using two real auth identities passed 20 owner/scan/RPC assertions and left zero fixture rows. Anonymous Data API reads were denied; the private feedback bucket listed zero objects and refused signed URLs. See `TRUEMAX_STAGE1_VERIFICATION.md`. |
| TM-102 | P1 | Same-browser, isolated-browser, rapid sign-out/in, history navigation and OAuth return paths needed end-to-end verification. | Google OAuth returned to production, rapid sign-out/sign-in passed, forward history could not restore a signed-out account, and signing out one of two distinct browser contexts did not sign out or expose state in the other. Automated identity/claim/stale-callback tests supply the two-account and stale-data coverage. |

## Open release gates and defects

| ID | Sev | Reproduction / risk | Required close condition |
|---|---:|---|---|
| TM-104 | P1 | Production `/api/health` and `/api/db-probe` pass as of this audit, but configured Stripe IDs were not resolved through the protected probe. | `/api/stripe-config` passes in production; webhook delivery and price/product IDs are verified in Stripe. |
| TM-105 | P1 | The repeat-photo calibration test is still TODO; current fixtures cannot prove Stage 4 repeatability. | Consented standardized repeat set meets median ≤0.5/10 and P90 ≤1.0/10. |
| TM-106 | P1 | Quick producer exports can explicitly override the score and recompute percentile without marking the artifact as edited. | Add durable edited-output metadata/watermark or remove override from public-facing exports. |
| TM-107 | P1 | Current face detector configuration is optimized for one face, so the Stage 2 “multiple faces” hard failure is not independently proven. | Multi-face detector/test set reliably rejects ambiguous group photos. |
| TM-108 | P2 | Confidence is capture copy rather than a versioned per-metric/result data field. | Add confidence and uncertainty to the metric registry/report and display it without lowering attractiveness. |
| TM-109 | P2 | Source inventory cannot reveal current open PR/review state. | Authenticated repository review documents or closes open work before the release baseline is tagged. |
| TM-110 | P2 | FaceIQ desktop/mobile recordings and motion timings were not supplied in this checkout. | Record visible flows, measure timings, and store observations only; do not inspect/copy proprietary internals. |
| TM-111 | P2 | The Supabase JS test run warns that Node 20 and below are deprecated, although linked Vercel runtime is Node 24. | Align local/CI Node to 22+ and verify lockfile install/test. |

## Current release assessment

There is no known unresolved P0 or P1 privacy/account-isolation defect in the audited source or deployed Stage 1 checks. The Stage 1 exit gate passed on 20 August 2026; full evidence is in `TRUEMAX_STAGE1_VERIFICATION.md`. Stage 2 begins next with multi-face detection and versioned confidence still open (TM-107/TM-108); the consented repeat-photo gate (TM-105) remains Stage 4 work.
