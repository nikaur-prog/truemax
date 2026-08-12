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

## Skin: measured, and deliberately not scored yet

`src/engine/skin.ts` measures five skin statistics; `tools/skin-reliability.mjs`
puts them through the same test every other metric had to pass — how much does
this move between photos of the same person, against how much it moves across
the population?

Across 106 population portraits and 14 people with repeat photos (65 images):

```
metric           between-SD  within-SD   reliability
toneEvenness        0.0642     0.0554       0.254   weak
rednessSpread       1.0948     1.3743       0.000   photography, not skin
chromaSpread        1.0126     1.1361       0.000   photography, not skin
texture             0.1237     0.1081       0.237   weak
undereyeRatio       0.1317     0.0901       0.532   usable
```

Geometry metrics already in the score sit at 0.3–0.7. **Only `undereyeRatio`
clears that bar.** Redness and chroma spread reproduce at zero: the within-person
spread is *larger* than the population spread, which means those numbers are
describing the camera and the room, not the face.

Tone evenness started at 0.088 and reached 0.254 only after flat-fielding —
subtracting a heavily blurred copy of the face before measuring spread. That
single change is the whole story: raw lightness variation across a face is
mostly the direction of the light. What survives after removing the smooth
illumination field is small.

### Why this test is harsher than the real case

The repeat photos come from different shoots — different cameras, lighting,
years, and makeup. Two confounds hit skin specifically and barely touch
geometry:

- **Retouching.** Press and publicity photos are routinely smoothed. That
  destroys texture signal directly, and it is not evenly applied.
- **White balance.** A jaw angle does not care what colour temperature the
  room was. `rednessSpread` cares about nothing else.

So these numbers are a floor, not a verdict. Someone photographing themselves
weekly under their own bathroom light is a much easier problem than this set.

### What would settle it

The same controlled capture that is already blocking cross-photo stability:
6–8 photos of one person in one sitting, then the same again a week later. That
separates engine noise from genuine change for the geometry metrics AND gives
skin a fair test under realistic conditions. One sitting unblocks both.

Until then skin is measured, stored and shown as its own number — and does not
touch the overall score. The reliability weighting would assign it near-zero
weight anyway; wiring it in early would just make week-over-week deltas noisier,
which is the one thing the product promises to get right.

## Does the score actually measure the face? (validity check)

Two experiments, both run through the real engine path.

### 1. Does it separate attractive faces from ordinary ones?

27 hand-labelled consensus-attractive faces (models, leading actors) against the
110-person population reference:

```
consensus-attractive  mean 6.94  sd 1.49
notable-for-work      mean 5.59  sd 1.23
separation (Cohen's d) = 0.99
```

Yes — there is a real, large group-level signal. The engine is measuring
something related to attractiveness, not noise.

That number is after fixing a ceiling bug found during this check. `normalizeAgg`
clamped anything above the reference maximum to a single percentile, which
mapped to exactly 7.6 — nine of the twenty-seven attractive faces scored 7.6,
which is the clamp, not a coincidence. It destroyed discrimination in precisely
the range this product's audience cares about. The tails now extrapolate at the
slope of the outer quartile. Separation improved from d=0.81 to d=0.99.

### 2. Does it give the same face the same score twice?

No. This is the finding that matters.

Same person, multiple photographs, score spread:

```
Keanu Reeves      3.7 – 7.9    sd 2.04
Timothée Chalamet 3.7 – 7.7    sd 2.00
Margot Robbie     4.3 – 8.5    sd 1.79
Chris Hemsworth   5.4 – 8.0    sd 1.33
Justin Trudeau    4.0 – 8.2    sd 1.22

pooled within-person SD              1.45
restricted to gate-passing photos    1.37
```

**Within-person noise (1.45) exceeds between-person spread (~1.2.)** For an
individual, the score is currently determined more by which photograph was taken
than by whose face is in it.

Restricting to photos the capture gates would actually accept — yaw ≤10°,
smile ≤0.35 — barely helps (1.37, though on only 5 degrees of freedom). So this
is **not** primarily a pose problem, and tightening the angle requirement will
not fix it.

### What follows from this

- Group-level claims are supportable. Individual scores are not yet.
- A single celebrity score is a statement about one photograph. Henry Cavill at
  5.8 is one image; Hemsworth ranges 5.4–8.0 across three.
- Week-over-week tracking cannot ship until within-person SD is under ~0.4. It is
  currently 1.45, so a "+0.6 this week" readout would be pure photography.
- The reference sets are press photos, most of which the app's own capture gates
  would reject. Numbers derived from them are a floor on quality, not a ceiling.

The controlled capture — 6–8 front shots, one sitting, independent attempts —
is what isolates how much of that 1.45 is the engine versus the photography.

## Stability work: what moved the number, and what did not

### Determinism holds absolutely

Six consecutive scans of the same photo return bit-identical values across all
31 metrics and an identical score. This is guaranteed by construction — there
is no randomness anywhere in the measurement path — and it stays true with
consensus detection added, because the transforms it applies are fixed rather
than sampled.

### Lighting is not the problem

One photo, distorted in the ways a capture session actually varies, with zero
change to the face:

```
brightness +20% / -20%      0.1
low contrast                0.1
cool white balance          0.2
soft focus                  0.2
scale 0.85x / 1.15x         0.1 - 0.3
jpeg quality 50             0.6
warm white balance          0.6
image rotation +-3 degrees  0.8 - 0.9
```

Exposure, contrast, focus and framing scale are already near-irrelevant. The
requirement that lighting must not move the score is, for practical purposes,
already met.

### Rotation was landmark jitter, not a pose failure

Sweeping ±8° of pure in-plane rotation produced scatter, not drift — one
subject read 4.0, 4.9, 4.1, 4.7 at successive angles with no monotone trend. A
systematic pose error would trend. Scatter means the detector is placing
landmarks a pixel or two differently on each resample, and the scoring pipeline
amplifies that for some faces more than others.

`src/engine/consensus.ts` measures each photo under five fixed geometric
transforms, maps every result back to original coordinates and takes the
per-landmark median. Effects:

