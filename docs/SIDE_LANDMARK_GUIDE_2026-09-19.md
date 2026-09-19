# Ear notch and surface hinge guide clarification

## Decision

Keep the existing `condylion` key as a photographic surface hinge estimate near
the front of the upper tragus. Do not move it to a haircut, sideburn or cheekbone
boundary. This change does not replace the measurement construction with a
tragion-based angle, alter scoring references, refit a population template or
modify previously saved points.

The exact skeletal joint cannot be identified from this illustrative photograph.
The visible ear notch and an estimated skin location are not equally observable.
Operator review is not expert anatomical validation.

## Consistent guides

- `SIDE_POINTS` names the hinge as an estimate. Shared ear-specific instructions
  distinguish the notch from the dark canal opening and the nearby skin.
- The original synthetic reference photo and illustration coordinates remain.
  Its marker spacing is not prescribed for other people.
- Thumbnail, close-up, whole-face view and zoom use the same coordinate mapping.
  Green marks the selected point; white identifies its neighbouring ear point.
- Both ear points have direct close-up links from the all-points reference.
- The hinge opens on the close-up. Whole-face and location-animation controls
  retain context without requiring the user to infer a joint from a blank cheek.
- Reduced motion, keyboard access, failed images, mobile aspect ratio and
  animation cleanup are covered by verification.
- Automatic prompts no longer force a fixed gap or equal height between the
  two points. The device template remains an initial estimate, not a constraint
  on manually corrected positions.

## Calibration provenance

New review sessions record `landmarkGuideVersion: side-surface-guide-2` separately
from the automatic reader's `seedVersion`. Old captures remain unversioned or
retain their prior version; exporting does not relabel them. Automatic and final
points remain separate. No automatic detector training or score fitting occurs
when a reviewer saves a face.

Review one male and one female profile first. Compare the same visible features,
not identical pixel spacing or an expected score. Retain uncertainty around the
hinge estimate when interpreting errors. Photographic and skeletal gonial
constructions must not be assumed interchangeable; current scoring references
still need validation using matched definitions and held-out faces.

## Verification

Run `npm test`, `npm run build`, and `node tools/verify-side-guide.mjs`.
The browser check uses an isolated local server and the real guide components,
without login, scan storage, uploads or provider calls. It checks desktop,
phone, mirrored profile, small-screen landscape, static/animated pixel equality,
canvas resolution/aspect ratio, image failure and reduced motion. It does not
prove anatomical accuracy or perform a live cloud scan.

## Photo-first calibration reference choice

Calibration now selects/opens the photograph before asking which reference group
to use. The chooser shows a local preview, starts unselected for each new person,
and lets the operator change the selection before pressing Continue. Cancelling
does not retain an answer. File attempts are isolated across cancellation, mode
changes and account changes; detached file pickers cannot submit to a newer run.

The matching front and side of one pending identity share its explicitly chosen
group. Before saving, **Change reference group** recalculates both draft reports
together without moving their points. The rating step links back to photos and
reference choice. Previously saved calibration rows are not re-scored or migrated.

The normal app's upload and paste flows also select the image first. Signed-out
and other-person scans start with no reference selected. An explicit **It's me**
answer can reuse only the account profile's own saved setting, not the last guest
or the browser-global preference. Upload retakes ask again after file selection.

Additional checks:

- `node tools/verify-reference-choice.mjs`: real dialogs at desktop, phone,
  small-phone and landscape sizes; changing selection, explicit confirmation,
  preview loading/failure, cancellation/retry, stale callbacks, local resource
  cleanup, keyboard isolation and legacy one-tap callers.
- `node tools/verify-upload-choice.mjs`: real signed-out app upload and paste
  entry points; file-first ordering, repeated same-file selection, cancellation
  and no default from a remembered browser preference. It stops before analysis.
  Native picker cancellation is verified by dispatching its event on the real
  input because the browser test runner does not expose a native cancel action.
- `node tools/calibration-reference-smoke.mjs http://127.0.0.1:4189`: isolated
  rating form and device-local Reference ID save/export fixture.
- `node tools/app-walkthrough-smoke.mjs http://127.0.0.1:4189`: full local
  desktop/mobile UI walkthrough with labelled report fixtures and external/API
  requests blocked. It does not validate live auth, a detector or score accuracy.

Latest local verification on 2026-09-19: **2,153 passed, 0 failed, 28 skipped,
1 todo**; type check and production build passed. Existing large lazy-loaded
3D chunk warning remains. All browser checks above passed. No user browser tabs
or saved production calibration faces were modified by these tests.

The owner authorized publishing this follow-up on 2026-09-19. Its pull request
and deployment records are authoritative for publication status; the earlier
calibration release remains separate. Continue an existing calibration
set on its original browser/account/origin; local-preview storage and production
storage are separate. Export the saved diagnostics before refreshing a session
with unsaved edits.

## Anatomical references

- [FaceBase landmark notes](https://www.facebase.org/resources/human/facial_norms/notes/):
  location of the visible tragion notch.
- [USC TMJ examination guidance](https://ostrowonline.usc.edu/tmj-assessment/):
  joint assessment uses palpation and movement, not visual certainty from a still.
- [Photographic assessment of cephalometric measurements](https://pubmed.ncbi.nlm.nih.gov/23597034/):
  explicitly distinguishes photographic and skeletal landmark constructions.
