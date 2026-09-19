# Admin side-calibration review

## Readiness recheck, 19 September 2026

The readiness fixes are built locally. New front and side captures preserve the
original upload's SHA-256 and a dimension-prefixed fingerprint of the displayed
review raster. The export binds these to the reference ID, dimensions, initial
and final points and measurement differences. Photos and private labels are not
included. Legacy captures without fingerprints remain readable, but cannot gain
those fingerprints retrospectively.

Saved-set updates now reject unreadable existing data, duplicate reference IDs
within a reference group, missing-row edits, and observed competing writes or
account changes. A save must pass read-back confirmation before releasing the
pending capture. Exports also use strict reads, so damaged storage cannot silently
produce an empty backup. External/revised ratings cannot be promoted into human
fitting targets through the edit/confirmation controls.

Verification: TypeScript, the full test suite (2,075 passing, 28 skipped, one
existing todo), production build, user-copy punctuation check and whitespace
check passed. The suite includes the new admin-entry UI-wiring regressions.
The three local-preview access tests passed. Build still
warns about the separately loaded 3D Max chunk exceeding 500 kB.

A loopback-only calibration preview is available using `npm run calibration:preview`
at `http://127.0.0.1:4189/league/tools#calibrate`. Its only API proxy is the real
read-only production owner-access check. It forwards the user's normal bearer
token to the fixed TrueMax endpoint, never a privileged key. Other API calls,
including uploads, analytics, cloud placement, billing and generation, are disabled.
No grant or browser session is fabricated. Preview access tests verify failed
authentication, cross-origin calls, unrelated paths and upstream failure stay closed.

**Authenticated owner acceptance passed on 19 September in the in-app browser.**
The real owner gate opened after normal sign-in. A synthetic `m01` front/side
pair was captured under the separate Reference ID `qa-smoke-20260919`, with no
attractiveness rating. The front produced 478 landmarks; the side opened all 13
editable points. Confirmation without review acknowledgement was blocked, and
changing direction cleared acknowledgement. One deliberately incorrect QA-only
tap-to-place change was made, saved, reloaded and downloaded through the real
export button. This is a functional test, not anatomical calibration evidence.

The downloaded JSON was parsed and checked against both original image files:
both SHA-256 values match, review dimensions match, all 13 original/final side
points are present, and the deliberate point change persists. It contains the
front/side reports (33 and 10 metric entries), placement comparisons and 42 finite
measurements. Private labels and thumbnails are excluded. The review-summary
tool accepts the export. The browser download event waiter timed out, but the
actual download existed in Downloads and passed the checks above.

Only the temporary QA record was removed from the set, leaving zero faces for
the operator to start. Its export is retained outside git at
`.calibration-pilot/qa/qa-smoke-20260919-diagnostics.json`, and must never enter
training or scoring calibration. **The operator can now start `m01` and `f01`,
then export and check the first two before proceeding through all 20 identities.**
No production deployment, database change, scoring fit or detector training was
performed. Current calibration storage remains owner-scoped browser storage,
not cloud backup; use this same in-app browser and `127.0.0.1:4189` origin and
export after each small batch.

Fresh verified image packs are in the owner's Downloads folder, inside
`TrueMax-Calibration-Start-2026-09-19/`:
`Start-here-m01-f01.zip` (4 images), `Men-m01-to-m10.zip` (20), and
`Women-f01-to-f10.zip` (20). All 40 images decode and match the original pilot
fingerprints. No images were regenerated or altered. Use `m01` and `f01` as
Reference IDs; alias names belong only in the optional private Label field.

FaceIQ ratings must be marked as external. They are retained for diagnostics
but excluded from the existing independent-human-rating fitting corpus. The
single external rating field cannot represent separate front, side, overall
and per-metric scores. Preserve those in matched screenshots or structured
comparison files, and build a separately labelled benchmark/mapping step.
Saving corrections or entering a competitor score does not train a detector
or update scoring ideals.

Remote branch check found Claude's `6312fc8` commit dated 8 September, covering
the optional-side tutorial and Play artwork. It predates the continuation
handoff and is not a new completion of that handoff. Remote main remains
`5b8b5fd`; the audit branch remains `60158b0` plus local uncommitted work. No
branch was reset or merged during this recheck.

> Status, 11 September 2026: Local review/export and owner-refresh fixes are built. An authenticated API preview and one complete owner save/export must pass before the full calibration set. See the
> [current continuation handoff](CLAUDE_HANDOFF_2026-09-11.md) for branch preservation,
> verification evidence and the next execution order. Historical details below
> do not imply that the whole roadmap has shipped.

Prepared 10 September 2026 for PR #269. These changes are not a new scoring calibration and require deployment before they appear on the live website.

## Operator workflow