```
                        before   after
worst-case roll spread    0.9      0.6
within-person SD          1.45     1.32
separation (Cohen's d)    0.99     1.02
```

Modest, real, and it costs four extra detections inside a scan that already
takes two seconds of theatre.

### What did not work

Shrinking the quantile tables toward a fitted normal. The male "overall" table
has bins from 0.0037 to 0.4049 wide — a 109x ratio — so the reasoning was that
a z-shift of four thousandths crossing a whole five-percentile step must be the
amplifier. Regularising it made **both** measures worse: roll spread on one
subject went 0.2 → 0.6 and separation fell from 0.99 to 0.84. The staircase was
carrying real signal. Reverted.

### The honest limit of this analysis

The repeat-photo set is press photography spanning years — different ages,
weights, hairstyles and cameras. Emma Watson's photos cover most of her adult
life. So **1.32 is an upper bound that includes genuine facial change**, and the
earlier claim that "the score is determined more by the photograph than by the
face" was stated more strongly than this data supports.

Nothing available here can separate engine noise from a person actually looking
different. That is precisely what the controlled sitting settles, and it is why
no further stability work is worth doing before it exists: 6-8 front shots, one
sitting, independent attempts, no real change possible in between.

## Fixing the sex scale

Female faces were scoring systematically high — population median 5.80 against
5.50 for men, and Sydney Sweeney reading 9.2. Diagnosis, per sex, on the
population reference:

```
            median score   median shapeZ   median overallZ
male   55        5.50          -0.107          -0.030
female 56        5.80          +0.580          +0.399
```

Male sat at zero, as the quantile tables guarantee by construction. Female was
0.4 sigma high, and the shape descriptor carried nearly all of it.

### The cause was a sex-correlated selection bias

Both reference generators gated on smile. Counting what that rejected:

```
male   : 58 detected, 22 fail smile>0.7  ->  33 usable
female : 59 detected, 45 fail smile>0.7  ->  13 usable
```

Women in press photography smile far more often than men. The thirteen women
who survived were not a sample of women, they were a sample of women who were
not smiling — and the female mean shape built from them sat well below where
real women actually land, putting every female face 0.58 sigma above it.

Both gates now admit smiling faces. The female shape reference goes from 13 to
52 and the quantile reference from 13 to 57. Smiling moves the mouth and jaw
metrics, but barely touches the outline landmarks the shape model uses, and at
n=13 sampling error dwarfs anything a smile does.

### Result, and the cost

```
                     before   after
male median score      5.50     5.10
female median score    5.80     4.95
sex gap                0.30     0.15
median female shapeZ  +0.580   -0.203
separation (Cohen's d) 1.02     0.69
```

The scale is fixed: both sexes now sit near 5.0 and the gap is inside the
noise. **Separation fell from 1.02 to 0.69, and that is a real cost, not a
rounding artifact.**

The reason is visible in the shape model's own output: the attractive top tier
now sits only 0.50 SD (male) and 0.76 SD (female) along the discriminating
axis. That axis is defined by 11 male and 13 female top-tier faces. Having
fixed the small-sample problem at the population end, the same problem is now
the binding constraint at the ideal end.

This is a data problem, not a code problem. The top tier needs to be three or
four times larger before the shape axis can discriminate as sharply as the
biased version appeared to — and "appeared to" is the right phrase, because
some of that d=1.02 was the female inflation itself widening the gap.

## Showing the population curve instead of drawing a bell

The "population position" chart used to be a textbook normal — the same
perfect bell on every tab, for every region, for both sexes, with the subject's
dot placed at `pct/100` along it. It was decoration, and worse, it quietly
contradicted the numbers printed underneath it.

The reference distributions are not normal. `AGG_NORM` already stores 21
empirical quantiles per aggregate, which is a histogram in disguise: each
consecutive pair brackets exactly 5% of the reference set, so that slice's
height is `0.05 / (q[i+1] - q[i])`. The curve is now drawn from those.

What this exposes, which the bell hid:

- **`region:midface` (male) is bimodal.** Two clear modes, not one.
- **`region:nose` (female) is severely left-shifted** — the entire table sits
  below zero, from -2.67 to +1.07. A symmetric bell over that is a fiction.
- **The upper tail is thin, visibly.** On most aggregates the top three or four
  quantiles are spread across as much x-distance as the middle ten. The ticks
  are drawn, so where the sample runs out is now something a user can see
  rather than something buried in this file.

The dot is placed by interpolating the *same* table that scoring interpolates,
so the dot and the percentile printed under it cannot disagree — they are one
lookup.

Two honesty constraints on the chart:

- The shaded middle band is the interquartile range and is labelled as such.
  Shading "the middle" without saying what it is reads as a value judgement.
- Slice heights are smoothed with two [1,2,1] passes. With ~110 faces behind 21
  order statistics, two nearly-coincident quantiles produce a spike that is
  sampling noise. This is smoothing a histogram, which is not the same thing as
  the discarded experiment of shrinking the quantile table toward a fitted
  normal — that changed the *scores* and made both stability and validity
  worse (d 0.99 -> 0.84). This changes only the picture.

Aggregates with no quantile table (side-profile metrics) still fall back to the
idealized bell, since there is no data to draw.

## Skin concerns are declared, never inferred

The scan does not tell anyone what condition they have, and the recommendation
layer no longer needs it to. A quiz card — shown only to people who picked skin
as a goal — asks directly, and the answer routes the over-the-counter cards.

This is not caution for its own sake. It is what the reliability numbers in
"Skin: measured, and deliberately not scored yet" already established: of the
five skin statistics, only `undereyeRatio` (0.532) repeats well enough across
photos of the same person to be worth reporting. `rednessSpread` and
`chromaSpread` reproduce at 0.000 — they measure the room, not the face. An
app that read "you may have rosacea" off a number with zero test-retest
reliability would be inventing a diagnosis, and it would be inventing it from
the lighting.

The competitor pattern — "our scanner has identified that you may have X, true
or false?" — extracts the same answer while taking credit for knowing it. We
ask, and say why we are asking. The declared concerns render in a different
colour from the measured goals on the plan header, with a line stating the
scan did not find them.

