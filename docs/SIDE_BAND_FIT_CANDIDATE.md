# Side-scale calibration candidate

## Implemented and deliberately offline

`side-band-fit-v1` is an executable, versioned comparison model. It is **not
enabled in the customer report, scoring merge, scan flow, or exports**. Front
scoring is unchanged. `analyzeSide` still uses the existing side mapping; its
measurement-to-report portion is now callable as `scoreSideMeasurements` so
the same code can be replayed without a camera, detector, or network request.

This distinction is a release requirement, not a claim that the production
ceiling is fixed. Removing a mathematical ceiling and establishing a defensible
attractiveness scale are different problems.

## Root cause

All ten active side measurements use tolerance bands. Their legacy effective
z-scores flatten inside those bands. The maximum value depends on the assumed
mass outside each band and is often close to zero. There is no measured
`side:` aggregate quantile table. The fallback divides an aggregate by an
assumed spread but does not correct its centre or account for its finite upper
support. It therefore cannot span the intended range even with every metric
at its own ideal: the full-side maximum is 5.2 for the men reference group and
5.1 for the women reference group.

No competitor output or attractiveness label is needed to reproduce that
invariant failure. Conversely, point annotations cannot determine what a 6,
7, or 8 should mean as an attractiveness rating.

## Candidate definition

The candidate reuses the engine's existing `conformance` reading. Each supported,
plausible metric contributes a value between zero and one. It is one inside
the declared band and falls continuously as the value moves beyond either
edge. The existing ideal values, tolerances, plausibility bounds, and falloff
are not changed.

For a fully observed side profile:

```text
metric weight = declared metric weight × existing reliability weight
overall weight = metric weight × existing pillar share
band fit = 10 × sum(overall weight × conformance) / sum(overall weight)
```

The pillar shares remain Harmony 0.35, Angularity 0.25, Dimorphism 0.20, and
Features 0.20. Region and pillar fits use their own constituent metric weights.
Side reliability values are existing seeds, not newly measured repeat-photo
reliabilities. Reusing them does not establish their accuracy.

Ten means all the supported readings are inside this model's current bands.
It does **not** mean maximum attractiveness, a rare face, medical normality,
an achievable personal outcome, or a score comparable with the front report.
Many ordinary profiles can have high band fit. This is why direct replacement
of the public headline score is blocked.

No free scaling coefficient or intercept is fitted. The placement pilot,
its blank ratings, external overall totals, and the engine's own scores are
not training labels or a population norm. No ethnicity is inferred or used.

## Missing evidence and invalid measurements

The full score is absent unless all expected weighted metrics are observed and
plausible. A missing or rejected metric is neither a zero nor an ideal value.
The denominator of the full score is never reduced to increase the result.

For incomplete input the output contains:

- Observed-subset fit, explicitly not a full-side score.
- Weighted coverage and measured/expected metric counts.
- A possible score interval formed by assigning each unknown conformance a
  value between zero and one. This is a coverage bound, **not** a statistical
  confidence interval.

The six experimental side constructions remain excluded. Empty input produces
no score, zero coverage, and a possible interval of zero to ten.

## No false population or merge semantics

The candidate returns a separate `SideBandFit` type, not `Report`. Its population
percentile is explicitly null. It has no effective z-score, potential score,
rarity output, or front-plus-side merge. Calling the existing merge through an
unsafe cast still fails its finite-z guard instead of inventing a combined
percentile. Do not add a cast or derive a z-score from the fit to bypass this.

## Private replay

Run against an all-capture diagnostic export, not the fitting corpus or copied
text report:

```sh
node --import tsx tools/evaluate-side-band-fit.ts \
  --input /absolute/path/to/capture-diagnostics.json \
  --out .calibration-pilot/reviews/side-band-fit-run.json
```

The tool:

- Requires confirmed side points and an explicit, consistent reference group.
- Rejects duplicate image fingerprints rather than silently choosing a row.
- Allows an already-adjudicated duplicate to be excluded explicitly with
  `--exclude-row CAPTURE_ID`; every excluded ID must exist.
- Records the input digest, definition digest, executable implementation digest
  with its numeric-dependency file digests, version, exclusions, and scope.
- Ignores all rating fields, irrespective of their recorded source.
- Recomputes automatic and reviewed measurements, legacy side scores, and
  candidate fit separately, while retaining integrity warnings.
- Replays legacy front-plus-side effects against the frozen saved front
  report; it never merges the candidate fit.
- Rejects input files larger than 30 MB before parsing.
- Refuses to overwrite a source or an existing result, and requires an output
  inside the repository's existing, gitignored `.calibration-pilot` directory.
  A symlinked private root, ancestor, or output file is rejected before any
  directory creation, and checked again before writing. New output files are
  owner-readable/writable only (mode 0600). Photos, raw captures, and private
  annotations remain outside the public repository.

It retains entered reference IDs without claiming that labels are correct.
For a fingerprint-reconciled selection, the exported
`evaluateCaptureDiagnostics` function can consume the in-memory selected data
from the placement evaluation tool. Keep that selection audit alongside the
result. Neither path changes browser captures or the source export.

## Release gates

Before replacing any live side or combined attractiveness score:

1. Freeze the landmark definitions and adjudicate ambiguous geometry. A
   measurement-definition change requires new applicability checks for its
   reference band, not only a new score transform.
2. Decide whether the customer-facing number describes band fit or an
   attractiveness estimate. These are not interchangeable semantics.
3. For an attractiveness estimate, obtain independent, appropriately scoped
   evaluation labels across the intended range. Front-only, side-only, combined,
   and external totals must not be mixed. Two external overall values do not
   identify this mapping.
4. Validate on identities not used to choose the mapping, and use repeat
   photographs to test stability. The inspected synthetic placement pilot is
   development evidence, not an independent population test.
5. Establish how side contributes to the combined report. A fit score must not
   be treated as an already-normalized population variable. Population
   percentiles require a suitable reference dataset and a separately validated
   mapping; this candidate supplies neither.
6. Version the release and retain original saved scores so historical scans do
   not silently change meaning.

## Automated checks

The focused tests exercise ideal vectors, monotonic deterioration on both sides
of every band, flat tolerance regions, invalid and missing evidence, scaling
and mirroring invariance, unchanged front outputs, unchanged legacy side and
merge paths, duplicate rejection, rating independence, and immutable inputs:

```sh
npx tsx --test src/engine/sideBandFit.test.ts
```

These checks establish computational properties. They are not a validation of
attractiveness, clinical measurements, or generalization to real-world users.
