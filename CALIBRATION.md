# Engine calibration notes

## How scoring works

1. `src/engine/metrics.ts` computes ~31 raw front-face measurements from the
   478 MediaPipe landmarks (roll-corrected pixel space, everything normalized
   by interpupillary distance).
2. Each metric has a per-sex reference distribution (mean/SD) and, for
   "band" metrics, an ideal value. The engine converts the raw value into an
   **effective z** that is standard-normal across the population:
   - `higher` / `lower` metrics: `±z` directly.
   - `band` metrics: the fraction of the population sitting *farther from the
     ideal* than this face, probit-transformed back to a z. Being exactly on
     an ideal is genuinely rare by construction — no inflation is possible at
     the metric level.
3. Aggregation (`scoring.ts`): weighted mean of effective z's per pillar,
   re-standardized under an assumed inter-metric correlation (ρ=0.3), then
   pillars → overall (ρ=0.55). Score = `5 + 1.3·z`, so:
   - 5.0 = 50th percentile
   - 6.5 ≈ top 12%
   - 9.0 ≈ 1 in ~1000
4. Per-metric influence is clamped (|z_eff| ≤ 2.2) and analytic sensitivity
   (`maxMetricInfluence()`) stays under 0.3 overall-points per σ — one noisy
   landmark cannot swing the result.

## Mesh space vs caliper space (important)

Distribution means are in **mesh-measurement space**, not anthropometric
caliper space. MediaPipe's contour points sit wider than anatomical
bizygomatic/bigonial landmarks, its "philtrum" is shorter, etc. Seeds were
set from published averages, then shifted to mesh space against test faces.
Never copy a mean straight from an anthropometry paper without checking what
the mesh actually measures.

## Tuning workflow

1. `npm run dev`, upload a photo, open the "Engine" dev readout, or read
   `window.__truemax.report` in the console — every metric's value, z, and
   score is there.
2. If a metric's z is consistently extreme (|z| > 2.5) across *several*
   normal faces, its mean/SD seed is off → adjust in `metrics.ts`.
3. If a known-attractive face underscores on a metric it visibly excels at,
   move the `ideal` (band metrics), not the mean.
4. Re-run the harness (scratchpad `test-engine.mjs`) after edits: it dumps
   full tables for the test photos and enforces determinism, per-sex
   divergence, and sanity bounds.

## Current calibration status

- Seeded against 2 public-domain official portraits (male, female). Both
  smiling — which is why lip/mouth metrics read low; the quality check now
  flags non-neutral expression (blendshape smile score > 0.35).
- **The 10-celebrity acceptance test has NOT been run yet.** Before filming
  content: scan ~10 consensus-attractive + average faces per sex, confirm
  attractive faces land 6+, average ~4.5–5.5, and tune means/ideals/weights
  until they do.

## Known measurement caveats

- **Smiles** widen the mouth, lift corners and blunt the jaw → warn, and
  prefer neutral-expression photos for content.
- **Top third** uses the mesh's forehead top, not the hairline (MediaPipe
  cannot see hair) — it is labeled "est." and weighted low.
- **Gonial angularity** is a 2D frontal projection, not the true side-view
  gonial angle (that arrives with the side-profile step).
