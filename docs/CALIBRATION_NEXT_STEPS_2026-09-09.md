# Calibration: what happens next

Status: engineering repairs, not completed accuracy calibration. The existing 20 fictional adults and 40 front/side images have already been generated and measured twice locally. The owner does not need to generate them again or give each face an attractiveness rating.

## The defect we can act on

Fifteen of the 20 local profiles produced the same 117.457752-degree gonial angle. The jaw corner, hinge and chin bottom can be constructed from a template rather than independently located on the photo. Changing the score assigned to 117 degrees would leave those coordinates wrong. A plausible geometric result is not evidence of correct placement.

The current cloud fusion retains the device jaw corner and chin bottom even when it accepts an ear/hinge refinement. A different provider cannot resolve that entire problem through the unchanged selection policy. Candidate localization and fusion must be evaluated together.

## What Calibrate actually does

- The owner-only Calibrate workspace collects front/side measurements, with an optional human rating. Saving is not a training run and does not change deployed scoring parameters.
- Leave the rating empty when unsure. External product scores must remain explicitly marked as external; do not use them as blind human judgments.
- The existing corpus export is for the rated fitting subset. It is not a complete landmark export, and unrated measurements should not be assumed to appear in it.
- Side corrections can be shared separately, with consent, for review. A successful upload does not mean they have trained a new scanner. User-confirmed points are not independently validated labels.
- An accepted personal scan can also influence that same account's local side prior. That is not global scanner training and must stay separate from evaluation. The repair batch disables reuse of that prior in the multi-person Creator/Calibrate page without deleting it or changing the main personal-scan path.
- The private local pilot JSON already captures automatic points, measurements, references and scores. There is no reason to re-enter those 40 diagnostics through the rating form.

## What the owner needs to do

### Now

1. Send the draft in [FACEIQ_DATA_ACCESS_2026-09-09.md](FACEIQ_DATA_ACCESS_2026-09-09.md), asking for the missing analysis fields and permission for the bounded automated comparison. Forward the reply and any complete export privately. Do not publish a share link, password or API key.
2. If automated access is approved, confirm the credit cap after the account's billing units are checked. No top-up or subscription change is automatic. Existing subscribed access already works; another sign-in is not presently needed.
3. Use the smoke-test checklist below on the repair preview or after an approved merge. No manual transcription or new facial ratings are required for that test.

### For real-photo accuracy evaluation, after the collection workflow is ready

Help recruit ten consenting adults for the initial real-photo pilot, ideally five for each supported reference group. Each supplies a neutral front and true-side image, with the ear, jaw and chin visible when possible. Keep the exact original files and note mirroring/cropping and capture conditions. Two participants provide two additional front/side capture pairs in separate sessions. Do not send these to another service without the participant's permission for that service and research use.

This small pilot develops the workflow; it cannot establish population norms or a 90-percent accuracy claim. The synthetic set remains a separate engineering test set. We also need independently reviewed landmark labels. The owner is not expected to guess hidden anatomy or be the sole expert annotator; arrange a second suitably trained reviewer when the annotation workspace is ready. Unclear points should be marked unobservable, not invented.

If FaceIQ permission is unavailable, the independent TrueMax work continues. Complete screenshots or saved report PDFs supplied through a permitted process can be parsed without typing every value, but unknown or unreadable fields remain missing.

## What Codex can handle

### Repair batch, before calibration claims

- Complete and test the audit repairs in PR #269: onboarding, vision lazy loading, side source/accounting/direction handling, known morph-job recovery and stable scorecard categories.
- Repair Calibrate's capture-to-verdict media lifecycle, so the existing dual-view export receives the paired media instead of losing it before rendering.
- Count suspect side-only measurements once.
- Stop the multi-person Creator/Calibrate page from reusing the signed-in owner's saved jaw/ear prior on other identities. Keep stored personal priors and the main personal-scan path unchanged.
- Remove side-review claims that all points were independently identified from the photo or that any out-of-reference reading necessarily proves a misplaced point. Preserve the current review/retake/skip choices.
- Explain that saved corrections are collected for review, not instantly trained into the scanner.

### Next calibration build, separate from the repair batch

1. Build a private independent-annotation workflow: photo first, automatic predictions hidden, explicit visibility labels, image hashes/dimensions, reviewer identity and revision history. No attractiveness rating is required. Keep original auto predictions separate and immutable.
2. Carry per-point source information through seed, cloud, fusion, manual review, stored diagnostic record and metric dependencies. A scan-level `fused` label is not sufficient to say its jaw was detected. This needs a coordinated contract change, not a copy-only patch.
3. Define photo-based endpoints and compare independent annotations, including reviewer disagreement. Retain automatic, user-corrected and independently annotated measurements separately.
4. Evaluate candidate image-localized jaw/chin placement and candidate fusion policies, first on development images. Compare provider candidates using the same photos, deadline and fallback accounting. Do not replace a working path merely because a provider is different.
5. Evaluate on previously untouched people. Report point error, angular/ratio error, gross misses, correction effort, recapture stability, latency and fallback rate. Set tolerances before examining candidate test results; define what "90 percent" would actually count.
6. Only then consider a small justified score calibration and version it. Audit front/side aggregation and score interpretation separately. Competitor agreement is a benchmark, not proof of anatomy or universal attractiveness.

The first urgent target is a more reliable jaw triplet, not adding more points. Additional points should be proposed only when a visible, reproducible definition improves a specific measurement.

## Owner test after the repair preview is ready

- Open Calibrate with an owner account. Add front and side for a test identity, leave the rating empty and save. The existing dual-view export option should be present and refer to that same capture pair.
- Save a side-only record; its suspect count must not double and it must not offer a dual-view export.
- Move to the next person or back to the set; prior capture media must not be reused for the next person.
- Review an automatic side placement. Check the jaw corner, hinge and chin bottom; the copy must not promise that all thirteen points were detected from pixels. Retake, correction and skip behavior remain unchanged.
- Compare complete and incomplete scorecard PNGs. Category labels must remain fixed; unavailable regions say `Not measured`.

The actual encoded MP4, authenticated sharing, deployed account flow and physical iOS capture/performance need their own runtime checks. Unit tests of export handoff do not verify an entire video encoder or a live database write. The signed-out local browser check reached the existing access-denied screen; it did not bypass the owner gate or exercise an authenticated export. The owner can run the checklist in the preview or immediately after an approved merge. Merging these repairs must not be announced as completed calibration.
