# Side placement: evaluation and repair plan

Date: 7 September 2026. Status: read-only audit and proposed follow-up. No provider, authentication, deadline or fusion policy changed by this audit. No personal photographs were opened or uploaded and no paid provider calls were made.

## What users actually receive

The app first makes an on-device seed. A signed-in person who has allowed cloud processing can then receive a seeded cloud refinement. The final displayed placement is a fusion of those two results, not the raw cloud result. Guests and people choosing no upload receive the device seed.

| Current behavior | Evidence | Consequence |
| --- | --- | --- |
| Guests cannot call the cloud placement route. | `src/ui/sideFlow.ts:957`, `api/side-landmarks.ts:85` | A poor guest placement is not evidence that the cloud provider placed it poorly. |
| All 13 points start from the device hint in the seeded provider path. Crops refine six unique landmarks: the two ear points, jaw corner, chin front, chin bottom and neck. | `api/_sideLandmarks.ts:915`, `api/_sideLandmarks.ts:860`, `api/_sideLandmarks.ts:953`, `api/_sideLandmarks.ts:1055` | This is seed-guided refinement, not 13 independent cloud predictions. |
| Fusion permits only the ear notch and jaw hinge to use or blend cloud positions. All other 11 displayed points stay at their device positions. | `src/engine/sideSeedFusion.ts:68`, `src/engine/sideSeedFusion.ts:147` | Even a better raw cloud jaw, chin or neck prediction cannot improve that final point under the current policy. The restriction was deliberate, based on the earlier labelled synthetic set. Do not remove it without new held-out evidence. |
| The usual seeded pass makes two coarse calls in parallel, then three fine calls in parallel. A chin retry can add another call. | `api/_sideLandmarks.ts:953`, `api/_sideLandmarks.ts:1055`, `api/_sideLandmarks.ts:1092` | Five calls still require two dependent provider rounds, plus image work and network time. |
| The client has one five-second cloud budget, including encoding and response parsing. The server shares its remaining budget and reserves response time. | `src/engine/sidePlacementRequest.ts:5`, `src/ui/sideCloudPlacement.ts:126`, `api/side-landmarks.ts:99` | Latency and fallback frequency must be measured. This audit does not establish how often real requests time out. |
| The evaluation script defaults to the unseeded path and does not attach the production deadline. | `scripts/eval-vision-landmarks.ts:103`, `scripts/eval-vision-landmarks.ts:165` | Its completed raw predictions do not, by themselves, measure what users receive within the app's deadline. |

## Confirmed defects to repair before comparison

### 1. The evaluation frame is wrong for rotated phone JPEGs

At `scripts/eval-vision-landmarks.ts:148`, `sharp(bytes).rotate().metadata()` reports input metadata. It does not report the dimensions of the queued rotated output.

A local synthetic JPEG reproduced the issue without a personal photo:

- Encoded raster: 80 by 40, EXIF orientation 6.
- Metadata after queued rotation: 80 by 40, still orientation 6.
- Materialized upright output: 40 by 80.
- Harness review frame at width 640: height 320; correct height: 1280.

That changes both seed-hint normalization at line 163 and the mapping of returned fractions into labelled review pixels. A provider comparison on such files can therefore measure coordinate-frame error instead of placement error.

Proposed fix: derive the review aspect ratio from a materialized upright output, preferably the same prepared image used for inference. Use its returned `width` and `height` to produce `{ w: 640, h: height * 640 / width }`; pass this frame through prediction and scoring. Alternatively materialize `rotate().toBuffer({ resolveWithObject: true })` and use `info.width` and `info.height`. Do not read queued-transform metadata as output geometry. Add synthetic tests for EXIF orientations 1, 3, 6 and 8, mirrored orientations, portrait/landscape, and round trips through display pixels, normalized hints and output pixels. No camera fixture is required.

### 2. A failed refinement can look like corroboration

The seeded reader begins with all 13 device points at confidence 0.5. Individual non-abort provider failures are caught, and the function can return those unchanged points even if every refinement failed (`api/_sideLandmarks.ts:917`, `:967`, `:1076`, `:1084`, `:1106`, `:1123`). Fusion then treats the matching coordinates as agreement.

A local mock with all provider requests rejecting returned:

