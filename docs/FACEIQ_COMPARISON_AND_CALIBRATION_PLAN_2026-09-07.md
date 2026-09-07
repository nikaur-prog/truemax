# FaceIQ comparison and TrueMax calibration plan

Date: 7 September 2026. Status: proposed, not a completed benchmark. Earliest proposed start: 9 September, after the owner's usage reset. No automation has been scheduled, subscription credits spent, faces uploaded or scoring parameters changed for this plan.

## Decision

Use FaceIQ Labs as a product benchmark and source of testable discrepancies, not as photographic ground truth or proof of objective attractiveness. The owner should not need to invent a 0 to 10 attractiveness label for each face. Separate landmark annotation, geometric measurement validation and perceived-appearance evaluation.

Matching another product is not the same as improving accuracy. A bad jaw point can be made to produce a familiar score by changing the scoring curve while the underlying defect remains. Fix inputs before fitting score mappings. We have not established that FaceIQ is the most independently validated system in the market.

## Permission and source boundaries

FaceIQ's current terms, dated 13 August 2026, restrict automated access without permission and reverse engineering. They require consent for uploaded faces and prohibit uploading minors. They also describe scores as informational, not objective beauty assessments, and warn that inaccurate landmark placement affects results. Obtain explicit permission covering the proposed competitive benchmark, permitted automation, exports and any use of outputs for calibration before that part of the study. A subscription alone does not resolve those permissions. [FaceIQ terms](https://www.faceiqlabs.com/terms).

Use ordinary authorized screens and exports. Do not extract private algorithms, copy implementation code, bypass quotas or reconstruct proprietary score curves through systematic probing. If permission is declined, continue independent annotation and TrueMax validation; the project does not depend on access to a competitor's internals.

Photos require both source-image rights and the depicted adult's permission for each service and research use. A Google image result or a celebrity photograph is not a consent record. Keep images, identifiers, reports and coordinates in a private owner-controlled workspace, not Git, public screenshots or analytics. Document storage, withdrawal and deletion responsibilities before collection. [FaceIQ privacy](https://www.faceiqlabs.com/privacy).

Suggested request to FaceIQ, not sent:

> I operate TrueMax and would like written permission for a limited comparative evaluation of facial measurements using consenting adult participants. We propose a 10-person pilot, potentially expanding to 50 or 100 people, with paired front and side photographs. Please confirm whether normal UI automation, report export, private per-metric comparisons and using permitted results to evaluate or calibrate our own scoring are allowed, and what credit limits, attribution, data-retention or licensing conditions apply. We will not extract your source code, bypass restrictions or redistribute your reports.

## Confirmed TrueMax issues to resolve first

These are source findings and synthetic/mock reproductions, not a completed live accuracy study. Detailed evidence and ownership are in [the side-placement audit](SIDE_PLACEMENT_EVALUATION_PLAN_2026-09-07.md).

1. Guests receive device placement, not a cloud prediction. The cloud endpoint requires authentication. Keep guest and signed-in cohorts separate.
2. Final fusion currently permits cloud movement for only two ear-adjacent points. The other eleven retain device positions, including refined jaw and chin coordinates. A provider switch alone cannot change those outputs.
3. All failed crop reads can return unchanged seed coordinates as apparent agreement. Preserve per-point provenance; no observed refinement must mean fallback, not corroboration.
4. The harness can use encoded instead of upright dimensions for rotated phone JPEGs. Correct EXIF geometry before interpreting errors.
5. Benchmark the actual seed, image preparation, deadline and final fusion, including failures. Unlimited-time raw provider output is a different experiment.
6. `calibrationSet.ts` uses the front-only catalogue for side coverage/count checks. A stored side measurement can therefore report zero side faces. Fix and regression-test this before cohort collection.
7. `benchmark-agreement.mjs` accepts a missing definition confirmation. Require an explicitly approved mapping. Use degrees or normalized absolute units near zero, not unstable percentage error.
8. The existing 25-per-group calibration health threshold is a collection heuristic, not evidence of validation. Its copy must not imply that count alone justifies fitting metric directions.

