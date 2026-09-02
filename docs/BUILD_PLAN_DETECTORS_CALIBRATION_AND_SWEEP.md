# Build plan: the detectors, the calibration loop, and the sweep

Written 2 September 2026, after #229 (the run-through plan) and #230 (the
eight Max fixes) merged. This is the execution plan for what the owner asked
for next, in three parts:

1. **Build the detectors.** A skin visible-pattern detector, and the
   soft-tissue measurement class that answers "facial fat" honestly.
2. **The calibration loop, with the image.** When a person says yes to
   sharing, the photograph and both sets of points go in, and the system
   learns from them the way a person reviewing them would, automatically,
   with a guard.
3. **What the sweep says to improve**, cut into pull requests in the order
   that returns the most to a paying member soonest.

Every item carries its file, its gate and its definition of done. Nothing
here contradicts a standing decision in `CLAUDE.md`; where an item touches
one, it says so. The findings themselves live in
`PREMIUM_REVIEW_AND_MAX_PLAN.md` (section 4 and the generated P1 backlog in
section 6); this document does not repeat them, it schedules them.

---

# 1. The detectors

## 1.1 What exists today, exactly

- `src/engine/skin.ts` computes five statistics on the front photograph
  (tone spread, redness spread, chroma spread, texture, under-eye ratio),
  each relative to the person's own skin after flat-fielding, on a face
  resampled to a fixed 220-pixel width so a phone and a webcam land in the
  same units. It localises nothing. It is called from the developer probe
  in `src/main.ts`, and its output reaches no report, no score and no plan.
- `src/engine/skinConcernCatalog.ts` maps eighteen visible families to safe
  actions and marks four as "trial" (comedonal, inflamed-spot, milia-like,
  and post-blemish colour); everything a person sees today comes from what
  they declared in the quiz.
- On soft tissue: `cheekFullness` already measures the cheek outline's
  excursion from the bone chord (the front silhouette points 234/132/454/361
  against the jaw corner, which the geometry file names as the only thing in
  a frontal photograph that reports facial fat), `chinWidthRatio` and
  `jawCheekRatio` sit beside it, and `submentalCervical` measures the
  under-chin angle on the profile. They are scored inside pillars; nothing
  presents them as a class, and nothing tracks them as the thing a person
  asking about "facial fat" wants to watch.
- Body fat is a number the person types (`bodyProfile.ts`). Max is told the
  scan cannot see it.

## 1.2 The soft-tissue class (facial fat, answered as measurement)

**What it is.** A named group on the report, "Soft tissue", that shows the
measurements a face's fat and fluid actually move, tracked scan to scan, in
measurement units, with no percentage and no verdict word that names fat.

**Measurements in the group.**

| id | view | what it reads | source |
|---|---|---|---|
| `cheekFullness` | front | cheek outline excursion from the bone chord | exists |
| `jawCheekRatio` | front | jaw width against cheekbone width | exists |
| `chinWidthRatio` | front | chin width against jaw width | exists |
| `submentalCervical` | side | under-chin angle at the neck point | exists |
| `submentalDepth` | side | how far the under-chin contour sags below the chord from menton to cervicale, as a fraction of face height | new: the profile segmentation mask (`sideMask.ts`) already gives the face's lower edge per column; sample it between the two points |
| `lowerFaceWidthRatio` | front | width at the mid-cheek silhouette against bizygomatic width | new: points 132/361 against the bizygo pair, same construction family as `cheekFullness` |

**Rules.**