Filtering only engages once the question has been answered: a card carrying no
`concerns` is unconditional (sunscreen, "see a pharmacist"), and if someone
skipped the question nothing is filtered at all. Filtering on an unanswered
optional question would silently hide the useful half of the section.

## Typefaces are self-hosted

Fraunces, Inter and IBM Plex Mono came from the Google Fonts CDN via a
render-blocking `<link>`. Three consequences, all bad:

1. On a slow or filtered connection the entire app fell back to system
   defaults, which is what made a carefully set page look like an unstyled
   document.
2. It was the only outbound request on a page whose headline promise is that
   nothing leaves your device.
3. Canvas text (the share card, the demo reel) does not trigger a webfont load
   and does not wait for one, so the shareable artifact — the one thing that
   leaves the device — could go out set in Georgia if the race went the wrong
   way. `renderShareCard` now awaits `document.fonts.ready`.

Now version-pinned via Fontsource and bundled. Only latin subsets are ever
fetched (the packages ship per-script files behind `unicode-range`), and only
upright faces are imported, since every `<em>` in the stylesheet is reset to
`font-style: normal`. Verified: exactly one file loads per family, and the page
makes zero external requests.

Fraunces' `opsz` axis is now set explicitly rather than left on `auto`. Left to
the browser, a 78px score renders at opsz 78 on an axis that runs to 144 — half
way up an axis whose entire purpose is its top end.

## The blur gate was measuring the light, not the lens

Reported symptom: "Hold still — the image is too soft" on every frame, in an
ordinary lit room, with the shutter held shut.

The gate was the mean absolute Laplacian of the face crop, thresholded at 9.
That quantity is proportional to local CONTRAST as well as to focus, so it
cannot separate a dim room from a dirty lens. Measured across 20 portraits
degraded synthetically (`scratchpad/sharp-lab2.mjs`), medians:

```
condition                    old metric     new metric
in focus, well lit               17.5          0.396
in focus, dim  (x0.45)           12.1          0.503
in focus, very dim (x0.28)        7.6          0.503
1.5px blur                       18.5          0.373
3px blur                          9.4          0.244
3px blur + dim                    4.3          0.244
6px blur                          4.9          0.126
```

The old column ranks a **perfectly focused face in a dim room (7.6) BELOW a
genuinely 3px-blurred one in a bright room (9.4)**. With the gate at 9, the
focused-but-dim user is blocked and the actually-blurred user sails through.
Anyone scanning in indoor evening light was stranded.

The replacement asks a question with no brightness term: blur the crop again
and measure how much that changes it. Sharp images lose a lot of neighbour
difference; already-soft ones have little left to lose. The ratio cancels
exposure and contrast exactly — note `dim` and `very dim` both land on 0.503,
and `3px blur` and `3px blur + dim` both on 0.244. That invariance is the whole
point and it is visible in the table.

### Verified against the shipped function, not the lab reimplementation

The thresholds above were chosen from a standalone script that reimplemented
the metric. That validates the formula and says nothing about whether the code
in `captureGuide.ts` computes it — the same gap that produced the front/side
merge bug. Re-run by importing the real `frameStats`:

```
condition      p10    med    p90   med luma   verdict  (WARN 0.28, BLOCK 0.17)
in focus      0.332  0.503  0.602      119    pass
dim  x0.45    0.333  0.503  0.602       53    pass
very dim x.28 0.335  0.503  0.602       33    pass
1.5px blur    0.135  0.373  0.468      119    pass
3px blur      0.057  0.244  0.330      119    warn, shutter open
3px + dim     0.058  0.244  0.330       53    warn, shutter open
6px blur      0.029  0.126  0.245      119    block
```

Brightness invariance holds in the shipped path: all three focused conditions
land on **0.503** across a 3.6x range of exposure. The focused p10 is 0.332,
comfortably clear of the warn threshold, so a well-lit or a dim in-focus face
does not even draw the advisory.

Note the shipped `sharp` (0.503) is higher than the lab's (0.396) while `dim`
matches. The lab measured its `sharp` condition from the source image directly
and every other condition through an intermediate canvas; that extra resample
was softening the comparison. The shipped path puts every condition through the
same route, which is why the focused conditions now agree exactly.

### Why it now warns instead of blocking

Two thresholds: warn below 0.28, hold the shutter only below 0.17.

The justification is that a soft frame is not a wrong measurement. Running the
detector over the same 20 portraits blurred and dimmed, the landmarks barely
move:

```
condition     median centre shift   median scale change   p90 worst landmark
1.5px blur           0.0012                0.0042               0.023
3px blur             0.0021                0.0077               0.039
6px blur             0.0007                0.0093               0.065
dim                  0.0017                0.0027               0.018
very dim             0.0011                0.0024               0.023
```

All as a fraction of face width; no detection was lost in any condition. A 6px
blur — far past anything a webcam produces — moves the face centre by 0.07% of
its width. Refusing to take the photo at all was never proportionate.

This also rules out soft frames as the cause of a separate report of the mesh
sitting low and left of the face. Blur does not move landmarks; something else
does, and `?debug=1` now draws the rectangle the overlay believes the video
occupies so the mapping and the landmarks can be told apart.

## What the live overlay draws, and why it is only two things

The face outline was removed. `FACE_LANDMARKS_FACE_OVAL` is an anatomical
boundary, not the silhouette a person sees: its lower arc follows the underside
of the jaw, so on anyone shot from slightly above it projects well below the
visible chin. On a render verified pixel-perfect against a known 1280x720 feed,
the oval still finished roughly 15% of face height below the chin, onto the
neck. Nothing was wrong and it looked wrong — on the one screen whose job is to
establish that the app can see you, that is the same thing.

