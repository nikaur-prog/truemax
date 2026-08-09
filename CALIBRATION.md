# Engine calibration notes

## Pose normalization (measurement space)

Metrics are **not** measured in image space. `geometry.ts` reconstructs the
head's own 3D coordinate frame from the landmark cloud and projects into it:

- **lateral axis** — perpendicular to the facial symmetry plane, averaged over
  15 mirrored landmark pairs
- **vertical axis** — principal direction of 22 midline points, fitted inside
  the symmetry plane

Projecting onto those two axes yields a canonical frontal orthographic view,
so yaw, pitch and roll are removed before a single metric runs. A face turned
30° no longer measures as a narrower face.

**`POSE_CALIBRATION.zScale`** compensates for MediaPipe's landmark `z` being
compressed relative to `x`/`y`. Without it, the estimated axes under-tilt and
a face rotated by θ recovers as `u·√(cos²θ + k²sin²θ)` instead of `u`. The
value is tuned by sweeping for minimum score disagreement across different
photos of the same person (`tools/sweep-z.mjs`, verified by
`tools/convergence.mjs`). Re-derive distributions after changing it.

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

## Reference sets (two, and they do different jobs)

1. **Population proxy** (`tools/population-list.mjs`) — 62 people notable for
   their work, not their looks (scientists, politicians, economists, authors,
   engineers). Effectively random draws with respect to appearance. **Defines
   mean and SD.**
2. **Celebrity set** — models, actors, musicians, athletes, streamers. A
   hand-labeled top tier **defines the ideals**; the whole set becomes the
   comparison DB.

Using the celebrity set for spread was tried and is wrong in both directions:
its own spread makes the median celebrity score 5.0 (they are not average),
and widening it artificially lifts *everyone* — literal score inflation.

Finally, `tools/normalize.mjs` measures each aggregate z across the population
proxy and writes `src/engine/aggNorm.ts`. Scores are standardized against
those real numbers (median for centering, SD for scale), so "5.0 = 50th
percentile" holds by construction instead of by distributional assumption.

Verified: gated population median **5.0** (p10 3.8, p90 6.3); top celebrity
faces 7.2–7.3; 6.5+ stays rare.

## Known gap: cross-photo stability

Different photos of the same person still disagree by ~2.5 score points
(`tools/convergence.mjs`), against a target of ≤0.4. Pose normalization
removed the pose component — at fixed calibration it halved disagreement
(0.80 → 0.40) — but residual per-photo variation (expression, lighting,
resolution, the subject's age and weight in that photo) still moves ~31
correlated metrics together, and the aggregation amplifies it.

**Do not treat a single scan as precise to a tenth until this closes.**
Likely directions, in order of expected payoff:

1. Reduce per-metric noise — measure at several input scales and take the
   median per metric, rather than trusting one detection.
2. Re-check `RHO_METRICS` / `RHO_PILLARS` empirically from the population
   set instead of assuming 0.3 / 0.55.
3. Down-weight the metrics with the worst cross-photo variance (measurable
   directly from `alt-scans.json`).

## Current calibration status

Distributions are **derived from measured data**, not hand-guessed. 67 public
figures were fetched and scanned with this engine; per metric and sex:

- `mean` = median of the strict-gated pool (|yaw| ≤ 16°, |pitch| ≤ 17°, smile ≤ 0.6)
- `sd`   = 1.25 × robust SD (1.4826 × MAD) of that pool — the general
  population is more varied than a celebrity sample
- `ideal` = median of a hand-labeled top tier, clamped to within 1σ of the mean

Because `ideal` comes from consensus-attractive faces while `sd` reflects the
wider pool, top-tier faces cluster near the ideal and score high while the
pool median scores ~5.0. No inflation is introduced — scoring still converts
closeness-to-ideal into a population percentile.

Regenerate with the scratchpad pipeline: `fetch-photos.mjs` → `scan-celebs.mjs`
→ `calibrate.mjs` → `apply.mjs`.

### Acceptance-test state (well-captured photos)

Attractive, cleanly-shot faces reach 6+ (Bale 6.7, Chalamet 6.5, Gandy 6.2,
Clooney 6.2, Portman 6.2, Pattinson 6.1, Dua Lipa 6.0, Jolie 5.9); average
and mid-tier faces land 3.5–5 (IShowSpeed 3.6, Marlon Wayans 3.9, Ed Sheeran
4.2, Pete Davidson 4.5). That is the intended spread.

**Capture quality dominates residual error.** Off-axis or head-tilted photos
score badly regardless of the face: Hailey Bieber 2.6 (pitch −27°), Billie
Eilish 2.1 (pitch +17.9°), Rihanna 2.8 (yaw −30.7°), Jordan Barrett 5.2
(yaw −25.6°). The quality panel warns on these, but the real fix is pose
normalization (below) — that is the highest-value next change to the engine.

### Next accuracy step: pose normalization

MediaPipe returns 3D landmarks plus a head transformation matrix. Rotating
the landmark cloud into a canonical frontal pose before measuring would
neutralize yaw/pitch and make off-axis photos measurable. This requires
re-deriving distributions afterwards (same pipeline).

## Known measurement caveats

- **Smiles** widen the mouth, lift corners and blunt the jaw → warn, and
  prefer neutral-expression photos for content.
- **Top third** uses the mesh's forehead top, not the hairline (MediaPipe
  cannot see hair) — it is labeled "est." and weighted low.
- **Gonial angularity** is a 2D frontal projection, not the true side-view
  gonial angle (that arrives with the side-profile step).
