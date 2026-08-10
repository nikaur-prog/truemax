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
proxy and writes **empirical quantile tables** to `src/engine/aggNorm.ts`.
Scoring interpolates a face's position in those tables to get a real
percentile, then converts that to a score. This replaced a mean/SD rescale:
the aggregate has heavy tails, so treating it as normal pushed top scores past
9 and put the population's 90th percentile at 7.4. Anchoring to the sample's
actual distribution keeps the median at 5.0 without inflating the top.

Verified: gated population median **5.0** (p10 3.8, p90 6.3); top celebrity
faces 7.2–7.3; 6.5+ stays rare.

## Stability work: what was found and fixed

Three real defects surfaced while chasing cross-photo agreement:

1. **The scale reference tracked gaze.** Every metric was normalized by
   interpupillary distance, but iris centers move when the eyes move, so the
   normalizer itself changed between photos. Metrics built on it measured ~0
   reliability. Eye centers are now the midpoint of each eye's inner and outer
   canthus — fixed to the skull, gaze-independent.

2. **The frontal gonial metric was degenerate.** It took the angle at the jaw
   corner between the cheekbone and the chin; those three points are nearly
   collinear head-on, so it read ~40° frontally (anatomically impossible for a
   jaw) and jumped to ~120° as soon as the head turned. Replaced with the
   jawline bend measured at the mid-ramus point.

3. **The test set was measuring different people.** Photos scraped by name
   include group shots, where the detector locks onto whoever it finds — one
   "Sean O'Pry" photo was five people on a stage. Every multi-photo set is now
   filtered to portrait-scale faces (>=22% of frame width). Any stability
   number produced before this filter was partly comparing strangers.

`reliability.ts` now records, per metric, the share of variance that is real
between-person signal rather than photo-to-photo noise, measured within the
capture envelope the app asks for. Scoring multiplies each metric's weight by
it, so metrics that do not reproduce cannot move the score.

## Known gap: cross-photo stability

**Still failing.** After the three fixes above, different photos of the same
person disagree with an SD of ~1.2 score points (`tools/convergence.mjs`),
against a target of ≤0.4. Mean per-metric reliability is 0.37: the average
metric's photo-to-photo noise is roughly 0.8× its whole-population spread.
Averaging ~31 correlated metrics cannot remove that.

Same photo twice is still bit-identical — determinism holds. What does not
hold is agreement between two *different* photos.

**Important caveat about the test set.** These are Wikipedia/Commons photos
taken years apart, on different cameras, at different ages and body weights.
Some of the disagreement is real facial change, not measurement error. The
product's actual case — one person, same phone, weekly — should be more
stable, but that is **unverified** and must not be assumed.

Next steps, in order:

1. **Get controlled data.** Several photos of one person in a single sitting,
   varying only framing and expression slightly. That separates engine noise
   from genuine change and tells you which target is even achievable.
2. **Shape descriptors instead of hand-picked ratios.** Procrustes-align the
   full landmark cloud and score on its principal components. Averaging
   hundreds of points is far less noisy than a ratio of two distances — this
   is the structural fix if (1) shows the noise is ours.
3. **Multi-scale measurement.** Measure each photo at several input
   resolutions and take the per-metric median to damp detector jitter.
4. **Re-derive `RHO_METRICS` / `RHO_PILLARS`** from the population set rather
   than assuming 0.3 / 0.55.

Until (1) is done, treat the overall score as meaningful to roughly ±1 point
across separate photos, and do not ship week-over-week deltas as precise —
a real +0.3 improvement is currently inside the noise.

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

## Gaze tolerance

`tools/gaze-calibrate.mjs` measures iris offset within the eye opening across
the 216 reference portraits that pass the portrait filter. Those are people
looking at a photographer's lens, so their distribution defines what "looking
at the camera" measures as:

```
offset  p50 0.088  p75 0.143  p90 0.235  p95 0.297  max 0.534
```

`GAZE_OK = 0.22` sits at roughly p88. The tail above it is genuine look-away
(Michael B. Jordan at 0.53 is turned toward something off-camera), not
measurement noise.

**This gate is advisory and does not block the shutter**, for a reason worth
recording: the eyeball rotates about 0.14 on this scale per 10° of head yaw,
and the pose gate already permits ±10°. So someone looking straight down the
lens with a slightly turned head can read 0.14, while someone at arm's length
looking at their own image on screen instead of the lens is only about 10° off
— also ≈0.14. The measure cannot separate those two cases. It reliably catches
a real look-away and it drives the crosshair's gaze pip, which is honest
feedback; making it a hard gate would strand people on a number that imprecise.

Closing this properly means subtracting the head-yaw contribution from the iris
offset, which needs a sign convention validated against live footage rather
than stills.