The same reasoning removed the boundary landmarks from the dot cloud (they land
on the neck and in front of the ears) and, earlier, the eye and lip contours
(MediaPipe's eye ring follows the orbital rim, not the lid).

What is left: a depth-shaded dot cloud on interior features only, and a thin
crosshair carrying the head's own 3D axes. The nine-chip gate checklist was
also removed from the HUD — it restated what the readiness bar and the one-line
hint already said.

## Why the point cloud looked like random scatter

The overlay drew every Nth landmark. That looks like it should give an even
spread and does the opposite, for two reasons:

- **MediaPipe's indices are ordered by mesh topology, not by position**, and the
  mesh is far denser around the eyes and lips than across the cheeks and
  forehead. A stride inherits that density, so the dots clump on the features
  and leave bare patches everywhere else.
- **Indices are not mirror-paired.** Taking every 8th index picks a different
  pattern on the left of the face than on the right, so the cloud is visibly
  asymmetric on a symmetric face.

`tools/cloud-points.mjs` now picks the subset once, offline: detect 16 faces,
normalise each to a common centre and scale, average into a canonical mesh,
mirror-pair every landmark and symmetrise, then greedy farthest-point sample
with each pick's mirror partner taken alongside it. Resulting nearest-neighbour
spacing across the 64 chosen points, in face widths: **min 0.057, median 0.101,
max 0.146** — a 2.5x spread, against the order-of-magnitude clumping a stride
produces.

The list is fixed, which matters as much as the spacing: every frame draws the
same anatomical points, so the cloud deforms with the face. A per-frame sampler
would reselect different points each frame and shimmer.

Boundary landmarks stay excluded, for the reason in the section above.

### A bug worth remembering

The first run of the generator emitted one point. Cause: the image was released
with `img.src = ""` *before* its intrinsic size was read, so the aspect ratio
became `0/0`, every y-coordinate became NaN, and every `d < bestD` comparison
was false — so the argmin returned -1, every landmark was classified as
unpaired, and the greedy loop terminated after its seed. NaN does not propagate
as an error through comparison-based selection; it propagates as "nothing is
ever better than the current best".

## Merging the front and side scans into one score

Requested: the side profile should not be a separate page with its own number —
both views should combine into one score.

### The obvious implementation is wrong

Pool the metric lists and let the normal aggregation run:
`buildReport([...frontScored, ...sideScored])`. This produces a plausible
number and a meaningless percentile.

`AGG_NORM`'s quantile tables were measured from **front-only** scans of the
reference population. Their entire purpose is that "5.0 = the 50th percentile"
holds by construction rather than by assumption. A front+side aggregate has a
different distribution, so mapping it through a front-only table gives a
percentile with no referent — and the percentile is what the score is.

Fixing that properly means regenerating the tables from front+side scans of all
~110 reference faces. We cannot. Side landmarks are hand-placed by the user,
thirteen points at a time, because a true profile cannot be landmarked
automatically with confidence. That is 1,430 manual placements.

### What is done instead

Combine one level up. The two views' overall aggregates have each already been
mapped through their own normalisation, so both are unit-normal by
construction. Combining two unit-normal variates under a correlation assumption
is exactly what `aggregateZ` already does for pillars, and the result is still
unit-normal — which is the property the scale rests on.

**The first implementation read the wrong field, and it is worth recording.**
`Report.zScores` holds the aggregate BEFORE normalisation — that is its whole
purpose, since `AGG_NORM` is derived from those values. So `zScores.overall`
is not unit-normal, and merging it merged two quantities that were never on a
common scale. It was invisible in the output: the merged score simply looked a
bit low. It surfaced only when the end-to-end test printed the intermediate
z's and the front aggregate read **0.029** where the score of 5.4 implied
**0.308** — an order of magnitude of under-weighting on the view that carries
31 of the 46 metrics. `Report.overallZ` and `RegionScore.z` now carry the
normalised values explicitly, and the two fields are documented against each
other in `types.ts` so the next person does not repeat it.

Verified two ways. Monte Carlo over 400k draws with `corr(front, side) = 0.5`,
confirming the combination preserves the scale:

```
merged z   mean 0.0110   sd 1.0060      (target 0.0000 / 1.0000)
```

And end to end in the browser, against an independent recomputation of the
merge from the exposed intermediates:

```
front normalised z   0.295274      -> front-only score 5.4  (matches display)
side raw z          -7.729783      -> clamped to -2.2
expected merged z   -0.364487
actual   merged z   -0.364487
```

So the merged score is percentile-anchored in exactly the same sense the
front-only score is. The front-only path is untouched — Henry Cavill measures
5.4 before and after.

### The two assumptions, stated plainly

- **W_FRONT 0.75 / W_SIDE 0.25.** Front carries 31 metrics plus a shape
  descriptor averaging ~130 automatically placed landmarks. Side carries 15
  metrics derived from 13 points a person dragged into place by hand. The split
  reflects both how much is measured and how reliably it was located.
- **RHO_VIEWS 0.5.** The two views describe the same skull from different
  angles, so the correlation is clearly neither 0 nor 1. Measuring it needs
  paired front+side scans of the reference set — the same data we do not have.
  0.5 is a deliberate midpoint. Revisit the moment paired data exists.

Note a consequence that is correct but surprising: someone above the median on
*both* views scores higher than their front-only score, because two
partially-independent pieces of evidence pointing the same way are stronger
than one. Someone above on one view and below on the other moves toward the
middle. That is what aggregating evidence is supposed to do, and it is the same
arithmetic the pillar aggregation has always used.

### The side aggregate is clamped

Found by testing, not by reasoning. Feeding the flow a profile photo of a
different person, with the auto-placed points accepted unverified, produced a
side aggregate of **-7.7σ**. Unclamped that dragged the merged score from 5.4
to 4.1.

Thirteen points placed by hand is the least reliable input in the pipeline, and
the only one a user can get wrong by mis-dragging. So it is clamped to the same
±2.2 every per-metric z already uses. A genuinely extreme profile still moves
the score hard — the deliberately-wrong one above still lands 4.6 — but a
mis-placed one cannot bury someone.

Potential cannot go through `aggregateZ` because it is a score, not a z. The
merge combines the HEADROOM each view found — which is what potential actually
reports — and adds it to the merged score.

The headline now always states which views it came from: "OVERALL · FRONT ONLY"
or "OVERALL · FRONT + SIDE". A front scan is a complete measurement of one
plane, and chin projection, jaw angle and facial convexity do not exist in that
plane at all.

## Both views are now required, and the side has its own capture

The flow was front photo -> score -> optionally add a profile. That taught
people the second photo was garnish. It is not: chin projection, jaw angle and
facial convexity have no front-view equivalent at all, so a front-only report
is missing measurements rather than merely having fewer of them.

Now: front photo -> side photo -> one analysis -> one score. No number is shown
between the two.

### The side camera gates on the detector FAILING

The front gates cannot be reused, because the thing they all depend on is
absent: MediaPipe's face mesh needs a roughly frontal face and does not track a
true profile. That absence is the most reliable signal available, so it is used
directly — if the frontal detector can see a face at under 42 degrees of yaw,
the person has not turned far enough, and the shutter stays shut. "No detection"
is the pass condition, which inverts every other gate in the file.

Exposure and focus still gate normally, since `frameStats` needs no landmarks.
Framing cannot be checked at all without them, so the copy states it and the
verification step enforces what actually matters: all thirteen points get
dragged into place by hand regardless.

Verified against a fake camera device fed a front-facing clip: the capture
button stays disabled and the hint reads "Turn to the side".

### Two bugs this surfaced

- **Uploading a photo while the live preview was running crashed**, with
  "Landmarker is in VIDEO mode". Capturing had always torn the camera down
  first; choosing a file never did. Pre-existing, and invisible until a test ran
  with a camera attached — every earlier upload test ran with no device, so the
  preview never started and the mode was never switched.
- **The side HUD's hint drew its title and detail on top of each other.**
  `.face-frame` sets `line-height: 0` so its canvases sit flush, and that
  inherited into the overlaid HUD and collapsed its block children.

## THE SCORE IS NOT VALID YET — measured, and unfixed

Reported: "Chris Hemsworth and Henry Cavill are still rated like 5.6s, whereas
Rihanna was 8.6." Investigated, and the report is correct. This section is the
evidence, written down because the fix is not in yet.

### The 60% component has no discriminating power

`buildReport` blends two things into the overall: the shape descriptor at
`W_SHAPE = 0.6`, and the 31 measured ratios at 0.4. Scoring the whole reference
population (117) and the whole celebrity set (112) through the shipped engine
and measuring Cohen's d, top tier vs reference population:

```
sex      nPop nTop |  shapeZ   ratioZ  overall
male       58   14 |   0.177    1.285    0.892
female     59   14 |   0.656    0.881    1.039
```

**d = 0.177 is nothing**, and it is *in-sample* — those fourteen faces defined
the axis, so this is the flattering case. Out of sample it can only be worse.
The component carrying the majority of the score does not separate attractive
faces from ordinary ones at all for men.

Weighted by measured separation, shape deserves 0.12 (male) and 0.43 (female).
It is shipping at 0.60 for both.

### What that produces

```
top-tier males:   Evans 9.0, Chalamet 8.1, Pattinson 8.1, Pitt 7.8, Gandy 7.7,
                  Jordan 7.3, Cavill 5.4, Bale 5.4, Hemsworth 5.4, Efron 5.3,
                  Barrett 4.8, Lachowski 4.7, Gosling 4.7, O'Pry 3.8
highest scorers:  Chris Evans 9.0, Cillian Murphy 8.4, Chalamet 8.1,
                  Pattinson 8.1, PETE BUTTIGIEG 7.8, Brad Pitt 7.8,
                  Tom Hardy 7.8, STEVE BUSCEMI 7.8
                  Giorgia MELONI 8.8, Kendall Jenner 8.7, Ana de Armas 8.3,
                  Zendaya 8.1, WHOOPI GOLDBERG 8.1
```

Sean O'Pry — one of the most booked male models alive — scores **3.8**. Members
of the ordinary reference population outrank the top tier. The reference
population and the celebrity set have nearly identical medians (5.10 vs 5.40
male, 5.00 vs 5.30 female), which is the same failure stated another way.

It is also why a headline can disagree with its own pillars: Rihanna's overall
(8.4) is higher than all four of her pillars, Cavill's (5.7) lower than three of
his. The pillars feed only the 40% ratio term; the 60% shape term is not shown
anywhere and is what actually moves the number.

### Why the axis is dead

It is one linear direction in ~250-dimensional shape space, fitted from 14
top-tier faces per sex against the population mean, and normalised by the
population's own spread along it (`axisSD`: 0.098 male, 0.050 female — the 2x
difference between sexes is its own problem, since it doubles female z for the
same deviation). Fourteen points cannot locate a direction in that many
dimensions; the axis is fitting noise, and each face's projection is dominated
by whatever idiosyncratic directions the noise picked up.