- Measurements, deltas and a plain sentence ("Your under-chin depth moved
  from 4.1 to 3.6 percent of face height since June"). Never "body fat",
  never a percentage of anything but face height, never a verdict word.
- The two new measurements are seeded low in `reliabilitySeed.ts` and earn
  a real reliability from the repeat-photo corpus (task #82) before they
  carry weight anywhere. Until then they are shown with the "indicative"
  flag the report already uses.
- Nothing in the group changes the structural score. `cheekFullness` keeps
  its existing pillar weight; the group is a presentation, not a pillar.
- Max receives the group in the scoped block as measurements, with the same
  sentence rule, so "is my face fat" gets "here is what moved" rather than a
  guess.

**Gate.** Repeatability on the repeat-photo corpus at or above the median
front metric before either new measurement leaves "indicative".

**Effort.** Two to three days engine and report, plus the corpus run.

## 1.3 The skin visible-pattern detector

**What it detects, in the catalogue's words.** Four visible patterns, each
a region and a confidence, never a condition:

| pattern | signal | region logic |
|---|---|---|
| visible inflamed-spot pattern | small blobs where the flat-fielded redness (Lab a*) sits well above the person's own spread, with a lightness dip or rise at the same place | connected components between about 2 and 14 pixels at the 220-wide sample, counted per zone (forehead, each cheek, nose, chin) |
| visible dark-spot pattern (post-blemish marks) | small blobs where flat-fielded lightness sits well below the person's own spread with low chroma change | same components logic, separate class |
| visible redness pattern | diffuse a* elevation over the cheeks and nose against the forehead and jaw, measured as a zone contrast rather than a blob | zone means on the flat-fielded a* field |
| uneven pigment pattern | mid-frequency patches in a* and b* (a band between the blob scale and the illumination scale) | patch area fraction per zone |

**How it is built.** On top of `analyzeSkin`, which already produces the
masked, flat-fielded L, a and b fields and the person's own robust spreads.
The detector adds a band-pass step, a threshold in units of the person's own
spread (so skin tone cannot enter), connected components, zone assignment
from the mesh rings the file already walks, and a confidence that falls with
low coverage, softness, blown exposure, a strong colour cast or a filter.
Everything stays on the device; no photograph leaves it for detection.

**What the person sees.** A "Visible skin patterns" block on the report,
labelled trial, listing only patterns above threshold with their zones and
confidence, an "image may be affecting this" state when confidence is low,
and "unable to assess" below the eligibility gate. Wording is the trial
document's: "visible inflamed-spot pattern", never "acne". Absence of a
pattern is never printed as "clear". No pattern changes the structural
score. Actions come from the catalogue exactly as they do for self-declared
concerns, with one addition: a detected pattern the person did not declare
asks them to confirm it before its actions join the plan, and their answer
is a label.

**Validation, in order.**

1. Unit tests with synthetic fields (a known blob at a known place must be
   found; a smooth gradient must not).
2. Repeatability on the existing repeat-photo corpus: the same face on two
   days must agree on presence and zone at the trial document's threshold.
3. A consented collection: a new consent naming skin analysis, storing the
   front photograph, the detector's output and the person's confirmation for
   90 days under the same lifecycle as the side feedback (private bucket,
   revoke, cron cleanup). This is the labelled set at scale, and it is weak.
4. A dermatologist-labelled subset, a few hundred faces balanced across skin
   tones and age bands, as the gate. This is a purchase and calendar time,
   and the plan cannot substitute for it: synthetic faces are permitted for
   placement geometry only and are not skin ground truth in any case.
5. Per-class sensitivity and precision on a subject-held-out set, agreement
   on repeat photos, and no subgroup more than a tenth below the whole,
   before the trial label comes off.

**Shipping stages.**

| stage | what ships | who sees it |
|---|---|---|
| A | engine, tests, a developer probe that draws the components on the face | nobody |
| B | the report block behind an account flag | the owner, then staff |
| C | the consent and the collection, the confirm-a-pattern question | members who opt in |
| D | the trial label for everyone above the eligibility gate | all adults |
| E | the label without "trial", per class, when its gate passes | all adults |

**Effort.** A week for A and B. C is a few days on top of the side-feedback
lifecycle that already exists. D waits on repeatability. E waits on data.

**What it is not.** Not a diagnosis, not a lesion counter shown as a
number, not a classifier of conditions, and not an input to the score.

---

# 2. The calibration loop, with the image

## 2.1 What the owner is asking for, and the answer

The question was whether the person can say yes to sharing so that the
photograph goes in with the points, and the system learns from it the way a
person reviewing it would. Two things are true:

- **That is already what consent collects.** The dialog in `sideFlow.ts`
  asks for the side photograph, the automatic points and the confirmed
  points, and the submission stores exactly that plus the face direction and
  the seed method version (`api/side-correction-feedback.ts`), privately,
  for 90 days, with revoke and cron cleanup.
- **Nothing learns from it.** The rows wait for a person to run
  `scripts/analyze-side-feedback.mjs` by hand. It reads the points only,
  never the photographs, prints per-landmark medians and a rule, and emits a
  block to paste in. The photographs are for a human relabelling session
  that does not happen.

So the build is not a new consent for a new thing. It is the learner that
the consent has been promising.

## 2.2 The learner

**Every consented pair becomes a training example.** The photograph is the
input; the confirmed points are the answer; the automatic points are where
the current seeder was wrong. That is precisely what a keypoint model
trains on, and it is precisely what the segmentation template cannot use,
because the template has no way to look at an ear. The model is step C of
the side plan in `PREMIUM_REVIEW_AND_MAX_PLAN.md` 1.1; the consented pairs
are its real-world half, alongside the labelled synthetic profiles.

**The nightly job.** A protected cron on the same pattern as
`cleanup-side-correction-feedback`, service role, that on each run:

1. Computes, per seed method version, the accept-without-drag rate and the
   per-landmark median error in unit-face space over all unexpired rows, and
   writes them to a small `side_seed_metrics` table. That is the 80 percent
   number, live, per version, and the report the owner has been producing
   by hand.
2. Writes a durable, photo-free calibration record per row (both point sets
   normalised, face direction, head-size features, seed method), kept after
   the photograph expires. This needs one sentence added to the consent:
   that the point coordinates are kept after the photo is deleted, and that
   Revoke removes both. Until that sentence ships, the record expires with
   the photo.
3. Exports each consented photograph and its points, inside the 90-day
   window, into the training and evaluation split (by subject, so a person
   is never on both sides) in a private training bucket with the same
   lifecycle, and records the export on the row. The consent already names
   improving placement as the purpose; the revised sentence names training
   a model as the means.
4. When the analysis rule is met for a landmark (25 movers, median larger
   than half the spread), opens a pull request with the proposed offset as a
   generated data file and the before-and-after error on the held-out rows.
   A person merges it. Nothing changes in production without that step.

**The model.** A small heatmap keypoint model for the thirteen points at
256 pixels, trained on the labelled synthetic set plus the consented pairs,
evaluated only on consented pairs it has never seen, exported for on-device
inference (a few megabytes, well under 100 ms), with the segmentation seed
kept as the fallback when the model's confidence is low or it disagrees
with the mask beyond a threshold. It ships when it beats the current seeder
on the held-out consented set on both the accept rate and the ear-cluster
error, and the nightly job then tracks it as one more seed method version.

**The outcome for everyone.** Independent of consent, every side scan
records one photo-free event: accepted, corrected, or skipped. That is the
denominator the accept rate needs, and it needs no photograph. Decision 5
of the previous plan (ask the photo consent before the placement is shown)
still stands as the owner's call; the event ships either way.

## 2.3 What the owner keeps doing, and what stops

The Calibrate exports to `docs/calibration-incoming.json` continue to be
worth it for the front, where the corpus is the reference set and consent
does not apply. For the side, once the job runs, hand review of individual
rows stops being the path; the owner reviews pull requests instead.

**Effort.** Consent sentence and outcome event, a day. Nightly job and
metrics table, two to three days. Training pipeline and evaluation harness,
a week; the model itself is calendar time on labelling and on rows arriving.

---

# 3. The sweep, as pull requests

The fourteen surface reads produced 29 blockers after deduplication (the
generated backlog in `PREMIUM_REVIEW_AND_MAX_PLAN.md` section 6) and about
140 further rows. Two of the blockers are already closed by #230 (the poke
freeze and the reduced-motion strobe) and two are overridden by the owner's
call on Max's body. The rest are cut into pull requests below, each small
enough to review in one sitting and each validated with the four gates
(`npx tsc --noEmit`, `npm test`, `npm run build`, `node scripts/emdash.mjs`)
plus a browser pass on the surface it touches.

| PR | name | what is in it | rows |
|---|---|---|---|
| S1 | Promises | Coach-tab chats and reopened threads built from the latest own scan (`maxTab.ts:204`); the benefit line "Up to 30 messages a day" with the count under the composer and a local reset time (`maxTab.ts:76`); the two count-rarity sentences rewritten in the plain register through `statedPct` with a template test (`templates.ts:189`, `:501`); the review furniture mounted only on the No branch and the section inert under a side dialog (`sideFlow.ts:1535`); the dialog fine print made true (`sideFlow.ts:1620`); the retake path that keeps the scan's answers (`main.ts:2011`) | 7 |
| S2 | First scan | Segmenter warmed with the landmarker, narrated, and bounded by a timeout that skips the optional check (`headCovering.ts:10`); the scan stage painted the instant a file is chosen, with errors in a dialog rather than an all-caps line (`main.ts:1745`); the reading band on a transform; a yield between the five detection passes, with the worker as a follow-up (`consensus.ts:39`); stale rejection copy cleared on reset | 4 |
| S3 | Onboarding and dashboard | One required card at signup and the rest optional with Skip (`onboarding.ts:154`); the email error branches (`auth.ts:490`); scan rows that do one thing (`dashboard.ts:272`); the due sentence and the deadline beside New scan (`dashboard.ts:428`); the dashboard opened before the three network reads land; the "scans stay on this device" truth in both empty states | 6 |
| S4 | Type, colour and motion | A fixed type scale as tokens with an 11 px floor; two accent tokens; the wordmark states at real contrast (`style.css:178`); the League page loading its fonts (`league.css:33`); motion tokens and a `leave()` helper so overlays animate out; the dialog rings visible at inspection size (`sideFlow.ts:1784`) | 5 |
| S5 | League and Cast | The tools card no longer promising a 4K upscale (`league/main.ts:1229`); a Stop while filming and no spend into a hidden panel (`quick.ts:3458`); the scene set held across a portrait redo (`quick.ts:3629`); the Clips Library door seeded or hidden (`league/main.ts:1243`); exports through `saveFile` so iOS gets the file (`beatReelPanel.ts:1654`) | 5 |
| S6 | Landing | The capture buttons inside the first viewport on a laptop (`style.css:244`); the wordmark as static text and the version tag gone (`index.html:85`) | 2 |
| M1 | Max's mind | Memory facts table with the settings list and per-row delete; plan reconciliation instead of insert-only; the quiz profile in the scoped block; the verdict ladder and rarity bar in the prompt; the em dash scrub on the stream; the truncation guard; the loosened plan-memory parser and the recorded-this-turn line; the chat edge states (draft kept, Stop, 402 to paywall, Escape); delete and archive for threads | from #229 3.2 and 3.3 |
| M2 | Coach tab and plans | The check-in as a Max card at the top; plan rows as controls with the next date; the two-column layout above 1100 px; the plan object and its renderer; "Create a plan" producing addable pills | from #229 3.4 and 3.5 |
| M3 | The shelf | The verified iHerb links with harshness, pairing and label directions, the search kept as fallback, and the checker corrections (Differin quotes trimmed to what the label says; Vanicream "liberally" kept; product names as the listing prints them) | from #229 3.6 |
| M4 | Max in 3D | Turnaround sheet with pupils for the owner's approval; the rendered move set; pre-rendered loops; the 88 px gate already in place | from #229 2.2 |
| D1 | Soft tissue | Section 1.2 | |
| D2 | Skin patterns, stages A and B | Section 1.3 | |
| D3 | Skin consent and collection, stage C | Section 1.3 | |
| C1 | Calibration loop | The outcome event, the consent sentence, the nightly job and metrics table, the export to the training split, the pull-request proposer | Section 2 |
| C2 | The keypoint model | Synthetic labelling, training, evaluation harness, on-device export, fallback | Section 2 and #229 1.1 C |

The remaining P2 and P3 rows ride along in whichever of these touches
their file; none of them is scheduled on its own.

# 4. Order

The order is by what a paying member notices first, with the two long-lead
items (labelling for C2, data for D3 onward) started immediately because
they are calendar time rather than engineering time.

| week | ships | starts in the background |
|---|---|---|
| 1 | S1, S6, D1, C1 | synthetic profile generation and labelling for C2 |
| 2 | S2, S3, D2 | consent copy for D3 to the owner for approval |
| 3 | M1, S4 | dermatologist labelling scope and quote for D3 onward |
| 4 | M2, M3, S5 | |
| 5 | D3, C2 evaluation harness | |
| 6 onward | M4, C2 model when it beats the seeder | |

One PR per item, squash-merged; the dev branch is reset from `origin/main`
after each merge per the working agreement once #226 has landed, and until
then each item goes on its own branch, as #229 and #230 did.

# 5. What needs the owner

1. **The consent sentence for the side loop** (section 2.2, point 2):
   approve the wording that the point coordinates are kept after the
   photograph is deleted and that training a model is the means.
2. **Whether to ask the photo consent before the placement is shown**
   (decision 5 of the previous plan). The outcome event ships either way.
3. **The skin consent wording** (D3) and, later, the labelling budget that
   turns the trial label into a plain one (D3 onward). Without the budget
   the detector stays labelled trial indefinitely, which is honest and
   allowed.
4. **The turnaround sheet for Max** (M4) before any render.
5. **Real hand-placed profiles from eight to ten people**, still the only
   input the side norm refit can use.

# 6. Definition of done, for every item

- The four gates pass and a browser pass on the touched surface is
  recorded in the pull request.
- No em dash in any user-facing string; no verdict word off the plain
  ladder; no rarity stated about a person; no model identifier in any
  pushed artefact.
- A detector shows nothing it cannot support: "unable to assess" below the
  gate, "trial" until the class passes, no effect on the score.
- Every measurement the soft-tissue class prints has a reliability from the
  corpus or carries the indicative flag.
- The calibration job never changes placement in production without a
  merged pull request carrying the evidence.
