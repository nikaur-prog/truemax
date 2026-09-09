# Local synthetic diagnostic pilot

This is a TrueMax-only diagnostic, not a fitted calibration or a validation claim. The 20 declared fictional adults (10 women, 10 men) and their front/profile images are synthetic test inputs. Automatically detected or seeded points are not gold labels. Pair identity consistency, age, sex and attractiveness are not established by the engine. The `f`/`m` filename prefix supplies the declared reference stratum.

## Run

Start the development server with `npm run dev -- --host 127.0.0.1 --port 5179`, then open `http://127.0.0.1:5179/dev/calibration-pilot.html`. This is a separate, DEV-gated entry, not a preview of the authenticated product. It is deliberately absent from production build inputs and does not import the main application entry.

Choose local files from the ignored `.calibration-pilot/` directory. Expected names are `f01-front.png`, `f01-side.png` through `f10`, and `m01` through `m10`. JPEG and WebP extensions also work. Partial sets are accepted; every missing view is retained. Duplicates for one identity/view are rejected rather than arbitrarily selected. Click **Run local diagnostic**, inspect each expandable result and point overlay, then **Export JSON**. Cancelling preserves completed results and explicitly marks unfinished views. Provenance, startup, decoding and fingerprint waits have 30-second deadlines and respond to cancellation; asset fetches receive the abort signal. A detector constructor already in flight is shared by retries until it actually settles, rather than duplicated after a timeout.

No account is initialized and no photos, landmarks or reports are uploaded or persisted in history. Only same-origin development modules, detector assets and the Vite development connection are loaded. Source/model asset hashes are computed locally. The source images are decoded in memory, resized to the product's 2160-pixel ingest cap without cropping or mirroring, and released after processing. The page restores its isolated side-prior suspension state after success, cancellation or failure; it never reads or writes an owner's prior.

## What is measured

- Front: production `initLandmarker`, image mode, `detectStable`, geometry and `analyze`, including the pixel hairline and shape contribution. `detectStable` attempts consensus but can fall back to its single base detection; the diagnostic does not claim an observed pass count. Export includes all returned mesh points, image coordinates, pose-corrected coordinates, quality warnings and raw measurements. A refused hairline remains unavailable.
- Profile: production `seedSidePointsSmart`, its normal candidate plausibility policy, integrity checks, raw side constructions and `analyzeSide`. All 13 surface points, seed method/confidence, facing direction and placement warnings are retained. Cloud placement, owner history and human correction are not used.
- Pair: production `mergeReports`, only when both views produce reports. This preserves existing normalization and blend behavior. A score with automatic profile points is still diagnostic and unverified, not an accepted user scan.

Capture acceptance, liveness, occlusion screening and human verification are not evaluated end to end by this page. A completed record means the diagnostic produced a report, not that all production capture gates would accept it. Optional segmentation availability is recorded separately. The profile seeder can still return a plausible but misplaced template, especially at the jaw corner or hinge. Rating comparisons cannot locate or correct those points.

## Export contract

The JSON wrapper contains `data` and `nonFiniteValues`. Every undefined, NaN or infinite value is serialized as null with its exact path and reason, rather than being dropped or silently becoming a plausible zero. This includes a refused pixel hairline's `foreheadRatio` key. Records explicitly distinguish missing, duplicate, cancelled, failed and complete inputs. No missing view is imputed.

The export includes SHA-256 image fingerprints, original/ingest dimensions, all point placements, all raw constructions, active metric definitions, both reference strata, selected mean/SD/ideal/direction/tolerance, metric scores/conformance, effective weights, region visibility, aggregate z values, merged reports, current normalization tables and shape reference. Held-out side constructions remain raw, with no active score or ideal assigned. They do not enter the aggregates. The score version, build stamp, browser runtime, exact engine source snapshots and source/model asset hashes identify the implementation even in a dirty development checkout.

Do not fit or adjust norms/weights from these 20 synthetic identities, treat generated images as a population sample, or use another product's rating as landmark truth. A placement validation needs independent point labels and repeatability measurements. In particular, the current gonial construction uses photographic surface points while its scoring reference is skeletal-derived; this pilot does not validate that reference or recover a skeletal angle from a photo.