1. Sign in to the owner-admin account. Open League, Tools, then Calibration (`/league/tools#calibrate`). Ordinary creators and non-owner staff do not receive this tool. Legacy `/calib` now routes to the same guarded entry.
2. Add a face, choose the intended scoring reference group explicitly, and upload the front photo. No new front-point correction editor is introduced.
3. Open its Side slot and upload the matching original profile. The app attempts automatic placement and always opens an editable review for a readable admin calibration photo. If the reader fails or cannot identify geometry, the fallback is labelled as a template, not detected landmarks.
4. Check the facing direction, drag misplaced points onto their named features, and review all thirteen. Use Review one by one if helpful. Tick the review confirmation, then Confirm points. Any further correction clears that acknowledgement. Do not guess an obscured anatomical feature simply to complete a record.
5. Select Analyse, enter the anonymous pilot ID (`f01` to `f10` or `m01` to `m10`) in Reference ID, leave the attractiveness rating empty if unknown, and Save face. The separate private Label may contain an alias and is not exported. After a first pair works, complete the remaining pairs. The current synthetic pilot contains 20 identities and 40 images, not 40 different people.
6. In See the set, choose Export all capture diagnostics. Check that each exported `referenceId` matches its original filenames. Share the JSON privately with matching FaceIQ screenshots, units, landmark definitions and reference settings.

The default Vite-only preview does not serve the owner-access API. Use the dedicated local calibration preview described above or an authenticated deployment containing these changes. Local fixtures are not evidence that the signed-in owner workflow has passed. A local set does not migrate automatically to the live website.

## What is preserved

The existing account-scoped calibration export retains image dimensions, reference group, reports, original front landmarks and both suggested and final side points. This patch adds local-reader points and method, template provenance, recovery warnings, and IDs of operator-reviewed out-of-range measurements. Coordinates are in the review image's pixel space. Ratings can remain absent.

Side photos are not mirrored in admin calibration. Facing controls flip the editable point layout, not the image or original evidence. Values outside the engine's anatomical limits remain flagged/excluded; an operator acknowledgement does not silently make them valid scores.

This is evidence collection. Saving faces does not retrain detection or change scoring ideals. Synthetic examples help find software failures but do not establish population attractiveness norms, clinical anatomy or a measured 90% accuracy rate. The complainant's incorrect automatic placement is a plausible explanation, not a confirmed diagnosis without that scan's original and corrected coordinates.

## Automatic-versus-reviewed comparison

The follow-up local build adds `placementComparison` to side capture diagnostics.
It keeps each original point alongside its reviewed position and movement in
pixels and as a fraction of the image diagonal. It also records the automatic
and reviewed metric values, their differences and their scores under the same
current engine. This isolates placement changes from scoring-reference changes.
Malformed, missing or out-of-image automatic geometry is retained as evidence
but receives no automatic report or score. A template is not a successful
automatic detection, and an operator review is not independent ground truth.

After exporting all capture diagnostics, a private local summary can be run with:

```sh
node tools/review-side-calibration.mjs /absolute/path/to/capture-diagnostics.json
```

The summary counts usable comparisons, template fallbacks and invalid automatic
reports, then lists point movements and metric changes. It neither uploads the
export nor prints face names, fits scoring ideals or updates a model. Older
exports without comparison fields are counted separately rather than treated
as zero-error captures. Keep the full private JSON for the detailed review.

## Resilience and access changes

- Paint the readable photo before detector preparation. Distinguish file decode failures from later placement failures.
- Bound admin local detection to fifteen seconds, then recover to editable estimates. Cancellation never becomes a fallback result.
- Device-only placement skips authentication. Optional admin cloud placement has one five-second deadline covering token lookup and the request; late tokens cannot start uploads after timeout or cancellation.
- Record failed cloud attempts separately from disabled cloud placement.
- Check the current owner grant at calibration entry, including deep links and account changes. Remove the separate public legacy calibration scanner.
- Let owner/staff accounts enter their staff dashboard despite a pending/paused creator application, without modifying that application or granting creator payout status.

No production database changes are required.

## Verification evidence and limits

Local browser checks used an ignored QA page mounting the real side-capture component and the real diagnostics serializer, with no account writes:

- A bundled synthetic side image reached all thirteen editable handles.
- Confirmation without the review checkbox was blocked.
- Changing the direction cleared the prior acknowledgement; confirming the edited layout exported thirteen original and thirteen final points with `changed: true` and `operatorVerified: true`.
- A readable blank image reached an explicitly labelled template instead of a pose rejection.
- Corrupt image bytes displayed a distinct file-reading message.
- The review controls were inspected at 390 CSS pixels with no horizontal overflow; the temporary browser viewport override was restored.

The Chrome extension rejected the native file-chooser upload because file-URL access was disabled. The fixture supplied a locally served test image to the application's file-input handler instead. This verifies the component flow, not a native picker on an iPhone or an authenticated production save. The local signed-out owner-tool route denied access; owner/staff/account-switch access cases also have regression tests.

Final gates and the pushed revision are recorded in the PR handoff. Do not describe the live site or all pilot faces as verified from these component checks.
