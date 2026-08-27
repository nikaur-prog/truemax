# Scoring validation gate

Updated 19 August 2026.

## Decision

FaceIQ Labs is a useful **product and presentation benchmark**, not a ground
truth dataset. TrueMax must not copy, scrape or reverse-engineer a competitor's
private rating formula. Browser developer tools can show code and data that a
site intentionally sends to the browser; they cannot prove the validity of a
server-side model, and they must not be used to bypass plan restrictions or
other access controls.

The lawful, durable route is to validate TrueMax's own fixed measurement
definitions against consented human judgements and repeated photographs. A
competitor score can be recorded as one comparison column in an evaluation,
but it must never become the label TrueMax is trained to reproduce.

## What the repository currently proves

- The reference distributions contain structural measurements, not licensed
  attractiveness labels.
- The only rated calibration corpus contains 19 AI-generated faces: nine men
  and ten women. Its test explicitly says the sample is small and synthetic.
- In leave-one-out evaluation, the female subset clears the current `r >= .6`
  guard, while the male subset is documented at about `r = -.1`. The male
  headline score is therefore not validated out of sample.
- The front and side reference sets are not paired. The combined headline uses
  a 75/25 front/side weight and an assumed `r = .5` correlation. Those are
  product assumptions, not measured calibration values.
- Existing repeated-photo audits show about 1.32 points of within-person spread
  and roughly four-point ranges for some heavily photographed public figures.
  A decimal headline cannot be treated as precise while capture variation is
  that large.
- A percentile and an attractiveness score are different quantities. `95th
  percentile` must never be displayed as `95/100`, and `7.1/10` must not be
  silently converted to either one.

The current score is suitable for internal product testing. It is not ready to
be sold as a validated estimate of attractiveness.

## Required study

1. Freeze the landmark recipes, metric definitions and capture protocol before
   collecting labels. A later geometry change creates a new model version.
2. Recruit consenting adults across sex, age and skin-tone groups. Collect at
   least two standardized front photographs and two profiles per identity so
   repeatability can be measured separately from between-person ranking.
3. Obtain several independent ratings per identity. Use a written rubric and
   record rater agreement; one founder's score is not a target variable.
4. Split train, validation and test sets **by identity**, never by photograph.
   Two photographs of the same person must not cross the split.
5. Fit front weights on the training set. Fit side weights only after a paired
   side dataset exists. Do not tune on the final test set.
6. Report rank correlation, absolute error, calibration, repeated-photo error,
   subgroup error and confidence intervals. Publish failure cases as well as
   the headline result.
7. Version the model and retain the evaluation report that belongs to each
   released version.

Suggested release gates (product decisions, not universal scientific laws):

- held-out Spearman correlation with the panel consensus `>= .65` overall;
- no supported sex subgroup below `.55`;
- median same-person absolute difference `<= .5/10` under the capture protocol;
- 90th-percentile same-person difference `<= 1.0/10`;
- subgroup mean absolute error within `.3` points of the overall error; and
- a side score contributes to the headline only after it passes those gates on
  its own paired holdout set.

Until then, the UI should describe the result as an experimental measurement
profile, use broad bands rather than false decimal precision, and keep the
profile result separate from the front headline.

## How many rated faces, and what each one buys

Written down because "collect more faces" is not an instruction anybody can act
on, and because the honest answer is smaller than it sounds.

Measured on the current corpus (19 faces) with a Fisher-z interval, holding r at
its present value and varying only n:

| n | 95% CI on r | width |
|---|---|---|
| 19 (today) | 0.40 – 0.89 | **0.49** |
| 39 | 0.53 – 0.85 | 0.32 |
| 69 (+50) | 0.59 – 0.82 | **0.23** |
| 119 | 0.62 – 0.80 | 0.18 |

**Fifty front faces halves the uncertainty. They do not raise r.** What they buy
is the ability to tell whether a change helped, which at n=19 is impossible: the
interval spans "good" and "mediocre" at the same time. Nine men alone sit at
[0.12, 0.94], which is no information at all.

