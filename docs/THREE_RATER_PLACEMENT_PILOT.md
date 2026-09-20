# Three-rater side-placement pilot

20 September update: the owner collection now covers all 20 paired identities.
The first private calibration experiment has been run, with preserved raw data
and no production model activation. See
[implementation and release gates](CALIBRATION_IMPLEMENTATION_2026-09-20.md).

This is a private engineering comparison of three distinct sources: the system's original automatic placement, an independent assistant placement, and the operator's reviewed placement. Agreement is not anatomical accuracy. The operator is not automatically ground truth, and the assistant does not validate itself by matching its own detector.

## Collection protocol

1. Freeze the image files and the landmark guide version before annotation. Use the same original side image for all three sources. Keep the corpus identities (`m01` to `m10`, `f01` to `f10`) separate from a browser's save-order IDs.
2. The assistant annotates the original image without consulting automatic or human point coordinates. Declare any prior exposure to screenshots or corrections. Save this independently, never as an operator-confirmed record in the application.
3. Keep each original system placement, including template fallbacks and unavailable-reader warnings. The operator can review and correct the displayed system placement, but this is an assisted correction, not a fully blind third annotation. Starting from the same points can increase agreement.
4. The operator reviews all thirteen positions and facing direction using `side-surface-guide-2`. Unknown attractiveness ratings remain blank. Export **all capture diagnostics**, not only the text report or fitting corpus.
5. Compare only matching images and verified coordinate frames. Review disagreements visually afterward. Do not resolve them by averaging three points without checking which feature each source intended.

The jaw-hinge point is a surface estimate. Its internal anatomical position cannot be certified from a photograph. Occluded, ambiguous or unobservable points must be labelled, not invented to obtain complete coverage. Independent assistant records use `visibility: visible | estimated | unobservable` and `confidence: high | medium | low`. An explicitly unobservable point has `x: null, y: null` with that visibility label. A literal `null` point is also accepted as missing visibility information, not a claim that the feature is unobservable. Missing keys remain explicit missing coverage in the report.

## Private assistant schema

The top-level object is `{schemaVersion: 1, kind: "independent-assistant-side-placement", guideVersion: "side-surface-guide-2", coordinateSpace: "normalized-original-image", records: [...]}`.

The private viewer's equivalent schema is also accepted: `schemaVersion: "assistant-side-placement-pilot-v1"`, `coordinateSystem: "normalized-original-image"`, `origin: "top-left"`, `annotationSource: "assistant-independent-visual-review"`, and the same guide version and records. Its `image.relativePath` is resolved by **basename only inside `--images-root`**, followed by original-byte and dimension verification. The tool does not follow viewer-relative directory traversal. Point `notes` and `note` are private free text and are omitted from comparison output.

Each record contains:

- `id`: canonical corpus identity. Explicit aliases `m1`, `w1`, `w01` are accepted and become `m01`, `f01`, `f01`.
- `image`: `{file, sha256, width, height}`. `file` resolves within the explicitly supplied private images directory. SHA-256 covers the original file bytes, not a screenshot or a resized thumbnail.
- `faceDir`: `1` for image-right, `-1` for image-left.
- `points`: the thirteen persisted side landmark keys. Coordinates are fractions of the original width and height, with origin at the top left. Each non-null point also has visibility and confidence.
- Optional `notes`, point-level `note`, and `priorExposure`. Keep these in the private annotation file. Set `priorExposure: "none"` only for genuinely unseen records; otherwise describe the exposure. An omitted value remains unknown. The primary blinded subset requires explicit `"none"`; an all-records summary is reported separately.

The tool checks the landmark list against the current application in its tests. It does not read or modify browser storage, call an external service, submit labels, or change the detector or scoring scale. No actual photographs or annotation coordinates belong in this public repository. Store private files under the ignored `.calibration-pilot` directory or another deliberately private location.

## Run the comparison

```sh
node --test tools/compare-placement-pilot.test.mjs
node tools/compare-placement-pilot.mjs \
  --assistant .calibration-pilot/reviews/assistant-placement.json \
  --images-root .calibration-pilot/references \
  --captures /absolute/private/path/truemax-calibration-diagnostics.json \
  --baseline .calibration-pilot/truemax-baseline.json
```

