# FaceIQ / TrueMax recording audit

Date: 9 September 2026. Scope: the owner's four supplied desktop recordings and accompanying screenshots. This is an evidence review, not a completed calibration study or an independent validation of either product.

## Evidence and limits

Recording aliases: **R1** TrueMax Rihanna, **R2** TrueMax Justin Bieber, **R3** FaceIQ Rihanna, **R4** FaceIQ Justin Bieber. Timestamps below are relative to each recording. Review used contact sheets, OCR sampled every two seconds, and selected full-resolution frames. R4's gonial result was additionally checked at 03:13.9. We did not transcribe every word, inspect every frame, measure animation frame rates, or audit Max's actual spoken output. Temporary review material is in `/tmp/truemax-recording-audit-5CqevN`; the original recordings remain the source of record. Images and private reports are not copied into Git.

The report recordings demonstrate outputs after interaction, not a controlled comparison of untouched automatic predictions. Placement history, identical source-file hashes, exact cropping and manual edits have not been established for every pair. Rihanna's profile photo is smiling and oblique, with partial jaw/neck occlusion. Its acceptance by an app does not make it a valid neutral-profile accuracy reference.

## Findings that matter most

1. **The problem is not just low headline ratings.** Some coordinates/angles differ materially, while other similarly named metrics use different constructions. Fixing the score curve without first checking points and definitions can make a wrong measurement look more believable.
2. **FaceIQ explains one measurement at a time more coherently.** Its stable photo/detail modal, previous/next controls, item index, visible value and target band make the result easier to inspect. TrueMax already has useful on-photo geometry, but the explanation and controls are fragmented across more cards and repeated empty comparison panels.
3. **Reliability must govern the narrative.** The supplied TrueMax diagnostic gives some measurements zero or very low reliability. Those values must not become confident statements about a person's anatomy, strengths or shortcomings. A frontal jaw proxy must not be described as a side gonial angle.
4. **More visible detail is not automatically more validated science.** FaceIQ mixes physical ratios/angles with subjective feature assessments. Some of its own explanations contradict the displayed assessment; copying those outputs indiscriminately would import new errors.

## Concrete measurement discrepancies

These are observations, not approved mappings. A /10 metric score is a product output, not a physical unit or a population percentile.

| Subject / metric | TrueMax observation | FaceIQ observation | Interpretation / next check |
| --- | --- | --- | --- |
| Rihanna, side gonial angle | R1 02:20: **136.2°**, metric score **3.2/10** | R3 01:48: **125.1°**, **9.7/10**; displayed ideal **118–124°** | **11.1° numerical gap.** Overlay both reviewed landmark constructions on the same upright image. Do not correct it by adding points to the score. |
| Justin, side gonial angle | R2 01:52: **117.0°**, **5.4/10** | R4 03:13.9: **120.2°**, **10.0/10**; ideal **115–121°** | **3.2° gap**, with a much larger difference in score interpretation. Neither observation establishes the correct skeletal angle. |
| Rihanna, nasofrontal angle | R1 00:54: **139.5°**, **4.8/10** | R3 01:44: **133.2°**, **9.4/10**; ideal **136–148°** | **6.3° gap.** Confirm brow/nose endpoints and whether the method uses point-to-point rays or contour tangents. |
| Rihanna, nasolabial angle | R1 00:54: **135.6°**, **2.1/10** | R3 01:30: **76.4°**, **4.3/10**; ideal **89–106°** | **59.2° numerical gap is not an established anatomical error.** TrueMax uses nose-tip/base/upper-lip points; a columella/upper-lip tangent construction is different. Smile and viewing angle further compromise comparison. |

The two FaceIQ gonial ideal bands differ in these reports. Preserve each report's supplied reference settings; this does not reveal the full reference-group algorithm or justify inferring ethnicity from appearance.

**Do not mix score scopes.** R1 00:00 shows a TrueMax front+side overall of **5.3**, front **6.3**, side **3.6**, against women. R3 00:00 shows FaceIQ **Harmony** front **8.41**, side **4.26**, combined **6.82**. Harmony is not FaceIQ's entire overall rating. The separately supplied creator diagnostic for Rihanna says **men**, so its **6.0** front score is not the same run/reference choice. R2 00:00 shows TrueMax overall **5.1**, front **5.3**, side **4.7**; R4 00:00 shows **Features 7.33**, not an overall result. These cannot support a universal score offset.

