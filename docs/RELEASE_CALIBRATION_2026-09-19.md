# Calibration preparation release: 19 September 2026

This supersedes the publication instructions in the earlier handoff snapshots.
The owner now authorizes pushing and merging the complete current implementation
before starting the calibration reviews. Delivery is tracked in
[PR #269](https://github.com/nikaur-prog/truemax/pull/269); its merge and deployment
records are the authoritative publication status.

## Included work

- Post-upgrade onboarding, scan-state, scorecard and lazy-vision-loading repairs.
- Owner-only League calibration, readable side-image recovery, editable automatic
  or explicitly labelled template points, reviewed original/final diagnostics,
  anonymous reference IDs and safer local saves/exports.
- Responsive report overlays and side controls, landing scanner improvements,
  house-icon dashboard navigation, working help routing and tutorial assets.
- Celebrity reference score estimates from the existing scorer, with reference
  limitations retained. No new scoring coefficients or ideals were fitted.
- Round 3D Max, calmer coaching instructions, explicit routine selection,
  recent routine continuity and private history backup/import.
- Product-destination and mobile lifecycle foundations, plus recovery work for
  goal previews. Unfinished generated morphs must remain disabled by default on
  both client and server, pending the separate rollout checks.

Both new-render POST endpoints now require the exact server opt-in
`GOAL_PREVIEW_RENDER_ENABLED=1` before reading a request, creating database access,
claiming an allowance or calling a provider. Do not set that flag or enable the
frontend morph flag for this calibration release. Existing-preview read,
validation and deletion operations remain available under their existing checks.

No pricing change, first-scan paywall, new database migration, automated FaceIQ
batch, private calibration-photo publication or morph-rollout enablement is
part of this release. Admin grants remain manual.

## Calibration operator instructions

1. After the production deployment is ready, sign into the owner account at
   `https://www.truemax.app/league/tools#calibrate`.
2. In Downloads, open `TrueMax-Calibration-Start-2026-09-19`. The starter archive
   contains `m01` and `f01`, with one front and one side photo for each. The Men
   and Women archives each contain ten identities and twenty photos.
3. Start with those two identities. Use the matching `*-front.png` and
   `*-side.png`, the pack's declared reference setting and the anonymous ID in
   Reference ID. Names are just private labels.
4. Inspect all 13 side points and facing direction. Accept correct points or
   adjust them, then explicitly confirm review. A labelled fallback template is
   a starting position, not a successful anatomical detection.
5. Save each capture. Ratings may remain blank while collecting geometry.
   Export all capture diagnostics after each small batch and retain the file.
6. Supply the matching external scores/measurements separately using identical
   photos and clearly labelled IDs. Review the first pair before the full set.

The set is stored in this browser for this website origin and signed-in account.
Localhost, preview deployments and the production domain have separate browser
storage. Avoid switching browsers/origins mid-set; exporting is the backup.
Saving corrections does not automatically retrain the detector. Synthetic
images are a pilot, not proof of anatomical ground truth or population accuracy.

## Verification and deliberate limits

The release check covers automated tests, type checking, production build,
user-facing punctuation, whitespace, archive integrity and code review of
calibration access and recovery. Browser verification covers dashboard navigation,
tutorial image loading and desktop/mobile layouts. The existing local owner
calibration smoke check covered upload, edit, save and export of a synthetic pair.

The production delivery record must be checked after merge. Payment processing,
live coaching quality, physical phone endurance, full-history cloud storage,
generated-image identity validation and atomic paid-render idempotency are not
certified by these checks. See `MORPH_PREVIEW_CONTRACT.md` for the morph rollout
requirements. The benchmark/calibration data still needs the owner's reviews.

Final local release gates: 2,123 tests passed, zero failed, 28 existing
environment-gated skips and one existing todo. All six preview/archive tests
passed, as did TypeScript, the production build, user-facing em-dash checks and
diff whitespace checks. The existing approximately 617 kB lazy Max 3D chunk
warning remains. Private images and diagnostic exports were verified excluded
from the public commit; the three download archives passed CRC, PNG decoding
and manifest-hash verification.
