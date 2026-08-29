# TrueMax TikTok Breakdown — Master Plan

## Status

The existing reel/rundown creator is a scaffold, not a finished deliverable. The Stage 0/1 identity, validation, and scoring work did not complete or verify this feature.

## Goal

Generate a polished 9:16 facial-analysis video that feels native to TikTok/Reels, renders smoothly, keeps the face prominent, and exports reliably with synchronized sound.

## Build order

### T1 — Restore the creator workflow

- Restore visible clip and photo import controls.
- Support multiple clips/images, replacement, removal, drag reordering, and a clear empty state.
- Restore editable before and after scores with canonical 0–10 validation.
- Preserve creator inputs across accidental navigation and recover interrupted drafts.
- Show a live 9:16 preview matching the exported composition.

### T2 — Deterministic render pipeline

- Render at 1080×1920 with a fixed timeline and stable frame cadence.
- Pre-decode images, fonts, audio, and overlays before rendering begins.
- Replace timer-dependent animation with timestamp-driven animation.
- Prevent duplicated, skipped, or out-of-order frames.
- Provide a high-quality primary exporter and an explicit compatibility fallback.
- Report real progress, cancellation, failure, and retry states.

### T3 — Premium visual sequence

- Use a true black background with a large, face-first composition.
- Automatically crop and position each photo without cutting off the forehead, chin, or profile.
- Add manual crop/zoom/position controls when automatic framing is wrong.
- Begin unloaded imagery as a stable blurred placeholder, then resolve blur-to-sharp without layout shift.
- Use smooth crossfades, masked reveals, restrained scale/position motion, and consistent easing.
- Reposition the face upward before the analysis values enter below it.
- Draw clean neon TrueMax measurement lines from the actual landmarks, with controlled glow and progressive line animation.
- Reveal measurements in a deliberate line-by-line sequence.
- Prefer one-word or very short labels over sentence captions.
- Use clean score count-up and before/after reveals without exaggerated ratings.

### T4 — Audio and timing

- Add restrained transition, line-draw, keyboard/typewriter, impact, and score-reveal sounds.
- Schedule audio against the same master timeline as the visuals.
- Normalize levels and prevent clipping.
- Verify audio remains synchronized throughout the final MP4.
- Keep voiceover optional; the default breakdown must work without narration.

### T5 — Export and device quality

- Export a social-ready MP4 where supported, with a clearly labelled fallback only where required.
- Keep the still-image download as a separate action.
- Test Chrome, Safari, iOS, Android-sized viewports, and lower-powered devices.
- Prevent double renders, stale exports, frozen progress, and downloads from a previous scan.
- Include filename, duration, resolution, codec, and estimated size before download.

### T6 — Verification fixtures

- Test portrait, landscape, tightly cropped, loosely framed, front, and side images.
- Compare output frame-by-frame against the preview timeline.
- Check for dropped frames, uneven motion, blank frames, crop jumps, font flashes, and audio drift.
- Add regression tests for clip ordering, editable scores, stale scan isolation, cancellation, and repeated exports.
- Produce and manually review at least three finished example videos before marking complete.

## Acceptance criteria

- Creator controls are obvious and usable on desktop and mobile.
- Uploaded assets can be added, reordered, replaced, and removed.
- Before/after scores are editable and never silently recalculated to inflated values.
- The face occupies most of the 9:16 frame without accidental cropping.
- Motion appears smooth at the target frame rate with no obvious stutter.
- Blur placeholders resolve without layout jumps.
- Measurement lines align with the displayed facial landmarks.
- Audio is synchronized and balanced.
- Preview and downloaded output materially match.
- Repeated exports never reuse another scan or an earlier user's media.
- The feature is not labelled complete until browser/device checks and three reviewed exports pass.