## UX and copy: what to adopt, retain and avoid

**Adopt the information hierarchy, not the wording.** FaceIQ's gonial modal at R3 01:48 and R4 03:13.9 keeps the photo, two relevant rays/angle arc, current value, reference interval, explanation and navigation together. Give TrueMax each metric the same short sequence: what is measured; what this photo shows; reliability/limitation; optional next action. Keep detailed methodology behind an expansion.

**Polish targeted geometry.** Use clean high-contrast lines, a legible value badge, minimal relevant landmarks, and a clear selected state. Keep the value and geometry synchronized. Use short transitions with reduced-motion support, cancel prior overlay work on rapid navigation, and keep layout stable. The samples support a visual-design advantage, not a measured claim that FaceIQ renders faster or has a particular animation duration.

**Remove punitive and repeated empty states.** At R2 01:52, TrueMax repeats comparison cards that explain why no flattering comparison was earned. This occupies valuable desktop width, creates mobile length, and reads judgmentally. Hide an unavailable comparison; show a limitation only where it changes interpretation. R1 01:48–01:52 also repeats lengthy nose-methodology disclaimers. One concise limitation is more useful than repeated defenses of the scoring system.

**Retain TrueMax's honest exclusions and user control.** R1 01:34–01:36 distinguishes an unavailable forehead reading from scored measurements. The supplied side-flow screenshots show retake, manual correction and front-only exits. Those are good capabilities; the button layout is not. Group one main confirmation, one editing action, then quiet retake/front-only alternatives. Show the side-photo example and benefit before opt-in; teach its capture only after opt-in. This avoids teaching an optional task before the user decides to do it.

**Do not copy contradictory certainty.** At R3 02:16, FaceIQ's chin-definition assessment is **7.8/10** and describes good definition, yet a separate warning describes inadequate definition. Template warnings must be conditional on the actual supported finding. At R4 00:04 and 00:34, feature reference panels display loading counters; richer panels also need useful loading/failure states. A rating such as chin definition or eyelid appearance is not equivalent to an angle measured in degrees.

**Max needs evidence-linked language.** Prefer a specific observation plus limitation and next step, without canned praise, repeated disclaimers or invented aesthetic diagnoses. Example: “This photo does not show the jaw corner clearly enough for a dependable angle. A level, side-on retake will help.” Do not let an LLM repair uncertain measurements by supplying a confident story. The recordings do not demonstrate improved Max speech; that requires separate output review.

## Additional measurements: feasibility before volume

- **Lower-cost candidates:** bilateral eye-length/aspect differences, brow length relative to face width, and separate vertical/horizontal mouth or jaw asymmetry. R4 00:24–00:26 exposes useful component breakdowns. Some constituent TrueMax measurements already exist; expose and test them before inventing extra scored categories. Normalize distances to a declared visible reference, and test pose sensitivity.
- **Requires better visible landmarks and definitions:** actual hairline-based thirds, upper-forehead slope, ear protrusion, columella/upper-lip tangents and a repeatable jaw-contour construction. These need explicit visibility checks, reviewed annotation, and new tests. An obscured ear or hairline cannot be recovered merely by adding a point.
- **Useful side-point experiments:** validate the existing jaw corner/chin/ear points first; compare contour-tangent annotation against the current three-point jaw proxy. For a genuine nasolabial tangent measure, evaluate a visible columella point plus a defined upper-lip tangent. For forehead-based measures, require a reviewed hairline. Do not label a photographed ear-adjacent point as a directly observed bony condyle.
- **Do not add as unvalidated scoring penalties:** skin diseases, body fat, skeletal development or clinical diagnoses inferred from ordinary photos. The observed feature-assessment catalogue does not establish diagnostic validity. Separate optional descriptive appearance features from geometric scores. Do not report real-world millimetres without a valid scale.

## Build / calibration order