```text
rejected requests: 5
accepted calls: 0
accepted coarse points: 0
all 13 points unchanged: true
fusion secondOpinion: true
fusion overall band: high
```

The endpoint also treats this returned pass as successful and keeps its daily allowance claim (`api/side-landmarks.ts:144`). This is not proof that all live failures follow that path: deadline aborts are rethrown and use the failure path.

Proposed fix: preserve per-landmark provenance such as inherited seed, observed coarse read and observed fine read. A response with no accepted observations must take the normal unavailable/fallback path and release its claim. Do not award agreement confidence to inherited seed values. Test total failure, partial failure, malformed output, refusal and deadline expiry with mocked requests. Keep final points fail-safe and preserve the no-upload choice.

### 3. Evaluation must use the same delivery conditions

The harness already compares raw and fused points, reports per-landmark errors, gross misses, repeatability and whole-profile completeness, and has hold gates. Preserve those strengths (`scripts/eval-vision-landmarks.ts:617`, `:709`, `:740`).

Add a production-matched mode with the actual seed, orientation, image preparation, call count, deadline and fallback behavior. Report the final points that would reach the review screen, not only successful unlimited-time predictions. Use a separate diagnostic mode for slower raw provider experiments. Include input-image, seed and protocol hashes in cache validity so stale runs cannot silently survive changed inputs; the current cache match only checks reader/version/run count (`scripts/eval-vision-landmarks.ts:114`, `:139`).

Retain distinct outcomes for signed-out/device choice, timeout, rate limit, unavailable provider, invalid response and success. Private timing/outcome instrumentation should contain no photo, coordinates or user identifiers. Detailed labelled evaluation data requires its own existing consent and access controls, not automatic telemetry collection.

## Evaluation order and release decision

1. Repair frame handling and failed-read provenance with synthetic and mock tests. Claude owns the API and evaluation work; do not change those files or their policy during the UI release.
2. Freeze a real, consented held-out set split by person, separate from prompt tuning. Include left/right facing, phone rotation, camera aspect ratio, lighting and partial occlusion. Have two independent annotators label visible landmarks and adjudicate disagreements. Record when a point is not visibly identifiable instead of forcing an invented reference location. Continue reporting the hand-corrected subset separately from untouched device seeds.
3. Compare device-only, the current provider and a candidate provider on the same inputs and deadline. The current script's reader option uses one SDK transport; a different provider needs an explicit adapter, not just a changed identifier. Compare raw and production-fused results separately. Keep confirmation and correction data separate from independent evaluation labels.
4. Measure per-landmark median and tail error, gross misses, whole-profile clean rate, timeout/fallback frequency, median/tail completion time, request cost, and the number and time of manual corrections. Bootstrap by person/profile, not by treating each point as an independent face. Include repeated captures to measure capture noise.
5. Revisit fusion one landmark at a time only when held-out final-point results improve without a worse tail. Do not tune on the same faces used for the release verdict. Any new acceptance thresholds must be agreed before inspecting candidate results; keep the existing hold gates until then.
6. Only then decide whether the best change is provider, crop/prompt strategy, per-point fusion, or a dedicated profile keypoint model. There is no evidence in this audit that a provider switch alone will improve accuracy.

## More points, different jaw points, and scoring

The current jaw angle and ramus ratio directly depend on the jaw corner, hinge and chin bottom (`src/engine/sideMetrics.ts:157`). First establish repeatable definitions and accurate placement of those inputs. More points increase annotation work and do not automatically improve the resulting measurement.

The reader already asks for extra lower-jaw and rear-jaw outline points to construct the corner (`api/_sideLandmarks.ts:1083`, `:1114`), but current fusion still discards that cloud corner. Evaluate this existing information before adding more required user clicks. Review whether the hinge definition is a reproducible visible surface proxy, and whether the displayed measurement describes that proxy honestly. Adding an unobservable anatomical target does not create photographic ground truth.

Keep three separate questions separate: where the pixels are, what geometric measurement follows from them, and how a reference distribution maps that measurement to a score. A different score from FaceIQ is not proof that either placement is correct. Its visible UX and scores can be compared on authorized, matching inputs; this review cannot establish its private model, training data or calibration. Do not tune TrueMax's reference scores merely to match a competitor or hide placement error.