### The fix, not yet applied

1. Drop `W_SHAPE` toward the measured value (~0.15), or to zero.
2. Regenerate `AGG_NORM` — the quantile tables were built with `W_SHAPE = 0.6`,
   so changing the blend invalidates them. `tools/normalize.mjs` with `TM_DATA`
   pointed at the reference photo set.
3. Re-audit and confirm the top tier separates and no reference-population face
   outranks it.

Until that lands, the number shown to a user is not a measurement of their
face — it is 60% noise. Do not ship this to paying users.

Harness: `scratchpad/score-audit.mjs` (scores both sets) and
`scratchpad/separation.mjs` (computes the table above).

## Next: time-aware deltas, and what the numbers already say about them

Requested: when someone rescans, read the gap between scans and interpret the
change accordingly — two days apart is probably lighting or water retention, two
weeks apart might be real.

The thresholds for this do not need inventing. They are already measured, and
they are the same numbers that make weekly tracking hard:

```
within-person SD across photos    1.32   (repeat photos of the same person)
between-person SD                 1.20   (different people)
```

So the honest bands, before any structural change is claimed:

- **A delta under ~1.3 is inside single-photo noise.** At two days apart it
  should be stated as capture variance outright — lighting, expression, water
  retention, camera. Not hedged: said.
- **Above that, and weeks apart**, it is worth calling a change — but the copy
  still has to name capture as the leading alternative, because 1.32 is an
  upper bound measured on photos spanning years of real ageing, not a floor.
