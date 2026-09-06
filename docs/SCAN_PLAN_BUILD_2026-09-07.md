# Scan plan implementation, 7 September 2026

Base: main `c8bca39`. No scoring norms, fusion weights, billing prices, production
consent records or database schema were changed in this batch.

## Delivered

### Capture and report

- The automatic side-point preview, Yes/No check, rejection follow-up, loading
  state and manual correction expose Retake and Skip. Skip preserves the front
  capture and produces a front-only report. A standalone side scan has Cancel
  instead of a nonexistent front result.
- Retake aborts the previous attempt. Image decoding and readers use an owned
  snapshot; stale replies, replaced dialogs and late file-picker events cannot
  take over another scan. Retake clears the old hidden-actions class.
- Camera startup offers upload/cancel/skip before permission resolves. Camera
  failure falls back to upload. Choosing upload from a camera-origin side flow
  no longer immediately reopens the camera.
- Front and side camera requests have independent cancellation signals. A late
  permission result is stopped before it can replace a successor's video.
- Front-only loading copy no longer says both views are being combined.
- Removed the side reading screen's artificial 1.15-second minimum wait.
  The interactive front reveal has a 2.5-second animation budget, including a
  320 ms white-point introduction. This is an animation budget, not a claim
  that downloading, inference, authentication or all network work takes 2.5
  seconds. Creator/video pacing remains unchanged.
- The compact reveal always returns the pane to its immutable front image,
  even if its budget expires during a side-view beat. Aborting cancels timers,
  narration and animation frames immediately.
- Optional feedback uploads no longer delay report paint. Uploads snapshot the
  account and consent metadata and are cancelled with the scan.
- Settings loads on demand, with an owner/generation check after import and a
  recoverable download error. Logout does not download an unused Settings UI.
- Local bounded timing records cover initialized stages without photos,
  landmarks, measurements, account IDs or network telemetry. They are not a
  representative production latency benchmark.

### Side placement and calibration integrity

- The cloud request now carries validated local seeds in the same unmirrored
  frame as the photo. The default five-second deadline remains until measured
  latency justifies changing it. One budget covers encoding, fetch and body
  parsing; provider work shares the deadline and disables implicit retries.
- Seeded and full-frame placement protocols have distinct opaque versions.
  Conservative fusion and the existing release gate remain unchanged.
- The user's verification answer, final accepted/unverified state, moved point
  IDs and geometry frame are recorded separately from expert review, only with
  voluntary feedback consent. Rejecting a seed and then correcting it can still
  offer feedback consent; declining is remembered for that placement.
- Calibration analysis paginates active records. Offset candidates require
  reviewed, explicitly moved-point evidence. User Yes alone is not expert ground
  truth, and No followed by Use anyway is not a positive label.

### Morph and goal target foundations

- Single-view requests now invoke the provider once for the front and do not
  render a second front image pretending it is a side.
- Added an end-to-end render deadline, bounded consent requests, accessible
  consent focus, current-report known-job resume and aspect/crop-aware device
  identity checks. The original acceptance thresholds were not loosened.
- The shared effect catalogue and numeric recipe constrain requested edits.
  Signed strengths, target direction and bounded target ranges reach the
  provider. Instructions are not proof that generated pixels achieved a
  measurement. Device validation still gates display; rollout remains gated.
- Adults can keep device/account-scoped illustrative targets. The white marker
  represents the current reading and the green marker the saved destination.
  Targets do not silently move on a rescan. Invalid definitions and unverified
  side baselines are excluded; changed methods/goals require explicit review.
- A held target already reached/passed or outside the current allowed edit
  budget pauses the selected composite with an explanation. It does not infer
  completion from one photograph or move the goal to make rendering succeed.
- Editing or clearing targets cancels the old preview before redrawing the
  plan, including redraws that do not change report tabs.
- Removed unsupported completion-point/time promises from the morph blueprint.
  The pure future progress evaluator requires repeat readings and a supplied
  validated noise threshold, and awards nothing. Appearance points remain off.

### Max

- Coalesced SVG gaze into one frame loop, with visibility, reduced-motion,
  data-saving and teardown controls. Removed problematic prop actions.
- Built an original transform-rigged 3D character and six animation clips from
  editable procedural source. The GLB is about 203 KB, with no textures.
- Added lazy, bounded rendering, offscreen/hidden pause, quiet rest, resource
  disposal and static fallback. The development-only `?preview=max3d` exposes
  clips and front/three-quarter/side/back views. The normal product remains SVG
  pending owner visual approval and a physical-device performance pass.
- See `MAX_3D_RUNTIME_CONTRACT.md` for asset, licensing and runtime details.

## Browser checks

Used repository demo/tutorial images locally. No personal photo was uploaded
to a provider, no paid morph was generated and no account scan quota was spent.

- Desktop placement: rejected plausibility state -> Retake -> second automatic
  placement -> Use -> No -> Skip -> preserved front-only report.
- 390 x 844 responsive layout: all four preview actions visible; keyboard focus
  wraps within the modal; Retake -> same image upload -> manual correction ->
  Skip -> front-only report with no side score/toggle.
- The real 3D model rendered in the browser without console warnings/errors.
  Turnaround and clip controls worked. Return to static removed the WebGL
  canvas and restored the visible SVG. This does not establish iPhone frame
  rate, heat or battery behavior.

## Release verification

- `npx tsc --noEmit`: passed.
- `npm test`: 1,625 tests, 1,598 passed, zero failures, 26 environment-gated
  skips and one existing todo.
- `npm run build`: passed. The main entry remains about 644 KB minified
  (193 KB gzip); the existing large-chunk warning is still present. Settings
  now has its own lazy chunk. This is not a complete startup-bundle overhaul.
- `node scripts/emdash.mjs` and `git diff --check`: passed.
- Independent goal/morph review passed 46 focused tests and checked 2,012
  generated target cases against the server's recipe bounds. These are code
  checks, not measured biological outcomes or provider-render acceptance.

## Still held, not silently declared complete

1. Run the seeded/unseeded/local harness on the same independent consented
   labels. No accuracy gain or timeout increase is approved without that result.
2. Expand repeat-capture and population-reference evidence. Do not add jaw
   points or recenter norms solely to improve a displayed score.
3. Validate actual morph outputs on a locked identity/target-alignment holdout.
   Durable recovery before a synchronous POST returns its job ID remains open.
4. Validate per-goal noise thresholds and completion rules before enabling
   appearance rewards. Skin observations are not disease diagnoses, and a
   body-weight label is not a facial-score penalty.
5. Approve the 3D silhouette and animation feel, then benchmark on a physical
   older iPhone before a default rollout.
6. Real Stripe payment and physical iPhone camera/Safari checks remain owner
   acceptance tests. This batch does not certify them from build results.
