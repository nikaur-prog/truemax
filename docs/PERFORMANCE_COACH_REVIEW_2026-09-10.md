# Measurement, Coach and native-preparation review

> Status, 11 September 2026: Combined local gates passed (2,048 tests passed, zero failures). No deployment or merge; physical-device and live-provider checks remain. See the
> [current continuation handoff](CLAUDE_HANDOFF_2026-09-11.md) for branch preservation,
> verification evidence and the next execution order. Historical details below
> do not imply that the whole roadmap has shipped.

Local follow-up to `60158b0` on `codex/post-267-audit`. This batch is not pushed,
merged or deployed. PR #269 contains the earlier calibration/capture work, not
these additional uncommitted changes. No production SQL or billing changes.

## Review first

- `http://127.0.0.1:4189/?preview=max-coach` shows the actual Coach and chat layout
  with scripted local replies. It does not call the paid chat API or save data.
- `http://127.0.0.1:4189/?preview=max3d` provides a larger animation workbench.
- The production Coach dashboard and Max chat now mount the same rounded 3D
  character. Small scan/report icons intentionally remain the original SVG.
  Reduced motion, data saving or a failed renderer retain a static fallback.

This is a real 3D mesh with the original blue-character design, not the old
animated SVG placed inside a 3D frame. The speaking state opens the mouth as
text streams; this is not a new audio-speech or phoneme lip-sync feature.

Follow-up visual polish: Coach/chat now default to front view, not the inherited
three-quarter presentation angle. Mirror holds the prop ahead of the visor and
winks; skate reveals the rounded deck, trucks and four wheels before a full
long-axis kickflip and landing. The other ten animation clips, including
speaking, retain their exact authored numeric tracks. The regenerated asset is
version 4, and the runtime request includes its version to avoid stale caching.

## Implemented

### Measurement interactions

- Cancelled front/side detail transitions can no longer leave the photo hidden.
- Detail navigation immediately cancels the previous animation and retains
  navigation when a required photo is unavailable.
- Display-sized detail rasters reduce canvas work without changing original
  photo pixels, measurement coordinates or calibration exports.
- Main-report hover and region overlays now also use display-sized rasters.
  The synthetic 1440 x 2160 fixture used 1078 x 1616 overlay pixels on desktop
  and 330 x 495 on the compact mobile report. This reduces drawing work, not
  source-photo detail or measurement coordinates; it is not a measured FPS gain.
- Region transitions cache stationary mesh/background content; reduced-motion
  mode paints a static result. The first animation frame contains geometry.
- Main-report photo swaps and side hover-out redraws retain unchanged canvas
  dimensions while resetting drawing state. Older browsers use the original
  reset fallback so clipping and previous styles cannot leak into the next view.
- Removed forced per-measurement text reflow and shortened the detail camera
  transition to 240 ms.
- Bounded local timing records track animation request to first drawing and
  cancellation, with no photo/account/measurement data or network writes.
- Side-photo captions distinguish confirmed points, explicitly unconfirmed
  points and legacy records without confirmation. They no longer label every
  side scan as checked by the user.

### Max integration and continuity

- One active 3D renderer is shared between Coach and chat. Closing chat restores
  the underlying Coach character. Hidden/offscreen/background states pause it.
- Listening, thinking, speaking, celebrating and quiet states are connected;
  the existing gestures are available in the preview. Quiet stops drawing after
  its short transition settles.
- Removed repeated theatrical greetings; the persona instructions favor direct
  explanations, known evidence and an actionable next step.
- Removed the hardcoded "Let's get down to business" and "Alright" report
  openings as well. Report summaries lead with supported measurements. Rescan
  wording no longer invents adherence, physical progress or a cause for a score
  change. A modelled score scenario is not presented as an achievable ceiling.
- Follow-up questions use the latest supplied context, goals and routine state.
  The display cleans up markdown and em dashes consistently for streamed and
  reopened replies. These are presentation rules, not a guarantee of response
  quality. The existing chat and audio providers have not been switched.
- Selected goals, preferences and explicit routine evidence travel in bounded
  coaching context. The privacy note now describes that accurately. Chat does
  not send photographs.
- Existing conversation history is resumed. Routine choices come from the
  existing recommendation catalogue, not unvalidated free-form model output.
- A new optional **Build my plan** brief captures up to three priorities,
  desired outcome and products/time/budget/constraints before sending a chat
  request. It shows existing routines and says what is saved. Opening or
  cancelling the brief does not spend a chat turn. Choosing routines remains a
  separate explicit action after the advice.
- Routine lifecycle information uses existing account tables and stable routine
  IDs with compare-and-set retries for concurrent updates. Local routine saves
  are checked before reporting success; adding a routine does not mark it
  completed or award points. Known routines now restore across devices, including
  completed/declined states and postponed starts. Only recent evidence is restored,
  not a complete adherence history; partial histories are labelled accordingly.
- Saved chat notes are displayed separately from tracked routines. Older clients'
  stale plan labels cannot override current server routine states, and chat-note
  commands cannot overwrite reserved routine records. Account changes close private
  chat and dialogs. Drafts typed during history loading are preserved.