- **Direction matters less than magnitude.** A -0.4 at three days is not a
  decline; it is the same measurement twice.

This is the one place the stability problem becomes a feature rather than a
liability: an app that says "that is noise, ignore it" when its competitors say
"you dropped 0.4, buy our fix" is exactly the positioning. But it only works if
the bands come from the measurement. Hard-coding "2 days = lighting, 2 weeks =
real" without reference to the SD would be the same invention we removed from
the blur gate and the population curve.

`history.ts` already stores scans and computes `daysAgo`, so the data is there.

### The Coach Max profile idea changes the privacy posture

Also raised: Max remembering what someone said they did, building a picture week
over week, asking "you changed this much — what did you do differently?".

That is a good product idea and a completely different security position. Today
the app has no backend, no accounts and no uploads, so there is nothing to
breach. A coach that recalls someone's daily habits across weeks means stored
personal data about minors and adults describing their bodies and routines.

If it gets built: keep it on-device for as long as possible (the profile already
lives in localStorage), and if it must sync, store the CONVERSATION SUMMARY and
the scan numbers — never the photographs. A breach of a face-photo database
ends the company; a breach of a numbers table is an incident.

## Potential can only move 40% of the score

Reported: "I believe my potential is higher than a five" — shown 4.9 -> 5.0.

That ceiling is structural, not a judgement about the face. `analyze()` builds
potential by lifting each fixable metric's `zEff` and re-aggregating:

```ts
report.potential = Math.max(report.overall, buildReport(scored, sex, lift, shapeZ).overall);
```

`shapeZ` is passed through **unchanged**. And the blend is:

```ts
const blended = W_SHAPE * shapeZ + (1 - W_SHAPE) * ratioZ;   // W_SHAPE = 0.6
```

So the lift reaches `ratioZ` only. Sixty per cent of the aggregate is frozen at
its measured value no matter how much every fixable metric improves. Potential
is capped at roughly 40% of the range it should have.

Measured across 111 faces, the potential gap is: mean 0.38, median 0.40, max
1.20. So even the best case in the whole set gains 1.2 points — and a gap of
0.1 sits near the bottom of our own distribution.

Two things follow, and the second is the important one:

1. Whatever weight the shape term ends up with, the potential run must lift it
   too, or leave it out of both runs. Freezing a term in one and not the other
   is not a conservative choice, it is an inconsistent one.
2. **Potential inherits the validity failure above.** It is computed on top of a
   term that separates attractive faces from ordinary ones at d = 0.177. Fixing
   the ceiling before fixing the axis would just produce a confidently wrong
   larger number.

Whether any individual's true ceiling is higher than what is shown is not
answerable from this engine yet, and saying otherwise would be inventing
reassurance. It becomes answerable once the shape term is either fixed with
enough top-tier faces or dropped.

---

# Resolved: the shape weight, measured out of sample

The validity failure above is fixed, and the fix was chosen by measurement
rather than by argument.

The problem with the original evidence was that it was **in-sample**. The top
tier defines the shape axis — the axis IS the vector from the population mean to
their mean — so of course they project high on it. Any separation measured that
way is flattered by an unknown amount.

The honest test is leave-one-out: rebuild the axis with one face removed, then
score that face on an axis it had no hand in choosing. Across the reference set
(50 male / 52 female population, 11 / 13 top tier after gating):

```
                    in-sample    leave-one-out
shapeZ, male          0.477          0.326
shapeZ, female        0.704          0.263
```

The female axis was almost entirely overfit — 0.704 collapsing to 0.263 on
held-out faces. Against `ratioZ` at d = 1.189 / 0.916, the descriptor is the
weaker term by a factor of three to four, not the stronger one.

Sweeping the blend against **held-out** separation:

```
W_SHAPE |  male d  female d  |  pooled
  0.00  |  1.189    0.916   |  1.052
  0.10  |  1.217    0.959   |  1.088
  0.15  |  1.221    0.967   |  1.094   <- best
  0.25  |  1.199    0.947   |  1.073
  0.60  |  0.801    0.586   |  0.693   <- was shipped
```

An earlier sweep using in-sample shape scores put the optimum at 0.25. That was
the same flattery showing up again, one level down. The held-out optimum is
0.15, which is where CALIBRATION.md's original estimate had it before the
in-sample sweep talked it upward.

`W_SHAPE = 0.15`, `AGG_NORM` regenerated. Only the two `overall` rows in that
table change, which is the check that the blend was the only thing touched —
pillar and region normalisation never saw the shape term.

End-to-end, top tier vs reference population:

```
              before    after
male          0.716     1.324
female        1.034     1.052
pooled        0.875     1.188
```

**What is still wrong.** Individual placements remain noisy — Hemsworth 4.7,
O'Pry 4.0, Hadid 4.6 — because each person is one photograph and one photograph
is worth ±1.3. And the reference set produces its own 9.0s at the top, which is
structural: a 58-person reference always contains someone at its own 100th
percentile. Group separation is the claim that holds; individual placement is
not yet.

## Potential: the cap was the weight, not the freeze

`shapeZ` is still passed through unchanged into the potential run, so potential
can only move `1 - W_SHAPE` of the score. That was 40% frozen and is now 15%.

It stays frozen rather than getting lifted, and the reason is measured: across
229 scored faces the descriptor and the ratio composite are very nearly
independent — **r = 0.113 male, 0.019 female** — so the fixable metrics carry
almost no information about where the descriptor sits.

That correlation is BETWEEN people, though, and what potential needs is the
WITHIN-person slope: if one person's fixable metrics improve, how far does their
own outline follow? Different skeletons dominate the between-person variance, so
the two are not the same number and this one cannot stand in for the other.
Answering it needs the same faces measured before and after a real change, which
does not exist yet. Until it does, frozen is the conservative direction, and
overstating a ceiling is the failure mode that makes a potential number
worthless.

## Time-aware deltas: shipped, on the measured bands

`readDelta` in `history.ts`, using 1.32 (within-person SD) as the floor and four
days as the point past which a structural change is even possible:

