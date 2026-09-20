# First paired pilot review

Status: local UX/reporting fixes, with scoring defects identified but not yet corrected. Nothing in this review establishes a percentage-accuracy claim. No scoring ideals, weights or production detector have been fitted from these two identities.

## Evidence actually reviewed

The four September 20 recordings are readable: 08:45:38 is the male FaceIQ walkthrough; 08:51:56 is the female FaceIQ walkthrough; 08:57:44 is female TrueMax; 09:01:48 is male TrueMax. Review used interval frames across each recording and selected native-resolution frames for exact readings. Both 09:11 and 09:14 dual-view MP4 exports were inspected. All six files have video but no audio stream. This is not an exhaustive frame-by-frame transcription or an instrumented comparison of both apps' frame rates.

The two saved TrueMax captures were exported through the owner's existing calibration page, without changing or rescanning either record. Both contain 478 front landmarks, 13 automatic and 13 final side landmarks, dimensions, image fingerprints, guide version, scoring references and operator confirmation. File hashes match the supplied pilot images. The owner's `w01` is the `f01` image pair, not a third identity. The alias is retained in private review notes.

The original records mistakenly mark the entered scores as self-sourced. The owner explicitly identified them as FaceIQ totals. Private review notes record that source clarification; the original rows are preserved. They must not be used as independent human ratings. The new scope guard excludes legacy unknown-scope rows from front-score fitting.

## The headlines hide a side-score discrepancy

| Identity | FaceIQ total | FaceIQ Harmony front | FaceIQ Harmony side | TrueMax front | TrueMax reviewed side | TrueMax combined |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| m01 | 6.2 | 5.44 | 7.77 | 6.7 | 4.2 | 6.0 |
| w01 / f01 | 5.8 | 6.67 | 8.31 | 6.3 | 4.3 | 5.8 |

FaceIQ's front/side figures above belong to Harmony, not all-factor attractiveness. Its final total also includes Angularity, Dimorphism and Features. TrueMax's similarly named pillars are currently largely geometric proxies, not equivalent assessments. Matching the two overall totals therefore does not validate either system or establish cross-system score equivalence.

The old calibration summary compared the entered total with the front score and called a difference below 0.6 agreement. It now distinguishes the selected rating scope and shows frozen front, side and combined scores. Another app's total is context, not an automatically aligned target. See [the scope audit](CALIBRATION_SCORE_SCOPE_2026-09-20.md).

## Independent scoring defect

With all ten active side metrics present, giving every metric its own ideal value produces only **5.2 for men and 5.1 for women** in the current scorer. All ten are two-sided band metrics. Their best-ranking plateaus and the missing side aggregate normalization prevent the full side report from reaching the high end of the advertised scale. This is an algebraic upper bound for the full metric set, not a claim that any face can simultaneously attain all ideals. Subsets can behave differently.

This defect exists without reference to FaceIQ. Better point placement cannot remove it. `tools/side-score-ceiling-audit.mjs` reproduces it against the production functions in an isolated local browser. Do not mask it with a fixed score uplift or fit dozens of parameters to two faces. A reviewed scoring-scale change is still required.

## Are the ideal measurements different?

Sometimes, but there are three separate issues: landmark construction, preferred ranges, and the meaning of a displayed score.

Selected male recording observations, with TrueMax's reviewed calibration measurements:

| Metric | FaceIQ value / displayed ideal / metric score | TrueMax value / displayed band / metric score | Interpretation |
| --- | --- | --- | --- |
| Gonial angle, 1:49 | 126.2° / 115–121° / 7.4 | 125.8° / 114.1–123.9° / 5.0 | Values differ by 0.4° and bands overlap; scores have different semantics. Surface construction still needs endpoint review. |
| Nasolabial angle, 2:13 | 98.4° / 85–102° / 10.0 | 99.3° / 89.3–100.7° / 5.0 | Both measurements are within their displayed bands. A metric-fit score of 10 is not a person's overall score of 10. |
| Glabella facial convexity, 2:15 | 170.9° / 168–173° / 10.0 | 173.2° / 166.5–173.5° / 5.2 | Substantial band overlap, distinct measurement positions and score scales. |
| Nasofrontal angle, 2:10 | 120.2° / 113–125° / 10.0 | 133.3° / 125.1–134.9° / 5.1 | A 13.1° value discrepancy requires a construction/point audit before a range change. |