Returns fall off sharply past ~70. Another fifty on top buys 0.05. Fifty is the
right number; a hundred is not twice as good.

**Fifty SIDE faces are worth more, because side coverage is zero.** Not thin —
zero. Every side ideal in `sideMetrics.ts` is a prior recentred on five profiles
of one person, and the comment above `ALL_SIDE_METRICS` says so. Fifty corrected
profiles moves the side half of the product from guess to measurement. That is
conditional on the landmarks being hand-corrected: fifty uncorrected profiles
are fifty measurements of where an auto-seeder guessed.

### What no number of rated faces fixes

1. **The soft-tissue class.** Three of the four pillars in the product we
   benchmark against are vision judgements of skin and soft tissue we take no
   measurement for. Their geometry-only figure for one face was 6.54 against a
   headline of 8.3 — roughly 1.8 points that is a missing measurement class, not
   a mis-fitted weight. Rated faces cannot create a measurement.
2. **Test-retest reliability**, weighted mean 0.351 across the front metrics.
   That is a property of the measurement, not of the corpus. One face has scored
   8.0, 7.5, 7.4 and 5.4 across four photographs. Multi-frame capture is the fix
   and is not yet confirmed end to end.
3. **Construction bugs.** jawFrontalAngle reads about 26 degrees off a second
   product on two people; browTilt measures to the brow tail where the
   comparison measures to the peak; fwhr reads high in a direction its own
   denominator cannot explain. Those are code, not data.

So a fifty-and-fifty run makes the system MEASURABLE rather than automatically
accurate. The accuracy comes from acting on what it then reveals — which is
still the right order, because none of the three items above can be prioritised
against each other while the interval is half a point wide.

## Safe FaceIQ comparison

Use a small, licensed or consented benchmark suite to compare observable
outputs:

- metric coverage and definitions;
- repeated-photo stability;
- rank agreement with the independent human panel;
- handling of pose, blur and missing landmarks; and
- explanation quality and presentation.

Do not fit TrueMax to FaceIQ's answers. If both products disagree with the
human holdout, neither answer becomes correct because the other product is
popular.

## Rundown run-through

The current social rundown is intentionally compact:

1. **Hook** — full-face photograph; `FACE ANALYSIS` types on.
2. **Measurement** — camera eases toward the relevant feature; a bright mint
   line draws on the face; one label such as `+POSITIVE TILT` types in; the
   landing click fires when the line completes.
3. **Context cut** — a different source image fills the frame with a short
   `MEASURED` cue.
4. **Verdict card** — photograph repositions upward and the score grid settles
   beneath it in one motion.
5. **Population position** — the distribution curve and marker land with one
   pop rather than another narrated caption block.
6. **CTA** — `YOUR TURN` and `truemax.app` close the video.

That is the visual system to verify in a real phone export before deployment:
face-filling crops, no stretched photographs, readable lines inside TikTok's
safe area, aligned key/click sounds, and no repeated full-sentence captions.

## What the reference set scores, and what "Top 5% of men" therefore means

Run the current pipeline over its own reference photographs — 113 men and 129
women from `.calib/pop-scans.json`, through `scoreFrontMeasurements` — and it
scores them:

|        | min | p25 | median | p75 | p95 | max | mean | share ≥ 7.0 |
|--------|-----|-----|--------|-----|-----|-----|------|-------------|
| male   | 3.4 | 3.7 | **3.8**| 4.2 | 5.1 | 6.1 | 4.02 | 0.0% |
| female | 3.4 | 3.6 | **4.0**| 4.4 | 5.2 | 6.0 | 4.09 | 0.0% |

Nobody in the reference set reaches 7.0. One man and one woman clear 6.0.

