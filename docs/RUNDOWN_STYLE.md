# Rundown style notes — measured from the reference videos

Three FaceIQ Labs TikToks were dissected frame-by-frame (ffmpeg scene
detection + contact sheets) on 2026-08-19: LeBron James (49.8s), Ryan
Gosling (46.3s), Jalen Hurts (44.8s). All 576×1024 9:16 @30fps. These notes
record the observable grammar of the format so build decisions trace to
evidence instead of memory. Nothing here is their code, data, or formula —
it is what any viewer sees, measured.

## Cut rhythm

- Gosling: a rapid montage hook (cuts every 0.1–0.2s for the first 1.6s),
  then settles to one cut every 2–4s for the analysis.
- LeBron: slower — analytic holds of 4–12s, punctuated by label pops.
- Hurts: holds of 4–6s with paper-texture wipes between sections.

The common shape: **hook fast, analysis steady**, every shot alive with a
slow push-in. No shot is ever static.

## The signature elements

1. **Accumulating trait ledger.** As each measurement lands, a short signed
   trait joins a running list ("+Tall Ramus", then "+Tall Ramus / +Gonial
   Angle", …). Cyan glow for positives, yellow for negatives/cautions. The
   list persists across cuts and photos, so any single frame carries the
   case built so far. This is the single most identifying element of the
   format. → Built: `drawLedger` in rundownFrame.ts, using our tone palette.

2. **Many photos of one subject.** Each metric is shown on the photo that
   displays it best — different eras, events, angles, front and side. The
   measurement follows the subject, not the source photo. → Our B-roll
   cutaways already re-draw the measurement on the cutaway's own landmarks;
   the creator flow should encourage 3+ photos per subject.

3. **Glowing annotation glyphs, not graph lines.** Rounded neon shapes:
   boxes around the eyes, arcs over brows, ovals around the face outline,
   arrows showing the direction a feature "should" move, soft region tints
   (beard area). Progressive draw, segment by segment, synced to the trait
   joining the ledger. Colour matches the trait's sign.

4. **Value chips.** Small filled labels with the measured number ("5°",
   "2.75X", "90°", "+HIGH FWHR") placed at the feature. Green/yellow/red by
   tone, monospace, black text on the fill.

5. **Word-by-word glowing kickers** (Gosling variant): the key phrase only
   — "extremely close set", "should be lower" — lands word by word,
   mid-frame, colour-coded by sentiment. Not full sentences; 3–6 words.

6. **Texture transitions.** LeBron: black frames with white paint speckles
   between segments (stop-motion collage feel). Hurts: paper-texture wipes.
   Gosling: straight cuts with blur-resolves when a new photo enters.

7. **Blur-to-sharp** on new photos, including the opening. → Built:
   `drawOpeningResolve`.

8. **Harmony wrap-up:** a yellow grid mesh over the face for the final
   "facial harmony" line — the one moment the whole-face geometry is shown
   at once. → Our mesh scan already exists in the quick cuts; the rundown's
   curve/card close serves this role.

## What we deliberately do differently

- **Real numbers stay on screen.** FaceIQ's video format mostly shows
  qualitative labels; our bottom chip keeps the metric name, score and band
  visible at all times. That is the product's credibility and it stays.
- **Full-sentence captions remain** (word-timed to the narration). The
  ledger supplements them; kickers may replace them only on beats with no
  narration.
- **Our palette** (mint #8ff3e0 / amber #e8a17a / bone #f7f7f2 on #050606),
  not their cyan/yellow. Same grammar, our brand.

## Still to build from this spec

- Value chips at the feature (element 4).
- Word-by-word glowing kickers for the hook and verdict beats (element 5).
- Textured section transitions (element 6) — needs a texture asset pass.
- Creator-side: encourage multiple photos per subject so element 2 gets
  material (blocked on the quick.ts lane until the Stage 0/1 worktree is
  pushed).