In the female recording at 1:56, FaceIQ's nasofrontal value is 134.5° with a displayed 139–151° ideal; TrueMax's reviewed value is 143.6° with a 129.1–138.9° band. At 2:12, FaceIQ total convexity is 144.1° with a 142–149° ideal, versus TrueMax 145.4° with a 134.8–143.2° band. These are observations of this configuration, not universal standards.

Other apparent discrepancies are unit or endpoint mismatches. Mouth:nose versus nose:mouth reverses a ratio. Brow-arch versus brow-tail tilt uses different endpoints. Lip offsets in estimated millimetres are not interchangeable with TrueMax's face-height-normalized percentages. A population mean in a directional metric is not its preferred target. Keep mappings unconfirmed until these distinctions are resolved.

The recordings support comparing a small number of visible examples. They do not justify recovering or copying proprietary scoring formulas, weights or datasets. Changes to TrueMax must have their own declared scoring meaning and validation.

## Point correction findings

- Both profiles retained the same automatic gonial angle, 117.457752°, before review. That repeat is consistent with the known local jaw-template construction; it is not evidence of identical anatomy.
- Both captures record `cloud-unavailable`. These test the local fallback plus the operator's corrections, not a successful cloud refinement. The warning alone does not prove whether the cause was billing, authentication, timeout or another service failure. The prior confirmed API-credit issue should be checked before evaluating cloud-reader accuracy.
- The largest corrections were hairline (about 107 px and 150 px in 1254 px images), ear reference, jaw corner and chin/neck. These are correction distances against this operator's annotation, not expert error measurements.
- The male jaw angle changed from 117.5° to 125.8°; female from 117.5° to 116.6°. Small changes to one angle can coexist with substantial point movement.
- Both saved directions are image-right. The screenshot's highlighted choice was correct, so not pressing either direction button was fine.
- Collection retains the evidence needed to test a new reader. Saving corrections does not automatically train it. Improvements must be evaluated on identities not used to tune the reader, with ambiguous landmarks adjudicated separately.

## Product lessons and implemented local fixes

The strongest FaceIQ presentation lessons are a stable large photo, a clear active measurement, predictable next/previous controls, and a separation between the measurement definition and what the result means. The sampled recordings also show loading reference panels and briefly stale overlays during rapid navigation; presentation is not proof of clinical validity.

Local changes in this pass:

1. Uploaded/pasted front photos skip the redundant keep/retake question. Camera captures retain it. Photo validation and side-landmark review remain.
2. Side detail navigation crosses categories; general detail navigation traverses the report. Pillar-specific decks stay scoped.
3. Celebrity comparison cards show larger actual reference portraits, stored reference values, attribution and an explicit unavailable-photo state. No user landmarks are drawn on a celebrity portrait. A portrait may differ from the source photo used for a stored measurement.
4. Direction controls say **Nose faces left/right**, explain screen direction and retain the correct inferred default.
5. Calibration records separate rating scope and frozen per-view scores. Old records are not silently reinterpreted or rewritten.
6. Side explanations no longer imply that a jaw angle proves leanness, that nasal projection is normalized to nose length, or that the lower-third distance ratio measures forward facial volume.
7. Measurement cards and rows now lead with reference-fit meaning. An in-range measurement does not look poor merely because its internal model score is near five. The unchanged model score is secondary and is not presented as a validated population rank. This is a presentation correction, not a new scoring model.
8. A first rating added after an unrated result cannot enter the independent front-fitting corpus through the typo-correction action. Existing genuinely mistyped ratings retain their source; original saved rows are not migrated.

## More measurements and appearance assessment

