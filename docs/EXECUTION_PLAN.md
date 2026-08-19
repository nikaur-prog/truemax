# TrueMax Execution Plan

The single ordered plan for fixing and finishing the build. It folds together
the Master Build Plan (Stages 0–15), the TikTok Breakdown masterplan (T1–T6),
the scoring-calibration diagnosis, and the Stage 0/1 work done in the local
Codex worktree. Phases run in order; nothing in a later phase starts until the
phase before it is safe to build on.

Standing rules, restated because every phase touches them:

- No proprietary FaceIQ source, hidden APIs, datasets, or scoring formulas are
  copied. Their product is used only as a benchmark of observable behaviour.
- Ethnicity is never inferred from a photograph and never used to produce
  different attractiveness standards. FaceIQ asks for ethnicity ("Beauty
  ratios differ across ethnicities"); TrueMax deliberately does not, per its
  own build plan. One reference table per sex, capture discipline instead.
- No cross-user photo, scan, conversation, or subscription state is ever
  returned.
- Marketing copy never claims things that are not true.

---

## Phase 0 — Secure the Codex worktree — **DONE**

The Stage 0/1 slice existed only as uncommitted changes on one laptop while
its migrations were already live in Supabase and production had been deployed
from it. It is now on GitHub as `codex/stage-1-privacy-state-integrity` and
merged into this branch.

Audited rather than trusted: merges clean, 365 tests pass here, typecheck and
production build green, and the scoring calibration work is unaffected — the
corpus audit reproduces the same numbers after the merge. The scan-credit
privilege migration is the strongest piece, removing PostgreSQL's inherited
PUBLIC execute grant, pinning `search_path = ''` inside a SECURITY DEFINER
body, failing closed with no authenticated caller, and decrementing in one
guarded atomic update.

Its 0–100 → 0–10 display change is orthogonal to the calibration internals.

---

## Phase 1 — Scoring calibration — **DONE, with a named residual**

The one non-negotiable claim is that the number means something. All of the
following was measured on this tree, not assumed.

### What was wrong, and what fixed it

1. **The 9.9.** The male overall table topped out at aggregate z +0.338 while
   real attractive faces measured past it, and `tailZ` extrapolated beyond the
   edge at ~4.9σ per unit with no ceiling. **Fixed**: the tail now saturates
   smoothly at `TAIL_Z_MAX` (2.6 ≈ probit(1−1/2n)), entering at the table-wide
   average slope rather than the noisiest outer bin.

2. **A second defect the first one masked.** Inside the table, position mapped
   straight through probit with a 0.999 clamp, so a face just *inside* the top
   bin claimed +3.09σ while a face *at* the maximum took the tail's +1.98σ — a
   non-monotonic step the steep tail happened to leap back over. **Fixed** with
   a plotting-position rescale into [0.5/(k+1), 1−0.5/(k+1)], which also makes
   the handover continuous.

3. **The percentile was not a percentile.** It was Φ(SHRINK × tableZ), so a
   face measured at the top 0.2% of the reference set printed as "Top 12%".
   Confirmed independently from production use. **Fixed** by the recalibration
   below.

4. **The reference table was too small and too narrow.** **Fixed**: rebuilt
   from 64 men and 76 women measured through the real engine; the male overall
   span reaches 0.435 (was 0.338) and the female reaches −1.188 (was −0.928).

5. **The scale was collapsed.** `SHRINK = 0.4` came from a noise-attenuated
   regression fit and squeezed faces humans rate 1.8–7.25 into 4.2–6.7. The
   rebuild alone made this *worse* — a wider table with the old SHRINK gave a
   1.9-point span and tripped `calibration.test`'s guard. That paired
   constraint (span ≥ 2 **and** |mean error| ≤ 0.75) is what forces the honest
   answer: neither the scale nor the centre can be set alone.

### The calibration as it now stands

Each source is used for what it can actually support:

- the **reference photographs** give the distribution's SHAPE (the quantile
  table);
- the **rated corpus** gives where 5.0 sits (`CENTRE = 0.87` σ) and how wide a
  point is (`SHRINK = 1.13`, by variance matching).

Both are fitted by `tools/fit-scale.ts` and **must be re-fitted together**
whenever either source changes.

Outcome on the rated corpus: displayed range 3.4–7.3 against human ratings of
1.8–7.25, mean 5.35 against 5.09. And 8.0 now means 1 in 91 — the "1 in 100"
the product advertises — where before it required one face in 250 million.

### The residual, named rather than buried

A hypothesis died here: the female table's centring was blamed on its small,
once smile-biased sample, and going to 76 women did not move it. The cause is
**population composition, not sampling error** — the reference people are
notable for their work and mostly middle-aged, and these metrics read youthful
structure as better. Hence a centre constant existing at all.

Women still read about half a point high, and the corpus is 19 faces. The
durable fix is a larger rated corpus, especially women and especially faces
rated 7+; task #47 and #51 carry it.

### Still open in this phase