```
under 1.32                  noise — stated as capture variance outright
over 1.32, under 4 days     still capture; a face does not restructure that fast
over 1.32, 4 days or more   worth attention, capture named as the alternative
```

The top band deliberately stops short of claiming proof, because 1.32 was
measured on repeat photos spanning years of genuine ageing. It is a ceiling on
noise, not a floor.

# Capture: three fixes, each found by looking at the render

## The distance gate was measuring pixels nobody can see

`checkFrame` measured face width as a fraction of the **video** frame, but the
preview is `object-fit: cover`, so a camera whose aspect ratio differs from the
frame's is centre-cropped. On a 16:9 webcam in a square frame only 56% of the
width survives — a face filling 90% of what the user can see reads as 0.25 of
the video and is told "move closer", indefinitely.

Both distance and centring now divide through by the visible fraction. Verified
across four frame/camera combinations; before the fix, two of the four could not
be satisfied at all.

```
case                        visW  silhouette  gate sees  passes
square frame / 16:9 cam    0.563     0.46       0.46      yes
square frame / 4:3 cam     0.750     0.46       0.46      yes
3:4 frame / 16:9 cam       0.422     0.46       0.46      yes
3:4 frame / square cam     0.750     0.46       0.46      yes
```

## The front overlay is a silhouette now

The dot cloud and the adaptive crosshair are gone. The crosshair anchored to the
eye midpoint, which sits about a third of the way down a face, so its horizontal
arm read as a level set far too high. The heading arrow — the one element that
answered a question — stays.

In its place is the Procrustes mean of the reference population the person will
actually be scored against, sized to the midpoint of the distance band, so
fitting the outline and passing the gate are the same act.

The earlier objection to drawing FACE_OVAL still stands and does not apply here:
it looked broken as a **live overlay** because it is an anatomical boundary
rather than the visible silhouette. A fixed target in the frame cannot look like
tracking that has come loose.

Fixing it exposed a bug in the mean face itself: a 60-degree notch in one jaw.
The symmetrizer pairs each point with its nearest mirror and drops any pair that
disagrees — which left exactly two oval landmarks raw, and dropping both halves
of a disagreement is what put the notch there. The oval now takes its pairs from
the ring's own topology: walk both ways from the crown, and step k of one arc
mirrors step k of the other. Mirror residual across all 36 oval points is zero.

## Glasses are calibrated; hats and hoods use an on-device trial model

Horizontal edge energy across the nose bridge, over the same quantity on the
person's own cheek. The ratio is what makes it portable — an absolute edge count
tracks sharpness and contrast far more strongly than eyewear, and would encode
skin tone besides.

Calibrated on 229 reference faces: median 1.53, p90 2.46. At 3.4 it flags eleven,
of which nine are plainly wearing glasses and one or two are not callable from
the photograph. Against a base rate near 8% that is real signal and it is not
clean, so it never blocks the shutter and its wording is conditional — "if
you're wearing glasses". A false positive then costs nothing.

**The hand-built headwear feature was attempted and failed. Do not repeat it this way.** The feature was
the strongest horizontal edge across the forehead, gated on the forehead being
darker than the cheeks. Over the same 229 faces the twenty highest scores were
seventeen people with hair on their forehead and three in headwear, and the
shadow gate did not rescue it: the two clearest hats in the set were lit brightly
enough to make the forehead LIGHTER than the cheeks. It caught one cap and two
fringes. A fringe is far more common than a cap.

The replacement does not use that proxy. `headCovering.ts` lazy-loads Google's
SelfieMulticlass model, whose categories separate hair, face skin, clothes and
accessories, and checks for clothes/accessories immediately above or beside the
face-skin mask. The 16.4 MB model is self-hosted and SHA-256 pinned. This is an
experimental capture gate, not a calibrated classifier: the spatial thresholds
still require a labelled set covering hats, hoods, religious headwear, textured
hair and bald heads before its error rates can be claimed.

# Side profile: the seed was landing on the wall

Two independent bugs, both worth naming because both are easy to write again.

**Facing direction** was decided by comparing pixel mass in the left half of the
FRAME against the right half. That measures where the person is standing, not
which way they are looking. Now decided inside the head's own box, from which
edge wanders more: the back of a skull is a smooth convex curve, while brow,
nose, lips and chin all stick out and cut back in.

**The profile edge** was found by scanning inward from the frame border for the
first "skin-coloured" pixel, on fixed thresholds of `r > 70, r > g, r - b > 12`.
A beige wall passes that, so the scan stopped where it started and the edge came
back as the frame border. The replacement never asks whether a pixel looks like
skin — it asks whether a pixel looks like the BACKGROUND, modelled from the top
corners, which are background in any portrait framing. It is also independent of
skin tone, which `r - b > 12` was not.

The anchor table was in frame fractions, so it was only correct when the head
happened to span 16%–86% of the frame. It is in head fractions now.

Verified on twelve synthetic profiles with known geometry — two backgrounds
including the beige that defeated the old test, both facing directions, three
horizontal offsets: **12/12 correct on facing direction, all 13 points on the
head**. Where the head fills the frame and the corners are hair rather than
background, the trace cannot work and says so, falling back to a centred head
box.

External profile photographs were sought for a real-world set and Wikimedia
returned drawings, mummy portraits and stone heads. The synthetic set tests the
geometry exactly; the background model's behaviour on real backgrounds is still
under-tested, and that is the known gap.

**The gate** passed the moment the detector lost the face, on the first frame —
which is what made the side view easier to shoot than the front, and which also
passed for a hand over the lens or someone stepping out of shot. Passing now
requires having watched the head turn past half the profile angle, then holding
the loss for six frames.

# The quick breakdown page

`quick.html` / `src/quick.ts` — a second entry point, front-only, laid out to be
read at arm's length in a screen recording.

It shares the engine rather than approximating it: same detect, same `analyze`,
same percentile tables. Verified by computing `analyze()` independently on the
main page's module graph and comparing — 4.30 and potential 5.2 on both, exactly.

It does NOT show the same total as the main app, deliberately. The main flow
requires a profile and merges two views; this is front-only, and the page says so
rather than presenting it as the same number.

