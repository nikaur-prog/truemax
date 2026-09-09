# Admin side-calibration review

Prepared 10 September 2026 for PR #269. These changes are not a new scoring calibration and require deployment before they appear on the live website.

## Operator workflow

1. Sign in to the owner-admin account. Open League, Tools, then Calibration (`/league/tools#calibrate`). Ordinary creators and non-owner staff do not receive this tool. Legacy `/calib` now routes to the same guarded entry.
2. Add a face, choose the intended scoring reference group explicitly, and upload the front photo. No new front-point correction editor is introduced.
3. Open its Side slot and upload the matching original profile. The app attempts automatic placement and always opens an editable review for a readable admin calibration photo. If the reader fails or cannot identify geometry, the fallback is labelled as a template, not detected landmarks.
4. Check the facing direction, drag misplaced points onto their named features, and review all thirteen. Use Review one by one if helpful. Tick the review confirmation, then Confirm points. Any further correction clears that acknowledgement. Do not guess an obscured anatomical feature simply to complete a record.
5. Select Analyse, leave the attractiveness rating empty if unknown, and Save face. After a first pair works, complete the remaining pairs. The current synthetic pilot contains 20 people and 40 images, not 40 different people.
6. In See the set, choose Export all capture diagnostics. Keep the original files and a mapping of visible record IDs to filenames. Share the JSON privately with matching FaceIQ screenshots, units, landmark definitions and reference settings.

## What is preserved

The existing account-scoped calibration export retains image dimensions, reference group, reports, original front landmarks and both suggested and final side points. This patch adds local-reader points and method, template provenance, recovery warnings, and IDs of operator-reviewed out-of-range measurements. Coordinates are in the review image's pixel space. Ratings can remain absent.

Side photos are not mirrored in admin calibration. Facing controls flip the editable point layout, not the image or original evidence. Values outside the engine's anatomical limits remain flagged/excluded; an operator acknowledgement does not silently make them valid scores.

This is evidence collection. Saving faces does not retrain detection or change scoring ideals. Synthetic examples help find software failures but do not establish population attractiveness norms, clinical anatomy or a measured 90% accuracy rate. The complainant's incorrect automatic placement is a plausible explanation, not a confirmed diagnosis without that scan's original and corrected coordinates.

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