1. Repair capture failures, wrong-view/reference mistakes, spacing, optional-side routing and misleading reliability/copy. These are actionable without competitor-driven fitting.
2. Preserve the exact source image, upright dimensions, initial/final coordinates, point provenance, edit history, metric definitions, units, exclusions and score version for each reviewed example. Keep competitor values separate from human annotations.
3. Review paired neutral photos from consenting adults using written landmark definitions and independent annotations. Treat synthetic faces as engineering stress tests. Keep difficult valid cases and mark genuinely unobservable landmarks.
4. Fix placement/coordinate defects and measure angular error, gross misses and correction burden on held-out people. Only then evaluate score calibration separately. Define what “90% accurate” means before claiming it; this four-recording review cannot establish it.
5. Add only reproducible, non-duplicate measurements with useful interpretation. Validate responsive navigation, reduced motion and scan-to-result performance on actual devices. Keep visual polish, measured accuracy and perceived-score realism as separate release checks.

The detailed study design remains in [the calibration plan](FACEIQ_COMPARISON_AND_CALIBRATION_PLAN_2026-09-07.md). This document records what these supplied examples demonstrate; it does not claim the entire catalogue, scoring model, morph behaviour or every mobile state was audited.

## Implemented in this repair pass

- Fixed the Calibrate black-preview crash: its host page lacked the camera-switch element the shared side flow dereferenced. The failure was not evidence that the photo itself was unreadable. Both host markup and defensive teardown are covered by tests.
- Blocked side-facing and steeply tilted photos from receiving creator front-view scores. Saved-library faces now go through explicit reference selection and pose checks; a calibration pair keeps one selected reference group.
- Added an all-captures diagnostic export, separate from the eligible rating corpus. New captures preserve front landmarks, automatic/final side points, upright dimensions, per-view reports, scoring references and provenance. Unrated and external-reference rows are included. Photos/names are omitted, but the geometric data should still be kept private. Older captures cannot recover coordinates that were never stored.
- Made failed local saves visible and kept the pending capture open instead of silently discarding it.
- Changed capture to front tutorial, front review, optional side invitation with example, then side tutorial only after acceptance. Review controls have distinct confirmation, editing and exit groups, with retake/front-only available.
- Tightened the existing private side-contribution flow: separately unchecked own-adult-face confirmation; server-side account adulthood; explicit self-scan/account ownership checks; no guest/unknown-subject contribution. The same gates cover post-report edits and delayed submissions. Sharing/downloading results does not opt anyone in. This is not a new front-photo collection system or automatic training pipeline. No production SQL was changed.
- Reworked report/Max context and copy so missing or unreliable readings cannot become confident best/worst claims. Diagnostics distinguish reference means, model bands and measurement availability. Removed repeated empty comparison cards and misleading cross-region overlay labels; added reduced-motion handling to measurement drawing. No distribution constants or scoring formulas were fitted to the recordings.

### Verification and remaining limits

`npx tsc --noEmit`, `npm test`, `npm run build`, `node scripts/emdash.mjs`, and `git diff --check` passed. Final suite: **1,856 passed, 0 failed, 28 skipped, 1 existing todo** (1,885 total). Contribution tests exercise the real POST handler with mocked authenticated Supabase/storage boundaries, including denial before writes, account/DOB cases and idempotent consent repair. These are not production database tests.

Browser checks used the actual side-review and invitation components with the existing synthetic guide image in an ignored local fixture. Desktop and actual 390×844 CSS-pixel layouts were inspected; buttons remained at least 44px tall with no horizontal overflow. The invitation also allowed keyboard access to the front-only exit at 320×568, using its scrollable backdrop. Entering and leaving one-by-one review produced no captured console errors. The live front entry showed only the front tutorial.

The complete new-file scan-to-report and authenticated upload round trip remain unverified in this pass: Chrome blocked automated file selection because its extension file-URL permission was off, and the Mac was locked for native picker fallback. This is not an iOS Safari or real-device performance benchmark. Live generated Max responses and the remaining report transitions also need a final visual/output review.

For the next calibration handoff, use the same original front/side files, choose the intended reference group explicitly, review the points, save even if the rating is unknown, and choose **Export all capture diagnostics**. Pair that export with the corresponding FaceIQ metric screenshots and their reference settings. Do not substitute a competitor score for independently reviewed landmark positions.
