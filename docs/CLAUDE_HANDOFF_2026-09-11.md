# TrueMax continuation handoff: 11 September 2026

> Historical snapshot. The owner has since authorized publishing and merging
> before calibration. See [the 19 September release status](RELEASE_CALIBRATION_2026-09-19.md)
> for the current verification, publication state and operator instructions.
> Branch state, counts and outstanding steps below describe the dated handoff.

> Transfer clarification, 13 September: see [the response to Claude's five
> questions](CLAUDE_TRANSFER_2026-09-13.md). The local code is not just this doc.
> `VITE_MORPH_PREVIEW` is a default-off frontend gate, not a server kill switch;
> deployed environment state has not been verified. The portable transfer
> package contains all current tracked and untracked changes as a binary patch.

## Read first: preserve the local work

The owner asks Claude to finish the outstanding work, prepare calibration, then
let the owner review/calibrate before merging. This is not permission to change
pricing or enable unvalidated paid morph generation.

- Working directory: the local `truemax-post-267-audit` worktree.
- Branch: `codex/post-267-audit`; inspected HEAD: `60158b076cf91999ee1d8479727f2a591d21a75a`.
- There is a large **uncommitted AND untracked** implementation batch in this
  worktree. It is not recoverable by pulling the branch alone. Inspect
  `git status --short` and preserve every relevant file before moving branches.
- Do not reset this worktree or apply the older reset/force-push cycle in
  `CLAUDE.md`. The separate local `truemax` checkout
  is not the worktree containing this batch.
- No commit, push, merge, deployment, production migration, pricing change or
  feature-rollout enablement was performed in the latest follow-up.
- PR #269 covers an earlier portion only. Inspect current remote state before
  deciding how to publish the combined work. Do not describe all local changes
  as already included in that PR.

## Implemented locally, not all release-validated

| Area | Local implementation | Remaining validation or work |
| --- | --- | --- |
| Side calibration | Readable admin images reach 13 editable points even when detection fails; templates explicitly labelled; review confirmation; original/final points, dimensions, provenance and raw metric deltas exported | Real owner-authenticated upload, review, save and export on deployed preview; operator reviews |
| Calibration identity/access | Anonymous Reference ID survives export separately from private name; same-owner token refresh no longer loses owner grant | Verify live owner gate and account switching; never bypass it |
| Report performance | Display-sized drawing buffers, cancelled stale paints, rapid front/side switching and missing-view/reduced-motion recovery; rectangular, spaced side controls | Physical iOS/Android and first-scan profiling; no measured FPS or accuracy claim |
| Max | Approved round 3D character integrated; calmer coach prompt/copy; user goal/context brief and explicit routine selection | Real provider response evaluation; user approves voice/conversation; provider and TTS chain unchanged |
| Routine continuity | Server recent snapshots, durable retry queue, private same-account retained-history export/import and Settings controls | Automatic full-history cloud sync requires a dedicated reviewed schema; recent cloud evidence is only seven tick dates and three check-ins |
| Morph | Exact owner/scan/recipe saved-job lookup, selection and interrupted-request recovery; reload can remain check-only instead of blindly creating another job | The default-off frontend gate was not enabled by this work; production state is unverified and there is no matching server kill switch. Atomic server idempotency for simultaneous tabs/devices, live storage/provider checks, retention/consent and labelled identity/target validation are required |
| Products | Small manufacturer-linked catalogue; corrected nonexistent product example and misleading cleanser copy | Not a complete regional catalogue or guarantee of suitability/stock; retain existing medicine/guardian safeguards |
| Native preparation | Share/lifecycle abstraction, camera cancellation and background handling seams | No signed native app or new Xcode project; real permissions, OAuth, storage, purchases and device testing remain |

