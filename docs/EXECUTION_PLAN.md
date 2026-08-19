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

## Phase 0 — Secure the Codex worktree (BLOCKING, runs on the laptop)

**Status: not done. Everything else is gated on it.**

The Stage 0/1 slice Codex built — identity isolation, immutable scan IDs,
claim tokens, relaxed photo validation, canonical 0–10 display, the privacy
GET/DELETE feedback APIs, and three Supabase migrations — exists **only as
uncommitted changes in the local worktree**. As of this plan, `origin/main`
is at `5b055f8` and every `codex/*` branch predates that work.

Meanwhile the three migrations are already applied to the **live** Supabase
database and the production Vercel deployment was built from that uncommitted
source. If the worktree is lost, the repository and production disagree
permanently, with no record of what the schema hardening was.

The same slice touched `analysisMode.ts`, `photoEligibility.ts`, `quick.ts`,
`results.ts`, `main.ts`, `auth.ts` and ~25 more files — the exact files
Phases 1 and 2 change. Building on the remote tree before syncing guarantees
a painful merge and possible silent regressions in the privacy work.

**Steps (on the machine with the dirty worktree):**

1. `git checkout -b codex/stage-0-1-isolation`
2. `git add -A && git commit -m "Stage 0/1: identity isolation, scan lifecycle, photo validation, canonical scoring"`
3. `git push -u origin codex/stage-0-1-isolation` and open a PR.
4. Confirm `.gitignore` still excludes the calibration photo directory
   (Codex reported Vercel almost packaged 593 MB of it — verify the ignore
   rule made it into the commit).

**Then (remote side, this session):** pull the branch, audit the full diff —
does the isolation hold, do the 362 tests pass here, did anything regress in
the reel/rundown work — and reconcile it with `main` before any new code.

**Exit gate:** Codex's slice is on GitHub, reviewed, and merged (or
consciously amended), and the repo again matches what production runs.

---

## Phase 1 — Scoring calibration (the trust core)

The product's one non-negotiable claim is that the number means something.
Diagnosis is complete; the evidence below was measured on the shipped code by
running the 19-face rated corpus through the real scorer.

### What is actually wrong (measured, not suspected)

1. **The reference table's top end is too low.** The male overall quantile
   table (`aggNorm.ts`) tops out at aggregate z = **+0.338** — but a corpus
   face humans rate 7.0 measures **+0.604**, and a 7.25 female face lands
   **+0.370 above** the female maximum. The two most attractive faces in the
   corpus both fall off the table. The reference set (people notable for
   work, not appearance) simply contains too few good-looking people for the
   table to describe the range the audience cares about.

2. **The tail extrapolation is a cliff.** Past the table edge, `tailZ`
   extrapolates at ≈ **4.9 σ per unit of aggregate z** (male overall). An
   aggregate of +0.80 — a genuinely attractive but ordinary face — became
   +4.2 σ, i.e. **9.9/10**. That is the reported 9.9: not a measurement
   error, a cliff at the edge of the reference set.