**It is unlisted, not private.** Nothing links to it, `robots` and `X-Robots-Tag`
ask crawlers away, and that is the whole of it — anyone with the URL can open it.
A client-side gate on a static page is theatre, since the bundle ships to whoever
asks. Real access control means turning on Vercel deployment protection for the
project, or putting it behind a backend.

## The sex vote is wrong often enough to be a product problem

Testing this page on a bearded man in glasses, the shape model returned **female**
and the card printed WOMEN beside his face. That is not a labelling error: every
percentile on the page is computed against whichever reference population it
picked, and switching it moved the same photograph from **4.30 to 6.00** — a
1.7-point swing, larger than the whole within-person noise band.

The main app has the same behaviour and the same exposure. On the quick page the
reference population is therefore shown as a button: one tap re-scores against
the other population. Hiding the label would have hidden a load-bearing fact;
asking up front would have put a demographic question between someone and their
score, which on a page built for filming is the interaction guaranteed to end up
in the clip.

This wants fixing properly at some point — the vote should carry a confidence and
say so when it is close.

# The sex vote does not work, and has been removed

Reported after the quick page printed WOMEN beside a bearded man's face.

Measured against the manifests' own labels, which give 229 faces with a known
sex. In the app the classifier scored **70.7%** — but that model was trained on
these very faces. Rebuilding the mean shapes with each face removed and then
classifying it:

```
leave-one-out accuracy    58.8%   (male 61.9%, female 55.1%)
always say "male"         54.1%   <- base rate of the same sample
```

Four points above a constant answer.

A second decision rule was tried — project onto the between-means axis and
threshold at the midpoint — and it agreed with the first on **194 of 194** faces.
That is not a coincidence: nearest-centroid under Euclidean distance IS that
threshold. The two were one classifier wearing two names, so there is no better
rule waiting to be found over this descriptor. The descriptor does not carry
the information.

**Why it mattered enough to remove rather than tolerate.** Every percentile in a
report comes from the chosen reference population. Switching it moves the
overall score by:

```
median 0.70    p90 2.10    max 4.50
```

Kim Kardashian scores 7.7 against women and 4.0 against men. Michael B. Jordan
scores 7.6 against men and 4.4 against women — and the vote had him as female.
A coin flip was deciding a number larger than the entire within-person noise
band of 1.32.

`detectSex` is deleted. The reference population is asked for on the capture
screen, remembered on the device, and changeable from the results screen — where
changing it re-runs both views and the merge, not just the label. That reverses
the earlier decision to infer rather than ask, and the only reason for the
reversal is that the inference was finally measured.

One note for whoever tests this: a profile far off the bottom of the scale
displays the same floored score under either population, so checking the side
CARD is not a check that the profile was re-scored. The aggregate underneath it
moves (-5.08 male vs -3.64 female on the test profile); the card is floored.

## Hats and hoods, second attempt: texture. Also failed.

The first attempt used edges and shadow and caught fringes. The second tested
the obvious follow-up — hair has strand detail at a fine scale, fabric is a
broad flat field — as high-frequency energy in the band above the hairline over
the same quantity on the person's own cheek. Against 229 bare heads and 9
portraits in caps, berets and military headwear:

```
crownTexture     Cohen's d 0.405
best threshold   3% precision at 67% recall
                 173 bare heads flagged to catch 6 hats
```

Colour spread looked much better at d = -0.630, and that number is a trap worth
recording: the headwear portraits obtainable were largely historical monochrome,
which has almost no chroma by construction. It was measuring the age of the
photograph.

**What would actually work is a segmentation model, not a hand-built feature.**
MediaPipe ships an `ImageSegmenter` inside the bundle already loaded here, and
Google publishes a multiclass selfie model whose classes include hair and
clothes separately — a hood is clothes where hair should be, which states the
question directly instead of proxying it. The cost is the download:

```
selfie_multiclass_256x256 (hair + clothes + skin)   16 MB
hair_segmenter (hair vs not-hair)                  781 KB
face_landmarker (already loaded)                   3.7 MB
```

The cheap one cannot tell a bald head from a covered one, and flagging bald
users is a worse failure than the fringe problem it would replace. The product
decision is now taken in favour of coverage: the 16 MB multiclass model loads
only after the cheaper photo gates pass, rather than on page load. Its accuracy
gate and mobile-latency benchmark remain open; see
`docs/SKIN_ANALYSIS_TRIAL.md`.

## Glasses now hold the shutter, with a way past

Full view of the face is a requirement, so the advisory became a block — but on
a measure with roughly six-in-seven precision, a single threshold cannot do both
jobs. Two thresholds, the same shape as the blur gate:

```
>= 3.4   advisory, conditional wording, never blocks     11 of 229 (4.8%)
>= 4.3   holds the shutter                                7 of 229 (3.1%)
```

Of the seven above 4.3, six are plainly wearing glasses and one cannot be called
from the photograph. That last one is why the block is always escapable: a wrong
hint costs a glance, but a wrong block costs someone the use of the app with no
way to comply, because there is nothing on their face to remove. The capture
screen shows "I'm not wearing glasses" only while that block is what is stopping
them. Requiring removal and stranding people are different things.

## The reel generator's scan sequence

The quick page now plays three stages instead of showing a card: a scan line
down the full-bleed photo, then the landmark reveal, then the photo shrinks to
the top of the screen while the score cards drop out of the space it vacates,
staggered into reading order.

It is sequenced in script rather than as one CSS animation because the middle
stage is a canvas reveal that has to be started and awaited — and because it has
to be skippable. Switching reference population re-scores and re-renders, and
replaying the theatre on every toggle would be unwatchable, so only the first
render after a scan animates.

The photo collapses by `max-height`, not by `transform`. A scaled element keeps
its layout box, so the cards would have slid underneath it rather than following
it up the screen.

Verified by sampling the sequence at four points and asserting the ORDER, not
just the end state: scan line running and no dots at 0.7s, dots painted by 3.1s,
photo shrunk from 597px to 317px and cards at full opacity by 5.4s.