Key new modules include `morphRecovery`, `routineHistoryBackup`,
`routineSyncQueue`, `routineHistorySettings`, `maxPlanBrief`, `maxRoutinePicker`,
`measurementPerformance`, `interactiveRaster`, `stagePaint`, `nativeBridge` and
`productDestinations`. Include their untracked files and tests in review.

## Recommended next order

1. Read the standing rules and this worktree's diff; preserve the dirty batch.
   Review all new files, not only `git diff` on tracked files.
2. Prepare an authenticated preview with the server API routes. The previous
   `http://127.0.0.1:4189` server was Vite-only: `/api/quick-access` returned
   JavaScript rather than executing the owner-auth API. It is not a valid
   environment for telling the owner to begin the full calibration set.
   Do not pull or print production secrets or use a fixture to bypass access.
3. Verify the owner flow end to end with one pilot pair: upload both originals,
   adjust side points, confirm review, save anonymous ID and export diagnostics.
   Confirm ordinary creators cannot access Calibration. Then give the owner the
   exact working preview URL and instructions.
4. Run actual Max conversation evaluation in the authorised preview. Synthetic
   assertions and scripted preview replies do not prove conversational quality.
   See `MAX_CONVERSATION_QUALITY_REVIEW.md` and
   `tools/max-conversation-quality-eval.ts`.
5. Profile scan-to-report and report navigation on actual phones. Test live
   sign-in, account changes and recent routine synchronization. Do not silently
   claim full historical cloud backup.
6. Receive the owner's reviewed geometry and matched FaceIQ evidence. Compare
   definitions/measurements before fitting scores, retain held-out identities,
   and report evidence limits. No new scoring ideals have been fitted yet.
7. Fix concrete findings, rerun gates and present the complete change set for
   the owner's review/calibration and merge decision. Do not reset away the
   existing batch. Keep larger unvalidated rollout items visibly outstanding.

Full historical cloud sync and atomic paid-render idempotency need proper server
design, migration review and authorization before production changes. Recovery
does not resume a terminated provider worker. Concurrent tabs/devices can still
start duplicate paid jobs; browser markers alone cannot solve that.

## Calibration pack and exactly what the owner does

Private download: `TrueMax-Calibration-Pilot-20-Pairs-2026-09-10-v2.zip` in the owner's Downloads folder.
Extracted sibling directory contains `gallery.html`, `README.md`, manifest and
hashes. It contains 20 fictional adult identities, 40 original PNGs: 10 declared
Women pairs (`f01` to `f10`) and 10 declared Men pairs (`m01` to `m10`). Original
bytes were preserved; no new generation or external uploads in this follow-up.

Once the authenticated build is verified:

1. Owner opens League > Tools > Calibration (`/league/tools#calibrate`).
2. Start `f01` and `m01`; use the explicitly declared reference setting and
   matching front/side files. Enter the ID in Reference ID, not just private Label.
3. Review all 13 side points and facing direction; adjust errors and acknowledge
   review. Do not guess an obscured point. Attractiveness rating may stay blank.
4. Save and export all capture diagnostics. Check exported `referenceId` values.
5. Supply FaceIQ screenshots/reports for the exact same original photos with
   raw measurements, units, construction/landmarks, displayed ideal bands,
   metric/region/overall scores and reference settings. Check these first two
   identities before collecting the entire external set.

FaceIQ recordings already informed discrepancy analysis, navigation and copy.
They are not a complete matched calibration dataset. The recording audit used
sampled frames/OCR and selected detailed inspection, not a verified transcript
of every frame. Different photos, manual edits and metric constructions can
explain differences. Do not mistake Harmony/Features scores for overall scores.
The private FaceIQ export examined earlier lacked metrics/coordinates/scores.

Reviewed landmarks are geometry evidence, not an attractiveness verdict. Saving
captures does not automatically retrain the scanner. Synthetic pairs are not
verified anatomically consistent, population norms or proof of 90% accuracy.
Never infer ethnicity from faces or copy proprietary code/hidden APIs/formulas.

## Latest verification evidence