Claude owns the API and vision-harness repairs. Codex owns capture/report integration and can build the collection and comparison UI after scope and file ownership are confirmed. No calibration, fusion or scoring changes are included in the current UI/SEO/Max release merely because this plan exists.

## Stage 1: inventory before spending credits

Inspect the owner's permitted existing reports before generating any new ones. Record which features are available under the subscription and which actions consume credits. The public harmony reports already expose per-ratio values and front/side summaries, but public examples do not establish the private algorithm or the accuracy of automatic placement. [Example public report](https://www.faceiqlabs.com/celebs-wiki/iris-law/harmony).

Produce a feature matrix covering capture instructions, automatic points, manual correction, front/side/combined reports, metric explanations, score distributions, history, plan, simulation/morph, exports, mobile navigation and loading/retry states. Label every finding as observed, measured, inferred or inaccessible. Compare automatic results before correction, then corrected results separately. Do not credit automatic placement for a hand-corrected report.

The output is an original requirements list: useful explanations or measurements we can independently implement, existing TrueMax advantages, concrete defects and features to omit. More metrics are not automatically better; retain a new metric only if it has a reproducible visible definition, evidence-backed interpretation and useful non-duplicate information.

## Stage 2: 10-person pilot

Recruit five adult participants for each of the two supported reference groups, with one front and one side photograph of each person. The group is explicitly provided, not inferred from the photograph. This is workflow development, not population calibration.

- Use real, consented paired photographs for the primary study. Include varied adult ages, skin tones, facial proportions and ordinary phone conditions without claiming subgroup representativeness from ten people.
- Front: neutral expression, level head, even light and visible required features. Side: true profile, level head, visible ear, forehead and chin. Record camera/distance and any cropping or mirroring.
- Do not silently discard difficult but valid photos. Separate correctable capture failures from visible-landmark prediction failures.
- Two pilot participants provide two additional capture pairs each, in separate capture sessions. These measure ordinary recapture variation.
- Repeat the identical files for two pilot participants, to separate inference variability from recapture variability.
- AI-generated portraits may be a separate stress-test set. They cannot establish real population norms; separately generated front and side faces must not be assumed to have consistent anatomy.

Budget: 10 baseline pair submissions + 4 extra capture-pair submissions + 2 identical-file repeats = at most 16 paired analyses per system for this pilot. If FaceIQ bills front and side separately, that may be 32 billable units instead. Check the actual credit rules before approving a hard cap. No top-up or subscription change is automatic.

Stop the pilot if coordinate transforms are unknown, matched definitions cannot be established, permission is unresolved, a required metric is inaccessible or report collection is unreliable. Fix the workflow before buying more results.

## Stage 3: expand only after the pilot

The owner's proposed 25 men and 25 women with both views is 50 people and 100 photographs, not 100 independent people. Count people, not images or landmarks, when splitting and estimating uncertainty.

Recommended evaluation-first option: use the pilot to repair engineering defects, freeze TrueMax, then recruit 50 new people, 25 per reference group, as a held-out evaluation cohort. Do not repeatedly tune on this same cohort and keep calling it held-out. If a scoring change needs fitting, use a separate development cohort and preserve the evaluation set.

If the total budget only allows 50 people, preassign 30 development, 10 validation and 10 untouched test people, balanced by reference group. The pilot participants belong only to development. This supports a limited diagnostic experiment, not strong population-percentile, fairness or rare-tail claims. If expanding to 100 people total, use a preregistered 60/20/20 split. All captures, crops and synthetic variants of one identity stay in the same split.

For a 50-person baseline plus two additional capture pairs from ten people and five identical-file repeats, plan up to 75 paired submissions, or up to 150 units if each view is billed separately. Do not add this pilot budget again when its participants are included in those 50. Dollar cost remains unquoted until the actual account's billing units and available credits are checked.

