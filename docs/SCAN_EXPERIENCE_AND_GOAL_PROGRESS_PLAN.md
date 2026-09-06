# Scan experience, accuracy and goal progress

Audit date: 7 September 2026.

## Decision summary

The first scan is the priority: usable photo, consistent points, uninterrupted
analysis, account return, then a clear report. Improve those before adding a
heavier character renderer or claiming a clinically meaningful morph.

Keep the thirteen profile landmarks for the next benchmark. Repair the data
and client/server integration first, then compare candidates on the same
held-out people. More points do not fix inaccurate existing points.

Keep three concepts separate throughout the product:

1. Facial geometry and its reference-population score.
2. Observable presentation, such as visible redness or soft-tissue outline.
3. Optional body measurements used for an eligible adult's nutrition plan.

A higher body weight is not an automatic facial-score penalty. This app's photo
analysis does not establish body-fat percentage or diagnose acne, rosacea or eczema. The skin
work below concerns visible patterns and user-reported concerns, not medical
diagnoses. AAD explains that [rosacea can resemble acne](https://www.aad.org/public/diseases/acne/really-acne/acne-rosacea)
and [other skin conditions](https://www.aad.org/public/diseases/rosacea/what-is/overview).

## Evidence and limits

- Production Google sign-in was completed before and after activating the
  branded auth domain. Google showed TrueMax. Production release `3f0f6cb`
  was subsequently verified in the app footer.
- Desktop and 390 x 844 responsive report checks used the repository's
  synthetic demo portrait, processed on device. The front-only report,
  pinned photo/category rail, deep scrolling, keyboard metric details, loaded
  reference thumbnails and credits were exercised. A 1440 x 900 report and
  its two-column metric dialog were inspected.
- Production Settings loaded account-backed body-profile state. Switching
  empty metric fields to imperial left them empty. The dialog was cancelled;
  no body values, goals, feedback, consent or streak preferences were changed.
- Creator tools were checked at their entry points, including Clips Library,
  its TikTok composer handoff, Carousel, owner Brand Engine and calibration.
  Coach and the plan tracker were inspected without sending a paid request.
- FaceIQ's authenticated Overview was inspected. Its current report exposed
  a side-harmony score but locked other values. Its Simulate navigation could
  not be completed because the browser connection detached. No locked data
  was extracted, paid feature purchased, private code accessed or assets copied.
- These were not physical-iPhone Safari, camera-hardware, thermal or battery
  tests. No real payment or live morph generation was performed. A successful
  build is not a substitute for those tests.

FaceIQ's visible score is not a ground-truth target. There was no identical,
consented source-photo pair scored by both products in this pass. A numerical
comparison would otherwise mix photos, pose, versions, definitions and norms.

## Findings and release treatment

The earlier mobile/account fixes and their test results are recorded in
`MOBILE_AUTH_AUDIT_2026-09-07.md` and shipped in #261.

| Priority | Finding | Treatment |
| --- | --- | --- |
| P1 | A side placement the person rejected could become their next personal seed | Follow-up fix excludes explicit unverified placements and all guest scans from the prior |
| P1 | Feedback horizontal offsets mixed width fractions with a height denominator | Follow-up fix converts both axes to pixel units, tests non-square images, excludes rejected review rows |
| P1 | Valid morph reductions used negative effect values, but the API rejected negatives | Follow-up fix accepts finite bounded signed effects; no wider edit budget |
| P1 | The morph API nests pending device checks, but the client read only the old top-level field | Follow-up fix accepts the contract shape and fails closed on contradictory validation |
| P1 | Captioning a resized portrait/landscape could fail after provider work completed | Follow-up fix creates the caption at delivered dimensions, tested on synthetic images |
| P1 | An interrupted Max stream could leave an animation waiting forever | Follow-up lifecycle repair: bounded cleanup on error, timeout, close and cancellation |
| P1 | A render could finish after its selected variant, report or account changed | Follow-up lifecycle repair: request identity, owner binding, cancellation and guarded display |
| P1 | Experimental skin output was enabled by a URL/storage flag without the documented staff check | Follow-up fix requires authenticated staff access as well as trial opt-in |
| P1 | An incomplete side benchmark could pass without required back-point or moved-point evidence | Follow-up fix makes missing evaluation evidence a hold, without loosening thresholds |
| P2 | Clicking Plan from a visible guest report asked to unlock that same analysis again | Follow-up fix gives the plan signup its own title and explanation |
| P1 | Client omits the supported device seed and waits only five seconds for a multistage cloud pass | Next side-placement integration and measured latency experiment, not a blind timeout increase |
| P1 | Feedback does not persist the person's yes/no verification answer | Add explicit provenance before treating untouched points as training labels |
| P1 | Current reliability evidence is a small repeated-photo corpus, not an individual change threshold | Expand repeat-capture validation before claiming realistic progress or precise population ranking |
| P1 | Three side-metric centres were recentered from five profiles of one person with assumed spread | Replace provisional references with method-matched multi-person calibration; do not confuse cleaner points with validated percentiles |
| P1 | Provider instructions select presentation layers rather than enforcing numerical metric targets | Finish target-aware rendering and independent image validation before a measured-outcome claim |
| P1 | Multiple goal catalogues and copy imply different changeability, targets and rewards | Consolidate into one versioned catalogue before enabling progress awards |
| P1 | A debloat-only blueprint requests an under-eye layer its server catalogue disallows | Add cross-catalogue contract tests and resolve the allowed edit semantics; keep failure closed |
| P2 | Front-only morph requests render the front twice and discard one output | Add a true single-view provider operation and test billing/cost semantics before rollout |
| P2 | Large startup chunks and mixed static/dynamic imports remain | Profile real startup, then defer nonessential report/creator/Coach code |
| P2 | Settings can grow into a long list of feedback submissions | Add a compact summary and paginated/revealable records without losing revoke access |

The follow-up fixes do not change scoring norms, learned offsets, AI rollout
thresholds or billing prices. They do not make the current renderer a validated
prediction of someone's eventual appearance.

## Build A: dependable first scan

### One state machine and one durable result

Use the same capture and measurement path for Free, Starter and Max. Membership
decides access, not the coordinates or score produced from an identical input.

Flow: front capture -> optional side choice -> bounded placement and review ->
analysis -> account wall where required -> the exact same completed report.

- Offer Take side photo, Upload side photo and Skip. Front-only has no empty
  side box, side score, side toggle or invented profile morph.
- Paint the loading state before expensive work. Keep loading constructions
  white; apply score colours only in the result. Do not add artificial waits
  to make processing seem substantial.
- Keep the original capture identity through retry, sign-in and report restore.
  Restore once; do not consume another scan allowance or restart the camera.
- Intentional sign-in redirects do not trigger the abandonment warning.
- Abort stale work on retake, close or account switch. Backgrounding a camera
  cancels the countdown rather than taking a surprise photo on return.
- Make timeout, invalid output and offline states offer a useful next action.
  A failed cloud pass must not erase a successfully captured front photo.

Instrument stage durations and outcomes without face pixels, exact measurements
or personal identifiers in analytics. Separate download, model initialization,
inference, placement wait, report paint and auth return. Deduplicate events by a
short-lived attempt identifier, not by counting rerenders.

### Performance targets, not current benchmark claims

Measure p50/p95 on the agreed device set. Proposed acceptance targets:

- Visible response to a tap within 100 ms for already-loaded UI.
- No app-induced blank state between scan completion and report paint.
- No new animation, inference or video-decoding work scheduled behind a closed
  view. Ignore stale results immediately. An already-running synchronous
  inference cannot be interrupted mid-call; isolate it in a worker if measured
  main-thread stalls require cancellable execution.
- Profile hover and scroll for long tasks and dropped frames; do not declare
  60 fps from a screenshot or desktop-emulated phone.
- Bound display/export buffers by their visible/output need rather than retaining
  the camera's full resolution everywhere. Keep analysis on a canonical calibrated
  frame independent of viewport or membership; changing that resolution requires
  measurement-equivalence tests. Keep display overlays sharp at device pixel ratio.

Defer creator rendering, full Coach UI, history and large galleries until used.
Do not split the critical scan state across asynchronous chunks without testing
guest restore and interruption paths. Keep a static low-cost fallback during
downloads; load the actual capture dependencies early enough to avoid moving the
same wait onto the shutter button.

## Build B: substantially better side placement

### First fix the experiment

`sideCloudPlacement.ts` currently sends only photo, width and height, despite
the endpoint supporting a seed. `sideFlow.ts` starts local and cloud work in
parallel. The five-second client deadline can expire before the multistage
unseeded path finishes. This was confirmed with a mocked request, not paid calls.

Candidate implementation:

1. Compute and validate the local points on an immutable, upright snapshot.
2. Send the supported seed as fractions in that snapshot's unmirrored frame.
   Reuse exactly that frame for the returned points and fusion.
3. Benchmark seeded refinement against the current local-only and unseeded
   paths. Record time to a usable result, timeout rate and provider cost as
   well as geometric error. Choose the deadline from observed latency and the
   server budget, with a visible manual/local fallback.
4. Keep the current conservative fusion/rollout policy until the held-out result
   justifies changing it. A loading screen is not evidence of better placement.
5. Confirm prompt: neutral wording, Use these points or Place them myself;
   then ask whether they are right. If rejected, allow correction or an
   explicitly unverified result. Avoid implying that uncertainty disappeared
   just because an on-screen confidence percentage was removed.
6. Keep informed cloud permission before transmission, with an on-device path.
   A remembered choice can remove repeat prompts, not the original disclosure.

### Labels and calibration

Persist source, seed/version, review answer, corrected point IDs, geometry frame,
review status, consent version and expiry. A Yes is a user-confirmed label, not
expert ground truth. No -> Use anyway is not a positive label. Unreviewed rows
may inform diagnostics but must not silently train or approve offsets.

Keep calibration owner-only at both UI and API boundaries. Apply no automatic
offset directly to production: produce a versioned proposal and compare it on
a subject-separated holdout first. Review dataset pagination and retention so
an analysis job cannot silently benchmark just the first page or expired images.

Use real, consented profiles with independent landmark labels and adjudication.
Include both facing directions, multiple aspect ratios, phone types, facial
hair, partial occlusion, skin tones and pose variation. Repeated photos of one
person belong in one data split. Small hand-labelled sets are a pilot, not a
validated population norm.

Proposed starting study, subject to annotation cost and statistical review: a
25-person repeated-capture pilot, then at least 100 previously unseen consenting
adults with two comparable captures each for the locked evaluation. Use two
independent trained annotators and adjudication. Expand weakly represented
groups or the whole study if uncertainty remains too large. This sample size
is an engineering planning assumption, not evidence of general accuracy.

Report per-point median/p90 normalized error, signed bias, failure rate,
repeat-photo consistency, subgroup results and downstream metric/score changes.
Measure annotator disagreement as a floor on claimed precision. Untouched seed
points must not artificially make the local method appear perfect.
Record the complete input manifest and skipped/failed cases. Missing required
landmarks or moved-point evidence must hold promotion, not count as clean data.

### Should the jaw points move or multiply?

Do not move the jaw point solely to improve a score. Freeze visual definitions
for jaw corner, chin front/bottom, ear notch and jaw-hinge proxy, with labelled
examples and a clear distinction between visible skin contour and hidden bone.

Compare direct corner placement with construction from visible rear/lower jaw
tangents. Tangent helper points can improve a corner estimate without becoming
additional user-facing points. Add a landmark only if two raters can reliably
identify it and an ablation shows lower held-out measurement error or supplies
a useful new measurement. Version any changed definition and avoid comparing
old and new scores as though their measurement method were identical.

Longer term, a dedicated profile keypoint model trained on reviewed labels is
the likely lower-latency destination. General vision can assist labelling and
refinement; calibration corrects demonstrated bias, not arbitrary bad guesses.

### Make the numbers defensible

Landmark calibration and score calibration are different jobs. First establish
repeatable coordinates and raw measurements; then validate the scoring weights,
reference samples and percentile mapping. Do not tune either to flatter a
particular face or match FaceIQ's output.

The current reliability table describes 90 photos of 14 people. That can reveal
noise, but is not an individual minimum-detectable-change study or a broad
population validation. The score source map also records open calibration and
repeat-photo gates. Audit the provenance and size of each reference sample,
missing-view weighting and metric reliability; show a reference-population
position rather than implying a measured worldwide attractiveness ranking.

More specifically, `sideMetrics.ts` documents that chin projection, side midface
ratio and the submental/cervical construction differ from the original borrowed
norm definitions. Their revised centres used five profiles of one person and
an assumed spread. These are provisional references, not population calibration.
Label that limitation clearly and prioritize method-matched multi-person data;
do not silently shift them again or use their percentiles as clinical ideals.

Use a locked test set to compare repeated-photo score spread, raw-measurement
error against independent labels and subgroup performance before/after each
change. Keep score versions in history so a method change is not personal
progress. Record creator overrides as edited, never measured engine output.

## Build C: a coherent desktop and mobile interface

- Retain the mobile photo plus facial-category rail throughout the report,
  including the footer. Measure real sticky heights; keep roughly one-third
  to two-fifths of the available screen for the pinned area on typical phones,
  with a reduced compact state for very short viewports and large text.
- Desktop uses the available width for stable photo/detail columns. Keep a
  visible selected category and clickable Overall/Front/Side summaries.
- Give mouse hover, keyboard focus and touch selection the same metric content.
  Use the requested subtle bottom colour wash, matching score and plain-language
  label. Keep text contrast and non-colour status cues.
- Use short opacity/transform transitions on small elements, with a single
  requestAnimationFrame budget where needed. Avoid global pointer-triggered
  layout reads, repeated full-canvas redraws, animated blur and permanent RAFs.
- Respect reduced motion, reduced data and hidden tabs. Do not shrink rasterized
  score text through a transform as the final resting state.
- Keep scorecards in a fixed category order for comparisons, with consistent
  view labels and a missing-data state instead of substituting a stronger region.
- Unify empty/error/loading states and remove contradicted promises in Settings,
  onboarding, recommendations and the morph plan. In particular, do not imply
  exercises reshape the jaw bone or that grooming changes intrinsic eye tilt.

## Build D: realistic morphs and goal markers

### One shared contract

Replace parallel goal rules with one versioned catalogue consumed by the plan,
renderer, validator, metric bars and reward service. Each goal needs:

- eligible people and photo requirements;
- observable measurement IDs and view;
- immutable baseline, units and method version;
- supported change type and realistic bounded target range;
- measured repeatability/noise tolerance;
- preview layers, forbidden changes and validation rules;
- progress evidence, completion rule and a capped reward budget.

The current calculation closes a fraction of the gap to a reference band using
the metric's `fixability`. That is a product heuristic, not proof that a person
can attain that number. A population reference band is not automatically their
personal goal. Do not turn a proxy for puffiness into a body-fat diagnosis.

Today the UI and server catalogues also disagree on time windows and reward
amounts. The report rebuilds its target from the current scan, rather than an
accepted immutable baseline. The current preview displays a limited list of
textual current-to-target readings; it does not yet implement the persistent
green marker or per-goal rendered thumbnail proposed here.

Use only observable, supported changes. Posture may change presentation, not
mandibular bone. Skin goals refer to visible patterns and user history, not
guaranteed disappearance of a condition. Remove obligatory timelines; show
what evidence will count instead. A goal with no valid metric can use a routine
or user check-in without inventing numeric appearance progress.

### Render a target, then prove what was rendered

The server must receive and enforce target direction, bounds and allowed layers,
not merely activate a generic layer because its amount is nonzero. Distinguish
selected goals from Max's suggested view, and let the user explicitly add a
suggestion. Do not silently add goals while showing a different variant's image.

Use the supplied front and side when available. Never invent an unseen profile.
Re-measure generated images, validate protected geometry/identity and reject
edits outside the allowed range or inconsistent between views. Matching prompt
text in two calls alone is not proof of cross-view consistency. Preserve explicit
consent, provider retention disclosure, revocation and deletion.

Current validation compares a small set of front geometry relationships and
selected targets using thresholds that have not passed an identity holdout
study. It does not establish an original-side identity match or protected
skin-tone/texture preservation. Treat these as missing validation work, not
proof supplied by a successful response from the provider.

The front identity calculation also compares per-axis normalized coordinates
without accounting for frame aspect ratio. A same-face padding experiment can
therefore fail its identity threshold with no face edit. Add canonical
aspect-correct alignment and crop/padding invariance tests before expanding
render availability; do not solve false rejections by loosening thresholds.

Until all gates pass, show the measurement plan and an honest unavailable/retry
state rather than an unvalidated image. Start with controlled, consented render
examples and independent human review. Do not enable broad rendering just
because request parsing and captioning now work.

Add a total wall-clock deadline and resumable job handling before the provider
beta; a bounded poll count does not bound a single hanging HTTP request. Complete
consent-dialog focus entry, keyboard trapping and focus restoration as part of
the same end-to-end accessibility test.

### Current and goal markers

For each eligible measurement, show white Current and green Goal markers on the
same scale, with a labelled target band. Keep the reference population band
visually distinct. Add Baseline on demand and a textual summary for screen readers.
Do not rely on colour alone, and handle overlapping markers explicitly.

Targets remain fixed across rescans until deliberately edited. Store the method
and target version. A model update, user point edit, change of lighting or missing
side view must not look like earned biological progress. Mark incomparable or
noisy scans as unable to assess and ask for a comparable repeat when necessary.

### Progress and points

For a valid scalar metric, use distance to its target interval, not raw score:

`progress = clamp(1 - distance(current, target) / distance(baseline, target), 0, 1)`

Only define this when the baseline is outside the target by more than measured
noise. Require comparable own-account scans and repeated improvement beyond
that noise. Combine multiple metrics with fixed documented weights, avoiding
duplicate reward for one change shared by several goals.

Award only newly confirmed progress beyond the previous rewarded high-water
mark. Persist awards server-side with unique evidence/goal/version keys and
transactional balance updates. Reloading, re-scoring, switching goals or alternating
good/bad photos must not mint points. Missing data or a setback does not create
negative appearance points. Keep routine/streak rewards separate.

Set budgets by verified actions and milestones, not a ranking of how difficult
someone's disease or body is. Do not award more because a person has severe
scarring or withhold effort rewards because a condition persists. No exact
appearance-reward values should ship before validation and anti-abuse review.

Daily consistency has an authenticated atomic counting path. The database also
has a deduplicated service-only progress-award function, but no production
caller was found for it. The frontend's displayed completion points are not
currently a completed appearance-reward system. Replace generic overall-score
or self-report success judgements with goal-specific evidence before connecting
that ledger; self-reported success can remain a separately labelled milestone.

## Build E: visible-skin and soft-tissue work

The current skin engine produces broad tone/redness/chroma/texture/under-eye
statistics. It does not count lesions or establish validated disease classes.
There are also four experimental colour/blob-based pattern heuristics in
`skinPatterns.ts`, not a validated classifier or calibrated confidence model.
The existing trial and broader concern catalogue are groundwork, not a finished
detector for every listed condition.

Follow `SKIN_ANALYSIS_TRIAL.md`: consented licensed data, expert labels where
appropriate, subject-separated holdout, repeatable capture, skin-tone subgroup
evaluation, false-positive reporting and an Unable to assess state.

Start with narrowly defined visible findings such as inflamed-spot appearance,
redness area and uneven colour. Keep user-reported diagnoses separate. Do not
claim that a photo proves eczema, rosacea, health, hormones or obesity. Fullness
and under-chin outline can be tracked only after repeatability testing and pose
control; they cannot distinguish fat, transient swelling and anatomy unaided.

Do not mix this experimental output into the structural score. If a separate
presentation score is later desired, validate and label it separately, with
published weights and an opt-out. Do not change norms just to rank heavier
people lower or mimic a competitor's numbers.

## Build F: genuine 3D Max without taxing the scan

Use the approved identity in `MAX_AVATAR_SPEC.md`, not a new unrelated mascot.
The current animation is a 2D illustration with layered motion, not a rigged
3D character. A real 3D renderer is not inherently faster.

Deliver an optimized GLB with a clean rig, shared materials and named clips:
idle, listening, thinking, speaking, celebrate and quiet. Approve a turnaround
and motion sample before integrating. Blend clips smoothly; subtle idle should
not restart on every message, and speaking motion should not imply audio when
there is none.

Resolve the two existing avatar documents against the latest owner decision:
retain the cloud shell, visor, pupils and stub arms without new elbow joints.
No props, skateboard or push-ups. Require the editable source, asset licence,
common skeleton/rest pose, clip names/durations, scale/axes and continuous loop
position and velocity, not just an animated video of a character.

Lazy-load one renderer after the first scan/report, never in the critical capture
path. Pause fully when hidden, offscreen or reduced-motion is enabled; cap pixel
ratio, reuse GPU resources and dispose on route teardown. Handle WebGL context
loss with a crisp static version of the same character.
If the runtime uses Three.js, follow its documented
[render-on-demand](https://threejs.org/manual/en/rendering-on-demand.html) and
[explicit resource cleanup](https://threejs.org/manual/en/cleanup.html) patterns.

Agree an initial asset/download and frame budget, then test on a physical older
iPhone before rollout. Suggested starting budgets: 10,000 to 20,000 triangles,
one to three materials, at most 20 bones, a 1024-pixel texture atlas, a 1 to 2 MB
compressed asset and a small matching poster. Pilot one large Coach surface;
keep tiny avatar instances static. Test capped pixel ratio and 30 fps on mobile,
without expensive shadows or postprocessing. These are targets to validate,
not measurements of an asset that already exists. A pre-rendered animation
still has decoding/compositing costs, so it is not a zero-GPU-cost fallback.

## Delivery order and ownership

1. Ship deterministic integrity, lifecycle and contract fixes from this audit.
2. Instrument and test the first-scan funnel on real phones; build the seeded
   side-refinement experiment and repair label provenance.
3. Unify goal/target definitions, enforce target-aware rendering, then add the
   persistent marker and confirmed-progress ledger.
4. Ship visual polish and bundle reductions in independently measurable slices.
5. Train/evaluate narrow visible-pattern detectors. Integrate 3D Max only after
   asset approval and passing the mobile performance budget.

Suggested split: Codex owns capture/results, report motion, client lifecycle,
goal-marker UI and verification. Claude can own a scoped seeded-endpoint/harness
change, feedback provenance, shared goal schema and server reward ledger after
the contract is agreed. Asset creation needs an approved rigged deliverable.
Confirm file ownership for each PR; do not have two agents rewrite the same
flow independently.

## Release checklist

- Required before every push: TypeScript, full tests, build and copy check.
- Real iPhone Safari and a social in-app browser; mid-range Android; desktop
  Chrome, Safari and keyboard-only navigation. Record hardware/version.
- Free, Starter, Max, guest and owner paths; sign-in interruption and return;
  offline/slow network; no-side and front-plus-side; hidden-tab and retake races.
- Compare identical input/method versions across tiers for scoring invariance.
- Repeat scans for accuracy and noise, not just visual smoothness.
- Payment verification remains a separate deliberate owner purchase with
  webhook, entitlement, receipt and return confirmation. Do not claim 100 percent
  live payment success from this audit.
- Stop rollout on privacy/identity leakage, duplicate charges or rewards,
  unstable scan retention, worse held-out point accuracy or significant device
  regressions. Keep a versioned rollback and conservative fallback.

## Follow-up verification

The integrated follow-up passed on 7 September 2026:

- `npx tsc --noEmit`
- `npm test`: 1,524 tests, 1,497 passed, zero failed, 26 environment-gated skips
  and one existing todo
- `npm run build`
- `node scripts/emdash.mjs`
- `git diff --check`

A fresh 1440 x 900 local front-only report was generated from the synthetic
demo fixture. Its Plan action opened "Create an account to build your plan"
and stated that the analysis was already ready. No account was created in this
check. The build still reports large chunks and a mixed static/dynamic import;
these remain performance work, not failed compilation.

Tests cover signed morph effects, pending device-validation gates, delivered
caption sizes, cancelled/stale render ownership, stream cleanup, staff-only
skin access, rejected side priors, feedback coordinate units and incomplete
benchmark evidence. They do not replace held-out accuracy studies, a real
provider render, a physical-phone test or a live payment.
