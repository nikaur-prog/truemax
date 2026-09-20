# Front camera framing repair

Status: implemented and verified locally on `codex/max-presence-and-conversation`. Not committed, pushed, merged or deployed as part of this change.

## Reported failure and traced cause

The live front guide accepted a face only at 30–62% of the visible frame's width. The camera view is full-screen on both phones and laptops. Its cover-crop coordinate mapping was internally consistent, but the width-only policy was not: a tall phone view imposed a small face-height ceiling, while a wide laptop view required a much taller face. Changing the browser shape could change the distance instruction without changing source detail.

## Local changes

- Front capture readiness now checks source-pixel face width and height, source-edge margins and centering. It does not use preview width or zoom as evidence of detail.
- A sufficiently detailed, complete face is automatically fitted into the preview with one aspect-preserving compositor transform. The same transform maps the debug guide. Mirroring is applied around the viewport, so an off-center fitted image and guide still align.
- Fit changes ease over time, have a jitter deadband, and hold through a short tracking loss. Reduced-motion mode keeps a stationary source view. Camera restart, stream replacement and orientation/viewport changes reset the fit.
- The source starts fully visible until a usable face is detected. Tiny faces are not enlarged to manufacture a green capture lamp. Clipped source anatomy remains a framing warning.
- Front camera acquisition prefers a native mode near 1920 pixels wide rather than asking for a square 1920 by 1920 stream. `resizeMode: { ideal: "none" }` is optional; unsupported browsers may ignore it. Side capture keeps its existing request and guide.
- The photo and burst frames retain the complete native camera dimensions. Preview crop and zoom are not baked into scoring inputs. The front still-photo quality check receives those same dimensions, avoiding contradictory percentage-width advice after capture.

Pose, expression, glasses, exposure and blur rules were not relaxed. Measurements, scoring references and calibration data were not modified by this repair.

## Verification and limits

Pure tests cover phone, laptop and rotated source/view combinations, pixel-detail equivalence, cropped/tiny/invalid inputs, pose and blur blocks, smooth/reduced-motion behavior, and video/guide forward and inverse mapping. Mock-media lifecycle tests cover cancellation, recovery, native capture dimensions, optional constraints and style restoration. All 26 targeted tests and the TypeScript check passed.

`tools/camera-framing-smoke.mjs` also runs the real `startCamera` module and local face detector against a canvas-generated media stream using an existing public synthetic portrait. It passed all four combinations of 390 by 844 and 1440 by 1000 viewports with 1920 by 1080 and 1080 by 1920 sources. It checks actual browser video rectangles against the mirrored source transform, stable fit over repeated frames, unchanged native dimensions, pixel-identical captures before/after a display transform, and stopped tracks/style cleanup. The requests stay local; no real camera permissions or uploads are used.

The width/height floors are capture usability policies, not a validated measurement-accuracy guarantee: up to 240 pixels across and 300 pixels tall, with proportional floors on low-resolution sources. Digital fitting does not measure physical distance, improve source resolution or correct perspective distortion. A close image may still have lens-perspective bias despite passing basic framing. Actual iPhone/Android and laptop-camera comfort still needs a short device check after deployment; automated browser geometry does not prove hardware field of view or autofocus behavior.

The media request follows the native-mode distinction in the [Media Capture and Streams specification](https://w3c.github.io/mediacapture-main/#def-constraint-resizeMode). No assumption is made that a browser must honor an ideal constraint.

## Mobile post-scan framing

- Replaced the shallow mobile strip with a stable 190–340px viewport-sized photo stage. Desktop result layout and its region zoom remain unchanged.
- Front landmarks or reviewed side points define a padded face bounding box. A bounded display transform fits that box into the phone stage, leaving forehead/chin room. Invalid or missing geometry falls back to the complete photo.
- Photo and measurement overlay use identical centred contain geometry and one shared transform. Interactive overlay resolution accounts for magnification so points do not become oversized blurry dots.
- Mobile region taps keep the face framing steady; close-up measurements remain in the detail sheet. Rotation recalculates from source coordinates, with no accumulated zoom drift.
- In short landscape viewports the photo scrolls away and only the category rail stays pinned, preserving space to read.
- Source photos, reviewed coordinates, reports and scores are unchanged. No retained file is cropped, stretched or replaced.

## Verification record

- Full application suite: 2,301 passing, 0 failing, 28 skipped, 1 existing todo. Typecheck and production build pass; existing large-chunk warning remains.
- `tools/photo-framing-smoke.mjs`: public synthetic fixtures, mobile 375×667 and 390×844 plus desktop 1440×1000; front/side switching, region stability, portrait/landscape and desktop resizing, shared overlay geometry, source-photo and report immutability. No API access or private data.
- `tools/camera-framing-smoke.mjs`: actual camera module and local detector with synthetic streams, phone/desktop viewports crossed with portrait/landscape HD sources. Checks stable fitting, original capture dimensions and identical capture pixels regardless of CSS zoom, plus teardown.
- `tools/capture-review-smoke.mjs`: upload/paste and side review remain functional on mobile and desktop.
- `tools/measurement-navigation-smoke.mjs`: front/side detail navigation and celebrity comparisons remain functional on mobile and desktop.

Before calling camera comfort fully verified, check one real front-camera capture on the phone and one on the laptop at a natural distance. Those checks need not repeat the calibration pilot. This presentation/capture repair does not activate a new scoring calibration.