- Keyboard focus stays in chat; Escape dismisses a child routine dialog without
  also closing the chat. Successful brief handoff does not steal chat focus.
- Added 18 synthetic conversation-quality cases and a captured-reply review tool.
  They exercise production prompt construction without claiming to evaluate live
  provider behavior. See [conversation review](MAX_CONVERSATION_QUALITY_REVIEW.md).

### Product destinations

- Added curated manufacturer pages for sunscreen, moisturiser and gentle cleanser
  examples. Matching report recommendations and the basic routine picker can link
  directly to the relevant product instead of a generic search.
- Links identify the manufacturer and Australian region and are optional examples,
  not required purchases. Verification covers product identity/label, not clinical
  endorsement, current stock or prices. Other categories retain their existing
  fallback; the entire product catalogue is not represented as curated.

### Calibration and native preparation

- Side exports now compare original suggested points/measurements with reviewed
  ones. Invalid automatic geometry stays unscored without blocking corrected
  evidence. A private local summary script highlights larger corrections.
- Camera, canvas recovery and 3D rendering have native lifecycle seams. Native
  sharing has explicit cancellation/error handling without changing web saves.
- Late camera permission and canvas decode results are discarded after the
  relevant screen closes or app backgrounds.

See [admin calibration instructions](ADMIN_CALIBRATION_REVIEW_2026-09-10.md)
and [native preparation and release gates](MOBILE_APP_PREPARATION_2026-09-10.md).

## Evidence and boundaries

Final local gates on 10 September 2026:

- `npx tsc --noEmit`: passed.
- `npm test`: 2,012 passed, zero failures, 28 environment-gated skips and one
  existing todo (2,041 total tests).
- `npm run build`: passed. The lazily loaded Three.js/Max renderer remains a
  617.19 kB minified chunk (157.17 kB gzip), so Vite's chunk-size warning remains.
  It is not evidence of a failed build, nor a reason to preload it during scans.
- `node scripts/emdash.mjs` and `git diff --check`: passed.
- `node tools/max-coach-smoke.mjs` and
  `node tools/measurement-performance-smoke.mjs`: passed at both viewport sizes.
- `node tools/max-plan-flow-smoke.mjs`: passed at both viewport sizes. Covers
  brief review, focus handoff, chat request context, explicit routine selection,
  no automatic start/tick, nested-dialog Escape, typed draft preservation,
  account-switch closure and no horizontal overflow. API replies are simulated.
- `node tools/app-walkthrough-smoke.mjs`: passed desktop and touch-mobile
  viewports. Covers landing, signup layout, front-only tutorial, report region and
  metric navigation, mobile sticky photo/tabs, side capture/review/skip controls,
  missing-view recovery and reduced motion. Zero browser exceptions.
- `node tools/max-gesture-smoke.mjs`: rendered deterministic prop/wink/trick
  poses, then checked live mirror and skate return to idle and speaking playback.
  This evidence belongs to the preceding visual-polish pass; animations were not
  changed in the conversation-focused follow-up.

Browser checks use isolated local Chromium sessions at 1440 x 1000 and
390 x 844 CSS pixels, not authenticated production accounts or physical iPhones.
The measurement fixture is deliberately geometric: it is not a scanned person
and is not calibration evidence. It verifies 30 rapid front/side reversals,
visible stages, unchanged source pixels, no horizontal overflow, missing-view
recovery and reduced motion. The Max fixture verifies one renderer, speaking,
quiet shutdown, simulated native background pause, restoration and static
reduced-motion fallback. No paid chat API requests are made.

The broad walkthrough blocks external requests. It is not evidence of live
Google sign-in, checkout, cloud point placement or detector-to-report success.
The signup screenshot's unavailable Google message is caused by that deliberate
test isolation. No real user's face or account data is included in test artifacts.

The native unit tests use simulated lifecycle/media adapters. Real WKWebView,
camera permissions, OAuth, native storage and App Store purchases still need a
signed device build. There is no new Capacitor/Xcode project in this batch.

## What comes after your review

1. Review the local Max, plan brief, routine selection and measurement interactions.
   Before merge, run the synthetic conversation cases against actual provider
   replies using an authorized preview environment. Local checks did not have
   live provider credentials; prompt assertions cannot establish conversational
   quality. Audio voice selection and lip-sync are unchanged.
2. In the owner-only League calibration tool, review all thirteen side points
   for each pilot identity. Start with one pair, save and export it, then finish
   the set. The existing pilot is 20 identities and 40 images.
3. Supply the full capture JSON with matching FaceIQ evidence and reference
   settings. Compare landmark definitions and raw measurements before fitting
   any score mapping; reserve held-out identities for validation.
4. Profile the main report hover path and first scan on physical iOS/Android
   devices, then test live sign-in and API integrations on a preview deployment.
   Main and detail overlays now use display-sized drawing buffers, but no
   measured device FPS or placement-accuracy percentage is claimed.
5. Fit and validate scoring changes using reviewed calibration evidence before
   enabling goal-driven morph outcomes or appearance-progress rewards. The new
   plan/routine flow and small product catalogue are implemented; validated
   morphs, complete historical synchronization, additional product categories
   and a signed native app remain separate work, not silently marked complete.

