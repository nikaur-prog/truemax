# Calibration comparison scope

Follow-up: the complete private placement collection has now been evaluated.
See [calibration implementation](CALIBRATION_IMPLEMENTATION_2026-09-20.md) and
the [offline side-band-fit candidate](SIDE_BAND_FIT_CANDIDATE.md). Neither
candidate has replaced the production score mapping.

## Bug corrected

The saved calibration verdict previously displayed the primary report's score,
which is the front report when both views exist. Its diagnostic text and dual-view
video used the merged report. The same saved capture could therefore display two
different headline scores without explaining why.

The verdict and saved-set comparison now use an explicitly selected rating target:
front only, side only, front + side, or another app's total. Current saves snapshot
the individual view scores and merged score. Every available view is shown on the
verdict. An external total is labelled context only because it can include other
factors. Numerical agreement is not reported as proof of accuracy.

The original `scored` field keeps its primary/front meaning for compatibility.
`captureScores` and `ratingTarget` are additive. Existing rows are not rewritten;
missing scope is shown as unknown and has no comparison difference. Their photos,
landmarks, ratings and original diagnostics are retained.

## Fitting boundary

The existing `tools/fit-scale.ts` predicts `scoreFrontMeasurements`, not a merged
or skin-inclusive total. The browser's fitting-corpus export now requires a
self-sourced, explicitly front-only rating with a finite front measurement.
Combined, side, external and unknown-target ratings remain in the private
diagnostic export and are not silently converted into front labels.

This does not ban external benchmarking. Such observations can be retained and
mapped to definitions and scopes in a separate comparison dataset. They do not
become independent human labels. No live formula, reference distribution,
landmark detector or weight is changed by this fix or by saving a capture.

## Collection guidance

- Preserve existing captures and export **all capture diagnostics** before
  clearing browser data. The plain text summary does not replace the JSON's
  original and reviewed coordinates, image fingerprints and capture provenance.
- Use the same anonymous identity and exact images when comparing systems.
- Record the external total separately from its front, side and category scores.
  Per-metric values need units and the actual landmark construction, not just a
  similar label.
- A new side review retains automatic and final points. This collects evidence
  for a future detector change; it does not automatically train the detector.
- Two identities can reveal capture, display and definition bugs. They cannot
  establish a scoring curve, per-metric targets, repeat-photo stability or a
  percentage-accuracy claim. Keep a held-out set when an actual fit is proposed.

## Current coverage, not a promise of validated accuracy

The registry contains 33 front metrics and 10 active side metrics. Six additional
side constructions are held out because the current landmarks, norms or pose
dependence do not support scoring: ramus-to-mandible ratio, mandibular plane,
submental cervical angle, chin projection, forehead slope and midface depth.

The existing soft-tissue presentation uses outline ratios and angles, not body-fat
percentage or a separation of bone, fat, fluid and muscle. Existing skin-pattern
code is a trial image heuristic for visible spots, marks, redness and uneven
pigment. It is not a validated diagnosis of acne, rosacea, scars or wrinkles.
More displayed measurements alone do not establish better accuracy.

## Separate scoring defect: full-side ceiling

A read-only audit of the current production scoring functions puts all ten
active side metrics exactly at their own declared ideals. Every conformance
value is 1.0, yet the full-side overall is only **5.2 for men and 5.1 for women**.
Individual ideal-valued metric scores range from 4.9 to 5.4 for men and 4.8 to
5.2 for women. These synthetic measurement vectors establish an upper bound
with all ten metrics present, not a claim that one real face can attain every
ideal simultaneously.

All active side metrics use two-sided bands. Their best possible `zEff` is a
plateau set by the assumed fraction of the reference distribution outside the
tolerance band, often close to zero. There are no `side:` aggregate quantile
tables. The fallback scales the raw aggregate by an assumed standard deviation
but does not correct the all-band distribution's centre or upper support.
Consequently, perfect point placement cannot make the current full-side score
reach the high end of the advertised scale.

This problem exists independently of any competitor. It needs a separate,
reviewed scoring-model change and validation, not an arbitrary score uplift or
a replacement of measured angles with competitor values. The current change
does **not** modify that formula. Reproduce against a local Vite dev server:

```sh
node tools/side-score-ceiling-audit.mjs http://127.0.0.1:4193
```

The audit exposes private scoring functions only inside its isolated test
browser, blocks external/API requests and never changes production source,
stored captures, weights or reference tables.

## Verification

Unit and source-contract tests cover matched-view comparison, context-only totals,
unknown legacy scope, missing views, zero/unrated values, independent front-only
export eligibility, and persistence of frozen view scores. The isolated browser
fixture exercises the desktop/mobile form and local save/export without account,
inference or third-party requests. The supplied paired captures are now available
for development replay; independent generalization and scoring validation remain
separate release checks.
