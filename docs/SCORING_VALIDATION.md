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