This is by design and it is worth stating plainly, because it is the single
most misread thing about the scale. `CENTRE = 0.87` deliberately puts the
reference median **below** 5.0: the reference faces are people notable for
their work, mostly middle-aged, and these metrics read youthful structure as
better, so "the median of our reference photographs" and "what a person calls
average" are two different claims. Only the second is the claim the product
makes. A reference face landing at 3.8 is that correction working, not a bug.

The consequence is the part that needs saying on screen. A user at 7.2 is not
"top 5% of men" in the plain sense that sentence carries. They are far clear of
a reference set of middle-aged notable people, converted onto a human scale by
`SHRINK` and `CENTRE`, **both fitted on nineteen rated faces**. The ordering is
sound; the population noun is doing more work than the evidence supports.
`scaleNote.ts` now discloses the set's composition alongside its size — the
size was already disclosed, and size was never the misleading part.

### What more reference faces would and would not fix

Recomputing the tables from the corpus on disk reproduces the shipped
`AGG_NORM` region tables to within 0.02 (most under 0.001), so the tables are
current and there is nothing to regenerate. Adding people would:

- **help** the tail resolution — `TAIL_Z_MAX = 2.6` is `probit(1 - 1/2n)` at
  n ≈ 113, so a bigger set is the only thing that lets the top of the scale
  separate further;
- **help** the composition problem directly, if the people added are closer to
  the user base in age — that is the live half of #51;
- **not help** the "0.1 z moves 13 percentile points" sensitivity, which is not
  a defect at all. The aggregate is a weighted mean of ~33 correlated metrics
  and therefore has an sd near 0.38, not 1.0 (recovered from the tables' own
  IQR; implied inter-metric correlation 0.102 male, 0.036 female). A tenth of a
  raw z is a quarter of that sd, so a ~10-point percentile move is arithmetic,
  not oversensitivity. More faces would smooth the quantile gaps; they would
  not widen a statistic that is narrow because averaging makes it narrow;
- **not help** the nose or any other region whose measurements do not
  reproduce. Reliability is a property of the measurement, not of the sample
  size — ten thousand more men would reproduce the same flat top.

## Field evidence: the side reads far too harsh at the top

Two scans run by the owner on 2026-08-27, on faces he independently rated as
attractive (the profile he put at "8 to 8.5"):

| | overall | front | side |
|---|---|---|---|
| subject A | 4.2 | 4.1 | 4.3 |

The front number carries a stated confound and is not evidence either way: the
report itself printed `Head is 15° off level` and the capture was taken at
night under a hard overhead source. Pose correction reduces that damage, it
does not remove it, and jaw and chin both read low from a lifted head.

**The side number is the finding.** A profile that a human reader places near
the top decile landing at 4.3 — "about 75% of male profiles score higher" — is
the sharpest available evidence for what #58 already claims from the fixture
pairings: the side ideals are wrong, not the landmarks. The chain behind it:

1. `AGG_NORM` holds **zero** side entries. `analyzeSide` therefore lands in the
   no-table branch of `normalizeAgg`, which converts a raw aggregate z straight
   to a display z through `SHRINK / aggSd(weights)`. That branch is honest about
   spread but it has no idea where the population centre is, because nothing has
   ever measured it.
2. Every side ideal in `sideMetrics.ts` is a prior recentred on five profiles.
   A band whose centre is off by half a population sd costs roughly a point of
   score for a face sitting at the true optimum — and costs it *most* at the top,
   because the band penalises distance from the assumed centre in both
   directions.
3. Every side reliability is the 0.50 seed default (#54). That number is not a
   measurement; no repeat-photo corpus has ever been run through these
   constructions.

What this does NOT justify is moving a constant. Shifting the side output up
until this one profile reads 8 would centre the scale on a single face, which
is the same mistake as the five-profile recentring that produced the current
ideals — one sample smaller. The fix is the one already written down: fifty
side faces measured through these constructions, then real quantiles.

Until then the honest disclosure is the one the report already makes — the side
is capped at 25% of the overall and labelled as thirteen hand-placed points.