The command is read-only and prints JSON to standard output. `--captures` is optional while the operator's reviews are unfinished; no missing data is invented. Output includes identity and landmark disagreement summaries but deliberately omits photographs, point coordinates, file paths, file hashes and free-form notes. Treat comparison results as private project data too.

`--baseline` is optional. When supplied, it selects the historical local automatic placements as the system rater for every pair; it never silently replaces these with newer automatic points from a human capture. Without it, the system rater is the original automatic placement recorded alongside each operator review. Label and compare these runs separately: historical local output is not a current production/cloud baseline.

### Image and frame checks

- Match original-file SHA-256 first. Explicit `referenceId` is a cross-check. An explicit identity/hash conflict or a different image with the same identity fails the comparison. A browser's save-order `id` is never a dataset identity by itself; without a matching image hash or explicit `referenceId`, the row remains unmatched.
- Duplicate matching captures fail closed. Explicitly select the intended capture in a private copy; do not silently use the first or latest one.
- Verify the original file's actual bytes, dimensions and decoded orientation. Then calculate the application's versioned displayed-RGBA hash from the original raster and require an exact match with the capture.
- Assistant comparisons require unchanged dimensions, orientation and pixels. A hash that matches original bytes does not prove a later displayed crop matches the original frame. Unknown or different guide versions are prominently flagged: the tool retains geometric disagreement, not an equivalent-definition accuracy test. In particular, hinge and ear-notch wording may differ between historical and current review instructions. The hinge remains a surface proxy.
- The initial comparator deliberately **does not guess transforms** for resized, cropped, mirrored, rotated or differently decoded photographs. These comparisons are withheld with a reason. A future transform adapter must verify its relationship to both rasters before enabling comparison; dividing by width and height alone is insufficient.
- The system-versus-human comparison can still use their shared review-image frame when an original-frame comparison is withheld. This is correction movement within one capture, not independent accuracy. Human comparisons require `operatorVerified: true`.

### Historical baseline evidence tier

The old wrapped `data.records[]` pilot format has exact original-file hashes, native/analysis dimensions, explicit unmirrored/no-additional-rotation-or-crop metadata, point pixels and normalized coordinates, local-only/no-owner-prior declarations, and archived detector source provenance. It does **not** have a displayed-RGBA digest or an archived capture/decoder source snapshot.

The historical adapter requires verified current original-file bytes and dimensions, unchanged recorded native/analysis dimensions, orientation 1, unmirrored metadata and consistent pixel/normalized coordinates. Its evidence tier is **recorded identity-frame metadata**, not independent displayed-pixel proof. The tool preserves this distinction in every relevant comparison. It does not manufacture a historical raster hash or relabel the run as fresh/current validation. A whole-record `mesh` or `segmentation` method does not establish every landmark's origin; some landmarks may still be template-based.

Historical guide versions are unknown. Geometric disagreements remain visible with warnings, especially around clarified hinge and ear-notch instructions. Comparisons against a human capture still require exact verification of that capture's displayed raster before bringing it into the original frame.

## Reading the results

Distances are Euclidean pixel distances divided by the image diagonal, preserving the actual width-to-height aspect ratio. A value of `0.01` means a disagreement of **1% of the image diagonal**. It does not mean 1% error or 99% accuracy. Different face size and framing can alter this number even when the physical disagreement is similar.

Every pair reports possible and comparable identities/points, missing reasons, mean, median, 90th percentile and maximum disagreement. Landmark summaries retain their own denominators and an assistant-visible-only subset. Identity rows preserve guide/frame eligibility, facing disagreement, assistant exposure status and system fallback metadata. No low-confidence or missing point disappears from the denominator.

Twenty synthetic paired identities are useful for finding implementation bugs and ambiguous instructions. They do not establish population accuracy, expert anatomical validity or an acceptable error tolerance. Any detector tuning must retain a held-out set and be checked against images that were not used to develop the change. A side-score scale repair is a separate versioned calculation change, not an automatic consequence of collecting landmark corrections.