- **1d. Capture-distance defence.** FaceIQ's own flow warns an arm's-length
  selfie costs accuracy; our distance gate checks face *width in frame*, which
  cannot tell 30cm from 2m. Needs capture guidance plus the controlled
  experiment (same face, arm's length vs 2m).
- **1f. Grow the corpus** (#47) — the binding constraint on every constant above.

---

## Phase 2 — TikTok Breakdown, premium (T1–T6)

Three reference rundowns were dissected frame-by-frame; the measured grammar
of the format is in `docs/RUNDOWN_STYLE.md`. Build against that document.

**Already built and merged** (do not rebuild): editable before/after scores
that recompute the verdict; verdict descriptor line; custom opening line;
ElevenLabs per-character caption timing; connected-mesh scan at 1080×1920 in
both cuts; side-by-side before/after with separately downloadable breakdowns;
direct file save on desktop; sticky CTA placement.

**Built this session**, verified in rendered frames rather than by tests:

- Slow push-in on every full-bleed beat, applied to the crop so measurement
  overlays stay on the feature, releasing into the crop's move to the next
  region so boundaries do not jump.
- Opening blur-to-sharp resolve over the whole frame.
- Cutaways dip in and out through the frame's own black, the measurement line
  riding the same ramp.
- Card score/ceiling count-up and staggered region-bar sweeps; the rarity
  figure deliberately holds still.
- The **accumulating trait ledger** — the signature element of the reference
  format, and the thing that makes a mid-video arrival see a case rather than
  a fact.
- One-word captions replacing the paged paragraph, with word timing and the
  keystroke cues driven from one shared `wordStarts()` so sound and glyph
  cannot drift; bottom chrome lowered to give the face the frame back.

**Remaining:**

- **T1 creator workflow** — drag reorder, replace, remove, empty state, draft
  persistence, live 9:16 preview. *Unblocked now that the Stage 1 work has
  landed in `quick.ts`.*
- **T3** — manual crop/zoom/position override; automatic face-first crop that
  never cuts forehead/chin.
- **Style spec leftovers** — value chips at the feature, word-by-word glowing
  kickers, textured section transitions, and creator-side encouragement to
  supply 3+ photos per subject so the multi-photo grammar has material.
- **T5** — device matrix; no double renders, stale exports, or media from a
  previous scan; filename/duration/resolution/codec/size shown before download.
- **T6** — fixtures across portrait/landscape/tight/loose/front/side;
  frame-by-frame comparison against the preview; regression tests for ordering,
  editable scores, stale-scan isolation, cancellation, repeated exports; **three
  finished example videos manually reviewed before this is called complete.**
- **Beat-sync**: a BPM field so cut points can quantize to a music grid. Real
  beat detection is not worth building; a number the operator types is.

---

## Phase 3 — Master plan remainder (Stages 2–15)

In dependency order, after Phases 1–2:

1. **Stage 1 exit items still open** (from Codex's own report): live
   incognito / two-device / back-button / OAuth-return browser matrix;
   per-submission consent revocation verified end-to-end; Stripe
   configuration probe and webhook delivery check.
2. **Stage 2 — Capture:** multi-face rejection, canonical
   normalization/crop/rotation/mirroring, weighted confidence with explicit
   lower-confidence continuation, fixture-based acceptance rates. (Overlaps
   Phase 1d; do them together.)
3. **Stage 3 — Landmarks:** stronger side-contour pipeline, per-point
   confidence, correction magnifier with live recomputation.
4. **Stage 4 — Scoring programme:** versioned measurement registry,
   independent confidence/uncertainty per metric, redundancy groups, the
   repeat-photo fixture set that closes the remaining scoring TODO, and the
   documented calibration programme (Phase 1 is its first entry).
5. **Stages 5–14 — Release completeness:** results polish, Max architecture,
   plan/entitlement QA, auth email QA, Stripe lifecycle tests, observability,
   legal, accessibility, launch checklist.
6. **Backlog carried forward:** per-metric scoring curve + ranked metric list
   (#41), blurred results teaser (#42), shareable VO analysis growth loop
   (#44, parked).

---

## How progress is tracked

- **One PR per slice**, always on top of the synced tree; tests + build green
  before each push; every PR description states what changed, what was
  verified and how, and what remains.
- **Division of labour:** everything in the repository is buildable from this
  session. Three things need the laptop: the calibration photo set (1a and
  1f), live device/browser matrices (T5, Stage 1 exit), and Supabase
  dashboard operations. Those are called out inline above.
- **Definition of done per phase** is its acceptance list — a phase is not
  reported complete until its list passes, and anything skipped is named.
- After each merged slice: a short status recap against this document, so
  drift between plan and build is visible immediately.

**Order of execution: Phase 0 → Phase 1 → Phase 2 → Phase 3.** Phase 0 is a
day of ceremony that protects weeks of work; Phase 1 is what makes the number
trustworthy; Phase 2 is what markets it; Phase 3 is what makes it a product
rather than a demo.
