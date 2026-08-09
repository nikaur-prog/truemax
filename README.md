# TrueMax

Client-side facial-analysis web app. Upload a front-facing photo, get a
measurement-backed attractiveness breakdown — real geometry, population
percentiles, no inflation, all computed in the browser.

## Stack

- Vite + vanilla TypeScript, deployed as a static site (Vercel)
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
- [ ] Side profile (drag-to-verify landmarks + ~8 side metrics)
- [ ] 10-celebrity acceptance tuning (see CALIBRATION.md)