Last full implementation run on 10 September, before this documentation-only
handoff: `npx tsc --noEmit`, `npm test`, `npm run build`,
`node scripts/emdash.mjs`, and `git diff --check` all passed.

- 2,077 tests: 2,048 passed, zero failures, 28 environment-gated skips, one todo.
- Build warning remains: lazy Max/Three chunk 617.19 kB minified, 157.18 kB gzip.
- Calibration: 56 focused tests plus two archive tests.
- Routine continuity: 21 focused tests.
- Morph: 76 focused tests, plus independent account/recipe recovery review.
- Desktop/mobile browser fixtures passed. They use synthetic API data, not
  live authentication, checkout or paid generation.

Rerun after any code changes:

```sh
npx tsc --noEmit
npm test
npm run build
node scripts/emdash.mjs
git diff --check
node --test tools/package-calibration-pilot.test.mjs
node tools/calibration-reference-smoke.mjs
node tools/routine-history-smoke.mjs
node tools/morph-recovery-smoke.mjs
node tools/measurement-performance-smoke.mjs
node tools/max-plan-flow-smoke.mjs
node tools/app-walkthrough-smoke.mjs
```

Browser scripts expect a local development server; read each script before
running. Wait for concurrent edits to stop, since hot reload can invalidate a
test mid-navigation. Artifact locations and limitations are in
`PERFORMANCE_COACH_REVIEW_2026-09-10.md`.

## First-scan paywall discussion: not approved for implementation

The owner is considering paywalling the first scan and asked for advice.
Recommendation: retain a useful free first result while measurement reliability
and trust are being repaired, then offer paid ongoing coaching/planning. Preserve
existing entitlements and prior advertised offers until explicitly changed.

Hard paywalls can be commercially effective. RevenueCat reports median day-35
download-to-paid conversion of 10.7% for hard-paywall apps versus 2.1% for
freemium. This is a cross-app observational benchmark, not a randomized TrueMax
test; it does not establish that switching this product will multiply revenue.
Source checked 11 September 2026:
https://www.revenuecat.com/blog/engineering/android-paywall-gap

After reliability is demonstrated, propose a controlled test with consistent
traffic attribution and predeclared outcomes: net revenue per acquired visitor
after refunds and service costs, successful report completion, complaints,
refunds, repeat use and subscription retention. Avoid judging only paywall
conversion, surprise charging after a promised free scan, or inventing exact
current user counts. There is no fresh analytics/user-count query in this turn.

## Document map and deferred work

- Execution/status: `TRUEMAX_MASTER_BUILD_PLAN.md`, `EXECUTION_PLAN.md`,
  `PERFORMANCE_COACH_REVIEW_2026-09-10.md`.
- Calibration: `ADMIN_CALIBRATION_REVIEW_2026-09-10.md`,
  `FACEIQ_RECORDING_AUDIT_2026-09-09.md`,
  `FACEIQ_COMPARISON_AND_CALIBRATION_PLAN_2026-09-07.md`.
- Coach/routines: `MAX_CONVERSATION_QUALITY_REVIEW.md`,
  `ROUTINE_HISTORY_CONTINUITY.md`.
- Morph/native: `MORPH_PREVIEW_CONTRACT.md`,
  `MOBILE_APP_PREPARATION_2026-09-10.md`.
- Acquisition: `ONBOARDING_VIDEO_TAKEAWAYS_2026-09-10.md`,
  `CAROUSEL_RUNDOWN_PLAN.md`, `IMAGE_FIRST_UGC_PLAN.md`.

The content roadmap, full product catalogue, complete cloud memory, validated
morph outcomes and native release are not all completed by this batch. Earlier
plans remain historical detail; this handoff is the current execution snapshot.
The supplied video transcript informed saved ideas, not new pricing or funnel
automation. Max's approved visual design should not be redesigned during this
handoff. Prioritize measurement trust, calibration access and smoothness.
