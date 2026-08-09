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
- [ ] Results UI (overall + pillars + bell curve, region drill-down)
- [ ] Deterministic explanation templates (typewriter)
- [ ] Improvements page (non-surgical, current → potential)