Neither saving calibration faces nor comparing FaceIQ scores automatically
retrains a detector. Scoring ideals and the chat provider have not been changed.

## Pre-calibration follow-up

The next local batch closes recoverability and handoff gaps without fitting new
scores or enabling image generation:

- The calibration pack contains the unchanged 20 fictional identities and 40
  original images, a paired offline gallery, instructions and SHA-256 hashes.
  The pack is private/local, not a public web asset. Version 2 explains the new
  explicit anonymous Reference ID field so `f01` and similar keys survive the
  capture export without exporting private person labels.
- Calibration access now distinguishes the raw account ID in the server grant
  from the prefixed device-storage owner scope. A same-account token refresh
  must retain owner access; signing out or switching accounts must clear it.
- Routine-history Settings can export and explicitly import the history still
  retained on the device. Import preserves incomplete-history markers and
  terminal records, and does not award points or count a new day. This is not
  automatic full-history cloud synchronization. A durable recent-snapshot queue
  makes interrupted account sync retryable without silently acknowledging newer
  edits.
- Morph recovery checks existing account-owned jobs for the same scan and exact
  numerical recipe before making a render request. Saved-job recovery and
  uncertain-request handling do not enable the release flag, restart a terminated
  provider worker or establish identity/target validation quality.
- Added a verified-label niacinamide product example. Corrected a nonexistent
  benzoyl-peroxide product example and an incorrect blanket claim about
  salicylic washes; the medicine/guardian safeguards are unchanged. Evidence and
  the new interview's testable ideas are in
  [the onboarding-video takeaways](ONBOARDING_VIDEO_TAKEAWAYS_2026-09-10.md).

For FaceIQ, the existing recording review is already useful for discrepancy
triage and presentation design. It is not a complete matched score dataset.
Keep each report's exact image, view, units, construction, reference settings,
displayed range and score scope. Start with a matched pair of pilot identities
before spending effort collecting the whole external set. TrueMax point review
does not require an attractiveness rating. See
[the recording audit](FACEIQ_RECORDING_AUDIT_2026-09-09.md) for observations and
known mismatches; do not turn a Harmony score into an overall score.

## Local review evidence

- Broad desktop/mobile walkthrough: temporary artifact folder `truemax-app-review-3gSvdv`.
- Plan and routine flow: temporary artifact folder `truemax-plan-flow-qwUGmu`.
- Avatar lifecycle: temporary artifact folder `truemax-coach-review-9rvkgP`.

These local temporary folders are not shipped assets and may be removed by the
operating system. Regenerate them with the named smoke scripts when needed.

## Pre-calibration follow-up verification

Final local checks on the combined, uncommitted build:

- `npx tsc --noEmit`: passed.
- `npm test`: 2,077 tests, 2,048 passed, zero failures, 28 environment-gated
  skips and one existing todo.
- `npm run build`: passed. The lazy Max/Three runtime remains 617.19 kB
  minified (157.18 kB gzip), with the existing chunk-size warning.
- `node scripts/emdash.mjs` and `git diff --check`: passed.
- Calibration: 56 focused tests and two packaging tests; actual save-form and
  serializer fixture at desktop/mobile widths. All 40 packaged image files
  retain their source bytes and hashes.
- Routine continuity: 21 focused tests and desktop/mobile component checks,
  including explicit import, malformed files, account changes and sync timeout.
- Morph recovery: 76 focused tests and desktop/mobile component checks with
  synthetic API responses. Unknown POST remains check-only after reload; no
  paid provider calls were made.
- Measurement interaction: rerun passed at 1440 x 1000 and 390 x 844, including
  rapid reversals, missing-view recovery and reduced motion, with no JavaScript
  errors or horizontal overflow. This is not a device FPS benchmark.

Latest artifacts:

- Broad walkthrough: temporary artifact folder `truemax-app-review-VhQYLa`.
- Plan flow: temporary artifact folder `truemax-plan-flow-8DWtTV`.
- Calibration form/export: temporary artifact folder `truemax-calibration-reference-D7hXe6`.
- Routine history: temporary artifact folder `truemax-routine-history-Ozm3fn`.
- Morph recovery: temporary artifact folder `truemax-morph-recovery-XBbdww`.
- Measurement interaction: temporary artifact folder `truemax-measurement-review-L8udCK`.

The localhost server is Vite-only and does not execute `/api/quick-access`.
Real owner calibration requires an authenticated preview deployment with these
changes before the operator starts the full set. No owner gate was bypassed,
production migration applied, feature rollout enabled, commit pushed or branch
merged in this follow-up. Live provider conversation quality, authenticated
DB/storage recovery, physical-device profiling and calibration fitting remain
explicit next gates.

An independent recovery review found no new owner/recipe isolation issue, but
simultaneous tabs or devices can still both pass an empty preflight and start
paid renders. Server-side atomic idempotency is required before broad paid
generation rollout. Local markers only protect a single panel and recoverable
reloads; they are not a cross-device charging guarantee.
