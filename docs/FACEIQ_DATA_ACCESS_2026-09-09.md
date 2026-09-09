# FaceIQ data-access check

9 September 2026. Account-owner-authorized inspection of the signed-in interface. No batch analyses were submitted, no new photos were uploaded, and no public share link was created. This is an access/export check, not a completed calibration comparison.

## Verified first-party export

The signed-in [Account page](https://www.faceiqlabs.com/profile) has **Data Export > Download Data**. Its description includes face images and analyses. The downloaded ZIP contained 22 front/side WebP files for 11 existing analyses and a `data.json` file. Checking every face record, not only the first, found only these fields:

`id`, `gender`, `race`, `createdAt`.

No measurement, ratio, score, angle or landmark fields were present. Account and billing metadata was also included but is not relevant to the study. The private ZIP stays outside the repository; no images, account values or analysis identifiers are committed. The model-training preference was already off and was left unchanged.

The report's **Share analysis** control creates a public link with photos, scores and measurements visible to anyone holding the link; signed-in recipients can import independent copies. The confirmation was cancelled. A public share link is not needed for this work and is not equivalent to a private data export.

## What this resolves

Account access is working. The user does not need to type every measurement individually: permitted structured exports, complete screenshots or saved report PDFs can be parsed locally, with unreadable values marked missing. However, the current built-in ZIP does not supply enough data to compare numerical measurements or coordinates.

The [Privacy Policy](https://www.faceiqlabs.com/privacy), sections 7-8, offers data access and a structured copy. The published contact is `privacy@faceiqlabs.com`. The [Terms](https://www.faceiqlabs.com/terms), section 5, require permission for automated access; account-owner approval does not establish a provider exception for a bulk submission/extraction workflow. No documented public API was found. This check did not inspect hidden endpoints or reverse engineer software or scoring curves.

## Draft request, not sent

To: privacy@faceiqlabs.com; terms@faceiqlabs.com

Subject: Complete analysis export and permission for a bounded comparison pilot

I used Account > Data Export, but my ZIP contains photos and face metadata without the analysis measurements, scores or landmark coordinates. Can you supply a private JSON or CSV export containing my existing analyses' front/side landmark coordinates, image dimensions and coordinate convention, metric names and values with units, scores, report dates and any recorded version/reference information? Please identify any fields that are unavailable.

Separately, I develop TrueMax and would like to compare the visible measurements produced by the two products using 20 synthetic adult identities, each with a front and side image. May I use an AI browser assistant in my own paid account to submit this bounded set and collect my resulting reports? Please confirm whether you permit this use and any rate, credit, export or reuse restrictions. This is not a request for your source code or proprietary algorithms. I will not start the automated batch until you confirm the permitted scope.

## Study remains separate

The 40-image TrueMax diagnostic batch is complete locally. Its scores are not anatomical truth, and the synthetic pairs have not been independently verified for cross-view consistency. Export access or competitor agreement alone cannot establish placement accuracy. The template-backed gonial-angle cluster remains an unresolved placement issue documented in the post-267 audit; no new scoring ideals have been fitted to it.