3. **The patch that hid the 9.9 broke the scale.** `SHRINK = 0.4` (PR #125)
   multiplies every calibrated z by 0.4. On the corpus, the displayed range
   for faces humans rate 1.8–7.25 collapses to **4.2–6.7**: a 2.7-rated face
   shows 5.2, the best face shows 6.3, nobody can ever be "chopped" or a
   "mogger", and 8.0 (marketed as "1 in 100") now requires a
   1-in-250-million face. The 0.4 comes from a least-squares fit to the
   corpus — but regression against noisy measurements is attenuated toward
   zero by exactly the noise it should be correcting for. Measured on the
   corpus:

   | calibration policy | slope (score per z) | SHRINK equivalent |
   |---|---|---|
   | naive regression (shipped) | 0.52 | **0.40** |
   | attenuation-corrected regression | 0.73 | 0.56 |
   | variance matching (displayed spread = human spread) | 1.13 | **0.87** |
   | FaceIQ (fitted from their own UI labels) | 1.40 | 1.08 |

   A ranking product needs the variance-matched scale; the regression scale
   answers "what's my safest guess" and produces a product where every
   answer is 5-and-a-bit.

4. **Capture geometry is undefended.** FaceIQ's own capture flow warns that
   an arm's-length selfie costs "−60% accuracy: bigger nose, longer face,
   distorted proportions" and demands rear camera, ~2 m, eye level. TrueMax's
   distance gate checks face *width in frame*, which cannot distinguish 30 cm
   from 2 m. Perspective distortion at selfie distance plausibly moves the
   aggregate by more than the whole width of the current quantile table.

### The fix, in order

- **1a. Rebuild the reference table's top end.** Extend the population set
  with enough consensus-attractive faces (and ordinary ones, keeping the
  median honest) that the male table maximum sits near +0.9 rather than
  +0.34 and extrapolation almost never fires. The photos and the tooling
  (`tools/fetch-photos.mjs`, `rescan-reference.mjs`, `normalize.mjs`) live on
  the laptop — this step runs there; the regenerated `aggNorm.ts` is what
  gets committed.
- **1b. Bound `tailZ`.** Whatever the table, an n≈58-per-sex reference can
  never support a percentile claim beyond roughly the 99th. Cap the
  extrapolated z (≈ +2.4 σ) and soften the slope so falling off the table
  costs at most a few tenths of a point, never a 9.9. This alone kills the
  original bug independent of 1a.
- **1c. Re-fit the scale.** Replace SHRINK 0.4 with the variance-matched
  value **re-fitted after 1a/1b change the z distribution** (expected
  ≈ 0.85–0.95). Keep it named, tested, and re-estimated whenever the corpus
  grows — that rule already exists in `scoring.ts`, it was just fed the
  wrong estimator.
- **1d. Capture-distance defence.** A capture-guidance step in the standard
  flow (rear camera, ~2 m or mirror, eye level — behavioural parity with
  FaceIQ's guidance, written in our words), plus a heads-up warning when the
  photo is likely an arm's-length selfie. Run the controlled experiment:
  same face, arm's length vs 2 m, compare aggregate z; the delta tells us
  how loud the warning must be.
- **1e. Verify the "photo too small" fix** in the synced Codex code against
  the same photos that used to fail.
- **1f. Grow the corpus** (task #47): more rated faces, especially 7+,
  because 19 faces bound every constant in 1c.

### Acceptance criteria

- Corpus displayed mean ≈ human mean (5.1), Spearman ≥ 0.75, and the
  displayed range spans at least 2.5–8.5 for humans rated 1.8–7.25.
- No face lands beyond the quantile table by more than the tail cap allows;
  scores above 9 require in-table evidence, not extrapolation.
- The operator's own face scores within ±0.8 of FaceIQ's 4.5 benchmark under
  FaceIQ-grade capture conditions.
- The same face at arm's length and at 2 m either scores within 0.4, or the
  selfie path carries a visible accuracy warning.

---

## Phase 2 — TikTok Breakdown, premium (T1–T6)

The growth engine. Much of the T-plan already exists; this phase is the
delta, verified the T6 way (frames, not vibes).

**Already built and merged** (do not rebuild): editable before/after scores
that recompute the verdict; verdict descriptor line; custom opening line;
ElevenLabs per-character caption timing; connected-mesh scan at 1080×1920 in
both cuts; side-by-side before/after with separately downloadable breakdowns;
direct file save on desktop; line retraction transitions; sticky CTA
placement.

- **T1 — Creator workflow:** drag reordering, replacement, removal, a clear
  empty state; draft persistence across accidental navigation; a live 9:16
  preview that matches the export composition.
- **T2 — Deterministic rendering:** pre-decode all assets before frame one;
  confirm every animation is timestamp-driven (most already are); real
  progress, cancellation, retry; a labelled compatibility fallback.
- **T3 — Premium visuals:** true-black face-first composition with automatic
  crop that never cuts forehead/chin/profile; manual crop/zoom/position
  override; blurred-placeholder → sharp resolution without layout shift;
  one-word/short labels; restrained count-ups.
- **T4 — Audio:** transition / line-draw / typewriter / score-reveal SFX
  scheduled on the master timeline, normalized, no clipping; voiceover stays
  optional. Verify the merged ElevenLabs alignment against a real narrated
  render — it was merged unverified.
- **T5 — Export & devices:** Chrome / Safari / iOS / Android-width /
  low-power testing; no double renders, stale exports, or media from a
  previous scan; filename, duration, resolution, codec, size shown before
  download.
- **T6 — Verification fixtures:** portrait/landscape/tight/loose/front/side
  fixtures; frame-by-frame comparison against the preview timeline;
  regression tests for ordering, editable scores, stale-scan isolation,
  cancellation, repeated exports; **three finished example videos manually
  reviewed before the feature is called complete.**

Acceptance is the T-plan's own list, unchanged.

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