TrueMax currently exposes 33 front and 10 active side geometric metrics. The FaceIQ recordings show 33-item front and side decks. Its current [Harmony documentation](https://www.faceiqlabs.com/support/harmony) likewise distinguishes contributing measurements from supporting guides. The biggest coverage gap is the side profile, not simply the number of front mesh points.

Recommended stages:

1. **Scoring semantics and side scale first.** Separate reference fit, aggregate model score and any future validated population rank. Fix the full-side compression, version the score, test monotonicity/limits and report unvalidated rank estimates honestly. Do not use a FaceIQ total as a front geometry label.
2. **Improve the reader against saved corrections.** Preserve raw local/cloud/fused outputs, diagnose fallback causes, evaluate correction burden by landmark and test held-out identities. Do not apply one person's coordinate offset to every face.
3. **Add a small research-only geometry set.** Nasion-based convexity, nasofacial/nasomental angles and normalized lip-reference distances are candidates using existing points. Check exact constructions and correlated double counting before including them in a score. Mentolabial and under-chin/neck tangent measurements need additional visible landmarks and new guides. The six already-held-out side constructions must not be enabled just to increase the count.
4. **Assess visible definition separately.** Jaw outline geometry does not measure the fat covering it. FaceIQ describes a vision-based assessment of visible definition, not a direct body-fat sensor. Lighting, pose and tissue appearance affect that assessment. TrueMax should use a separately validated, uncertainty-aware appearance module rather than infer fat from a favourable angle. [FaceIQ Angularity documentation](https://www.faceiqlabs.com/support/angularity).
5. **Cosmetic skin observations, not diagnoses.** Visible redness, uneven tone, spots and creases can be an opt-in assessment with capture-quality checks and user correction. Rosacea, acne and other conditions can look similar; a photo-only score should not be presented as their diagnosis. [American Academy of Dermatology](https://www.aad.org/public/diseases/acne/really-acne/acne-rosacea).

Current FaceIQ documentation says selected gender and ethnicity can alter ideal ranges. Preserve the benchmark's selected settings rather than assuming they do nothing. This does not authorize inferring ethnicity from photographs or adding ethnicity-specific TrueMax scoring. [FaceIQ FAQ](https://www.faceiqlabs.com/support/faq).

## What the owner should do next

1. The first two TrueMax captures are verified and need not be repeated. Their full diagnostic export has been obtained. Keep browser data and original images until all reviews are backed up.
2. Continue side-point corrections for the remaining 18 paired identities. Use the calibration route, not a duplicate ordinary TrueMax scan. Save front + side under the file's identity (`m02`, `f02`, etc.), review all 13 points, leave the inferred nose direction alone if correct, and export the set periodically.
3. If entering a FaceIQ total, mark it as another app's total. It is also fine to leave the rating blank when collecting point corrections.
4. Pause a large paid FaceIQ batch. The existing pair already exposes actionable defects. After the side-scale work, collect a small next checkpoint of two additional men and two women using the same source images, with Harmony front, Harmony side, Harmony combined and overall kept distinct. Save per-metric value/range screenshots for discrepancies and the selected benchmark settings. No full walkthrough recording is needed per face.
5. Keep remaining identities aside for evaluation before using their labels for tuning. The 20 synthetic pairs are an engineering pilot, not a population-standard or clinical-validation dataset.

## Verification and release status

Full-path verification exposed the front-versus-combined display mismatch and checked real saved capture provenance, rather than relying on a successful screen or test alone.

- Integrated test suite: 2,211 passed, zero failures, 28 skipped and one todo (2,240 total).
- Production build and TypeScript checks passed. The existing large 3D-runtime chunk warning remains.
- Isolated desktop/mobile browser checks passed for upload/paste confirmation flow, side-direction controls, real calibration form/save/export handlers, cross-category measurement navigation, actual reference portrait loading and unavailable-photo fallback, and the in-range 99.3-degree nasolabial regression with its unchanged 5.0 model score.
- Rapid navigation and reduced-motion checks passed without renderer errors. These are local functional checks, not a quantified comparison of performance against FaceIQ or proof of low-end-device performance.
- Physical camera capture was not exercised; camera confirmation is covered by source/lifecycle tests.
- Local edits only. No commit, push, merge, production release, score fit or detector training was performed in this pass.
