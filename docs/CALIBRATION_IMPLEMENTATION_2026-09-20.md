# Calibration implementation, 20 September 2026

Status: implemented and evaluated locally. Nothing in this change automatically
replaces the public placement detector, score mapping or population percentiles.
The completed private collection is sufficient for this development pass; do not
ask the owner to repeat the bulk point reviews.

## Delivered

- [Capture safeguards](CALIBRATION_CAPTURE_SAFEGUARDS.md): anonymous filename ID
  suggestions, duplicate/photo-pair/reference-group warnings, explicit intentional
  exception confirmation, immutable saved records and diagnostic-only exceptions.
- [Cloud diagnostics](SIDE_CLOUD_DIAGNOSTICS_2026-09-20.md): prospective fixed
  failure codes instead of an undifferentiated unavailable result. No additional
  uploads, permission expansion or automatic retry spend.
- An offline placement-calibration tool, `tools/calibrate-side-placement.mjs`,
  with an explicit input-selection manifest and person-held-out evaluation.
- [Side scoring candidate](SIDE_BAND_FIT_CANDIDATE.md): reproducible legacy replay
  and an interpretable band-fit candidate that cannot silently become an
  attractiveness rating, percentile or front/side merged report.
- Existing local score-scope fixes remain: absent ratings are allowed, external
  totals remain comparison context, and a side/combined/unknown label never
  enters the front-only fitter.

## Placement experiment contract

Version: `side-owner-residual-development-v1`. This experiment estimates median
operator-minus-device residuals for seven previously problematic landmarks:
hairline, chin front, chin bottom, neck, jaw corner, hinge surface proxy and ear
notch. Brow, nose and lip positions remain unchanged. Mesh and segmentation are
fitted separately, with at least six training identities per method.

The local frame uses the automatic brow ridge and nose base, including its scale
and facing direction. Held-out reviewed coordinates are never runtime features.
One complete identity is withheld from each fit. All output errors remain in the
denominator, including unchanged and rejected predictions. Assistant annotations
are secondary comparison targets only; they are never fitted targets.

Required input checks:

1. Raw export and frozen independent annotations are bound by SHA-256.
2. Every raw row is explicitly selected or excluded with a reason; duplicate
   identities cannot leak across folds. Save-order row IDs are not corpus IDs.
3. Original image bytes, dimensions and displayed RGBA frame must match exactly.
   No crop, scale or mirror transform is guessed.
4. Confirmed reviews, matching guide versions, automatic facing direction and
   complete finite coordinates are required. Pool only one captured build.
5. The recorded local seed must equal the original displayed automatic points;
   template recovery, cloud fusion and unknown provenance are not local detector
   observations and must be evaluated separately.

The selection manifest changes only the in-memory analysis copy. Neither raw
exports nor frozen annotations nor browser records are rewritten. Outputs use
exclusive creation in the ignored private directory, with symlink redirects
refused. Fitted parameters and coordinates must not be committed.

Example, using privately supplied paths:

```sh
node tools/calibrate-side-placement.mjs \
  /private/frozen-annotations.json /private/raw-export.json \
  /private/explicit-selection.json /private/original-images \
  .calibration-pilot/reviews/placement-experiment.json
npm run test:placement-pilot
```

## Interpretation and release gates

These previously inspected synthetic identities are development evidence, not an
untouched population test. Agreement with a person's corrections is not an
anatomical accuracy percentage, and low-confidence or occluded landmarks remain
ambiguous. Owner annotations were made with automatic seeds visible.

The residual candidate learns systematic offsets in an image-scaled frame, not
visual recognition of anatomical structures. It remains offline even if average
agreement improves. Before activation, test an image-conditioned improvement or
explicitly limited seed correction on fresh identities and varied captures,
including facing direction, pose, lighting, framing and occlusion. Compare tails,
manual correction burden and ambiguous-point handling, not just mean distance.

The side scale has a separately reproduced ceiling under its current all-band
fallback. A weighted band-fit score is a useful diagnostic, but is not its live
replacement. Activation of an attractiveness mapping needs properly scoped side
targets and independent validation. Two external overall ratings do not identify
the side scale, metric weights or an external provider's private formula.

Cloud availability remains operationally unconfirmed. The older generic exports
cannot establish the cause of each failure. Check account configuration/credit,
then perform one consented synthetic smoke capture with the new diagnostics
before any cloud-assisted batch. Do not repeat the human annotation collection
to diagnose this.

## Verification

The desktop/mobile capture flow and calibration save/export controls have been
tested with isolated browser fixtures. Provider behavior is covered with mocked
responses, not live paid inference. The production bundle must not import either
experimental scoring or the placement fit.

Final local checks: 2,282 application tests passed, zero failed, with 28 existing
skips and one existing TODO. All 48 placement comparator/calibrator checks
passed. TypeScript and the production build passed. Both desktop and mobile
capture and calibration warning/save/export browser checks passed. A bundle
inspection found no experimental placement/scoring version strings. Existing
optional runtime source-map and large lazy 3D chunk warnings remain; they did not
fail the build or the tested capture flow. No live cloud-provider check, push,
merge or deployment was performed.