## What to record

| Record | Required information |
| --- | --- |
| Capture | Pseudonymous person/pair ID, consent reference, adult eligibility, declared reference group, image hashes, upright dimensions, EXIF/mirror/crop transforms, capture conditions, session/repeat ID and frozen split |
| Placement | Device seed, raw refinement, final fused points, source/provenance per point, timeout/fallback outcome, correction time and independently annotated visible points |
| Measurement | System/build/date, view, metric ID/label, displayed value/unit/precision, landmark definition, angle or ratio construction, sign and normalization, missing/excluded reason and evidence reference |
| Score | Front/side/combined scope, raw product score, score kind, range/precision, explicitly supplied percentile, region/pillar definition and correction/override state |
| Review | Annotator ID, independent first pass, adjudication, visibility/ambiguity and approved definition mapping |

Use a metric mapping registry with `exact`, `unit-converted`, `definition-mismatch` and `unconfirmed`. Only explicitly approved first two mappings enter measurement-agreement statistics. Missing FaceIQ detail is recorded as unavailable, not guessed.

Build a separate owner-only comparison workspace with three modes: **Place points**, **Compare measurements**, and **Review scores**. Saving a point annotation or a competitor report must not require an attractiveness rating. Show source labels permanently, keep human-panel judgments separate from external product scores, and provide export/import validation plus an audit trail for corrections. Reuse the existing owner access control rather than adding a browser-only flag.

## Metric definitions that must not be conflated

TrueMax currently has 33 front and 10 scored side measurements. Initial candidates include eye separation, canthal tilt, jaw-to-cheek width, lip-height ratio, facial convexity and nasolabial angle, only after endpoint verification.

| Comparison trap | Required treatment |
| --- | --- |
| Percentage versus fraction | Convert only when numerator and denominator match |
| Eye height/width versus width/height | Verify bilateral components; reciprocal of a mean is not generally the mean of reciprocals |
| Generic face width/height versus TrueMax `fwhr` | Confirm the exact vertical endpoints; names alone are not a match |
| Hairline thirds versus mesh-top estimates | Different anatomical definitions; do not fit them as equivalent |
| Soft-tissue jaw angle versus skeletal angle | Different measurements; a photograph does not expose the bone landmark |
| E-line millimetres versus normalized distances | No absolute millimetres from an unscaled photo; require a valid physical scale or retain normalized units |
| Nasal projection versus Goode's ratio | Confirm construction and denominator rather than equating the labels |
| Two scores both labelled /10 | Preserve as separate product outputs; they need not measure the same statistic |

## Three evaluation tracks

### A. Landmark accuracy

Two trained annotators independently place visible landmarks using one written definition set, blinded to both products' scores and points. Adjudicate disagreements. An obscured or non-visible point is marked unobservable rather than forced. Report annotator disagreement alongside model error.

For each final point report median, 90th/95th percentile error, gross-miss rate and correction burden. Normalize coordinates using a preregistered stable reference length and retain pixel errors at a standardized resolution. Cluster uncertainty by person. Report left/right, capture quality, guest/device and consented-cloud paths separately. Do not let a better mean hide a worse tail at the jaw or chin.

