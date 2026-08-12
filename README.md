# TrueMax

Client-side facial-analysis web app. Upload a front-facing photo, get a
measurement-backed attractiveness breakdown — real geometry, population
percentiles, no inflation, all computed in the browser.

## Stack

- Vite + vanilla TypeScript, deployed on Vercel
- Vercel Functions for Stripe Checkout/webhooks; Supabase stores account
  identity and the server-written subscription entitlement
- MediaPipe Face Landmarker (WASM, 478 landmarks), fully self-hosted:
  - model: `public/models/face_landmarker.task` (committed)
  - WASM runtime: copied from `node_modules` to `public/wasm/` by the
    `postinstall` script (gitignored)
- No backend, no auth, no API calls. One photo in, one result, gone on refresh.

## Develop

```sh
npm install   # also copies the MediaPipe WASM runtime into public/wasm
npm run dev
```

## Build

```sh
npm run build   # type-checks then bundles to dist/
```

## Planning documents

- [SEO plan](docs/SEO_PLAN.md) — technical audit, search positioning, content
  architecture, measurement, and the 90-day rollout.
- [Launch checklist](docs/LAUNCH.md)
- [MVP readiness](docs/MVP_READINESS.md)
- [Billing catalog](docs/BILLING_CATALOG.md)

## Determinism notes

- Detection runs in `IMAGE` mode with the CPU delegate — the same photo always
  yields identical landmarks.
- Uploads are downscaled to a fixed max dimension (1280px) before detection so
  results don't depend on the display device.

## Status

- [x] Scaffold + MediaPipe landmark detection on uploaded photos
      (progressive mesh/dot reveal, scan-line, frontal/quality check)
- [x] Metric engine — 31 front-face metrics across 8 regions
- [x] Per-sex reference distributions → percentile → 0–10 scores
      (percentile-anchored, no inflation — see CALIBRATION.md)
- [x] Results UI: two-pane FaceIQ-style layout, scan theatre, overall +
      4 pillars + bell curve, 8-region drill-down with zoom/highlight,
      gradient range bars with ideal windows
- [x] Deterministic explanation templates (typewriter + key ticks, muteable)
- [x] Improvements page (non-surgical, current → potential, real numbers)
- [x] Week-over-week deltas (device-local via localStorage — no accounts)
- [x] Celebrity per-metric comparison (seeded DB + console export helper:
      `window.__truemax.celebEntry("Name")`)
- [x] Celebrity DB: 63 public figures measured by this engine (37M / 26F),
      per-metric matching, capture-quality tagged
- [x] Data-derived calibration from the measured pool (see CALIBRATION.md)
- [x] Side profile: 15 cephalometric metrics + drag-to-verify landmark editor
- [x] Pose normalization (neutralize yaw/pitch before measuring) — see
      CALIBRATION.md
- [x] Live camera capture with real-time framing coach and traffic light
- [x] Depth-shaded tracking overlay + adaptive crosshair with gaze readout
- [x] Pre-quiz: goals, off-limits topics and advice consent, driving the plan
- [ ] Coach Max — the conversational layer on top of the deterministic plan
- [ ] Celebrity profile pages (browse a celeb, see their own analysis)

## Parked (deliberately not in the MVP)

Ideas worth building once the MVP and Coach Max are real, recorded here so
they stop competing for attention now:

- Progress tracking for things the face mesh cannot see — training, athletic
  activity, diet adherence. These need either self-report or an integration,
  and a half-measured progress chart is worse than none.
- Integrations with tracking apps (calorie/food logging and similar) so the
  plan can reference real inputs instead of asking.
- A social layer.

The constraint that decides all three: TrueMax only ever claims a number it
actually measured. Anything imported from elsewhere has to stay visibly
separate from the measured score.

## Calibration pipeline (`tools/`)

```sh
node tools/fetch-photos.mjs   # pull portraits from Wikipedia
node tools/scan-celebs.mjs    # measure each with the real engine
node tools/find-better.mjs    # optional: search Commons for more frontal shots
node tools/calibrate.mjs      # derive per-sex distributions + celeb DB
node tools/apply.mjs          # write them into src/engine/
```