Only after fixing the delivery defects compare the current cloud provider with an OpenAI candidate using the same authorized inputs and end-to-end budget. Include timeouts, cost and fallback frequency. Precise localization remains a stated limitation of general vision systems; no provider win is established here. [OpenAI vision limitations](https://developers.openai.com/api/docs/guides/images-vision), [Anthropic vision guidance](https://platform.claude.com/docs/en/build-with-claude/vision).

### B. Measurement correctness and stability

Evaluate against the independently annotated geometry, not a competitor score. Use absolute angular/ratio errors, signed bias and agreement plots. Test roll correction, EXIF rotation, aspect ratio, mirror/sign conventions and sensitivity to small point shifts. Identical input should be deterministic where the engine is deterministic; recapture noise must be measured separately.

Prioritize measurements that heavily influence the headline. If a measure is not repeatable or its landmarks are unobservable, exclude it or display its limitation instead of hiding the problem with an attractiveness-score adjustment.

### C. Score meaning and perceived realism

FaceIQ scores are benchmark observations. Do not put them into the existing blind-human-rating export; its provenance safeguards correctly exclude external/revised labels. Do not fit an arbitrary offset just to make the headlines agree.

The owner need not supply personal 0 to 10 ratings. If we want evidence that rankings look reasonable to people, use several independent adult raters with consented images, randomized presentation and a blinded pairwise question such as which image better matches the declared presentation criterion. Record ties and uncertainty. Prefer a defined construct, such as perceived presentation or measured proportional conformance, rather than claiming universal attractiveness. Panel composition and agreement must be reported.

Fit only a small, preregistered calibration model justified by the data. Fifty people are not enough to freely fit 43 directions, weights and ideal ranges per group. Current front/side aggregation, shape contributions and population-rank transforms should be audited separately. Keep score versioning so an algorithm update is never presented as personal improvement.

## Release gates and outputs

Before candidate tuning, write numeric error tolerances per metric based on annotation disagreement, repeat-capture variability and the score change a user would notice. Freeze them before looking at candidate test results. Do not invent a universal pixel threshold or promise every point will be correct.

Release only when:

1. No known coordinate-frame or false-corroboration defect remains; the production-matched harness reproduces the displayed flow.
2. Final-point median error improves for intended targets, and tail/gross-miss behavior does not worsen beyond the preregistered allowance.
3. Matched geometry is within its declared tolerance, and exclusions/missing data are handled honestly.
4. Score stability and blinded panel agreement do not regress on untouched people. FaceIQ agreement is reported separately.
5. Latency, correction burden, mobile completion and timeout rates meet their agreed budgets.
6. Reference coverage is sufficient for the claim being shipped. A pilot cannot justify population percentiles or clinical-validation claims.

Deliver: private capture manifest; definition registry; reproducible anonymized comparison report; worst-case overlay review; product/UX matrix; ranked fixes; versioned candidate calibration; tests; release verdict and rollback plan. Publish only an appropriately de-identified methodological summary approved for disclosure.

## Morph follow-through

Use the benchmark to improve point placement, measurement definitions, comparison UI and recapture stability. It cannot establish that a routine will move a face to a particular coordinate or that a generated preview is achievable.

For TrueMax's goal markers, white can represent the current measurement and green a justified target interval, with capture uncertainty shown separately. Targets must relate to an actually changeable, supported presentation goal, not the competitor's maximum score. Fixed skeletal proportions must not be moved by a non-surgical routine. Do not diagnose skin disease or body fat from a generic face score.

Award any progress credit only for comparable repeated captures and change beyond the measured noise band, with caps and reversal handling. Habit completion can earn separate points. An AI-generated preview or a scoring-version change never earns improvement points. Goal feasibility, image identity preservation and safe skin-treatment guidance need their own validation, separate from this benchmark.

## Suggested work split after approval

- **Claude:** repair seeded refinement provenance/claim handling and orientation/deadline/cache validity in the vision harness; provide production-matched outcomes and a provider adapter; do not change score norms yet.
- **Codex:** repair owner calibration coverage/definition gates; build capture manifest, matched-metric comparison and independent annotation review; conduct permitted product/UI audit; implement release-approved display and scoring changes with tests.
- **Owner:** obtain FaceIQ permission, approve the actual credit cap, provide/recruit consented adult paired photos and choose the scoring construct. No passwords, private keys or participant photos go into a public PR.

This is a staged measurement-and-calibration programme, not a promise that copying market-familiar numbers will make TrueMax objectively correct.
