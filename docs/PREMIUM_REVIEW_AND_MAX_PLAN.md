# The premium run-through, Coach Max, and the side profile

Written 1 September 2026 after a full pass over the app as it is built at
`68b40e2` plus #226, driven in a real browser against a local build, with
fourteen surface reads and a product-link sweep run in parallel. This is the
plan the owner asked for: what is wrong, what a premium version of each surface
looks like, what Max becomes, how his memory works, how plans and product
links work, and the honest answer on side-profile placement, scores and skin
detection.

Nothing in here contradicts a standing decision in `CLAUDE.md`. Where a
proposal touches one, it says so and leaves the call to the owner.

---

# 0. How this was produced, and what it could not see

- The build was served locally (`vite preview`) and driven in Chromium at
  1280x900 and 390x844. Forty-five captures live in the session scratchpad
  and are described in its `shots/README.md`.
- A guest scan ran end to end: front upload, confirm, side upload, automatic
  placement, "Do these points look right?", consent, and the signup wall.
- The sandbox cannot reach Supabase, so nothing behind sign-in (the report,
  the dashboard, the Coach tab, League tools, live Max replies) could be
  captured fresh. Those surfaces were read from code, from older captures made
  earlier in the same session, and from the owner's own screenshot of the
  production Coach tab.
- Every state of Max was rendered from the current code and frozen at two
  points in each animation, beside contact sheets of four Higgsfield mocap
  clips (boxing, knock-back, idle, confused) as the reference bar.
- Fourteen surface reads were commissioned, each under a rule that a finding
  must point at a file and line the reader opened or a capture they looked
  at. Section 4 prints how many have landed; the P1 backlog in section 6 and
  the cycles are generated from whatever has landed, so a late read cannot
  strand a blocker. A refute pass was planned behind the readers; on this
  machine the workflow runs two agents at a time, so findings marked "reader"
  have not had an independent refuter over them and should be checked at the
  cited line before work starts. Rows marked "confirmed" were reproduced in
  the browser or at the cited code by the author of this document.
- The readers worked on the dev branch tree (68b40e2 plus #226). Every file
  and line citation in this document is validated by a script against the
  branch the document sits on (main plus this file) before each push, and any
  citation that drifted is relocated in the generator rather than left to
  rot. The auth error-mapping row in 4.6 is one such relocation: #226 adds
  lines to `auth.ts`, so the reader's line did not exist on main.

---

# 1. The owner's three questions

## 1.1 Side placement: what actually gets it to 80 percent

**What "80 percent" should mean.** Pick the product number, not a research
one: the share of automatic placements a person accepts without dragging a
single point. That is what a user experiences, and the app can already measure
it for free from the consented feedback rows (`moved_point_ids` in
`side_landmark_feedback`). Underneath it, keep a technical number for the
engineers: a point counts as placed when it lands within 2 percent of head
height for the nine profile-line points and within 4 percent for the four
ear-cluster points. The ear cluster is where the error lives today: 6 percent
of head height at the median on the labeled set, 20 percent at the tails
(`src/engine/sidePrior.ts`).

**Why nothing off the shelf solves it on its own.** The thirteen TrueMax
points (trichion, glabella, nasion, pronasale, subnasale, labiale superius and
inferius, pogonion, menton, cervicale, gonion, condylion, tragion) are a
soft-tissue cephalometric scheme. No public landmark model emits it. The
common schemes are frontal or three-quarter (MediaPipe's 478-point mesh,
dlib's 68, WFLW's 98) and the mesh the app already ships visibly disappears at
a true profile, which is why the side gate falls back to a silhouette check.
The models that do hold up at 90 degrees (the 3D face-alignment family trained
on synthetic large-pose sets, and the 3D head fitters) give a jaw contour and
the nose-lip-chin line, which would help the profile-line points, but they do
not know a tragion from a hairline, and their weights inherit research-only
dataset terms that need checking before commercial use. The 3D head models
that do carry ears (FLAME-based fitters, DAD-3DHeads) are non-commercial by
default. Cloud landmark APIs need the photograph uploaded, which breaks the
"analysis runs on your device" promise the privacy page makes, and none of the
big three offers profile landmarks anyway. Buying a labelled profile dataset is
not an option because none exists for this scheme; the cephalometric sets that
do exist are lateral X-rays.

So there is no engine to pay for. The thing worth paying for is **labelled
profiles of our own points**, and the cheapest source of those is already
permitted by `CLAUDE.md`: synthetic faces, for landmark geometry only, never
for scoring.

**The play, in ROI order.**

| step | what | needs | expected effect |
|---|---|---|---|
| A (experiment, gated) | Test whether the person's own front mesh carries any usable prior for the ear cluster | code only, a few days, plus paired front and side captures to judge it | The honest framing first: the front mesh has no ear landmarks. Points 234 and 454 are the widest point of the facial silhouette at cheekbone height (`src/engine/geometry.ts:106`), 58/288 and 172/397 sit along the jaw outline, and `sidePrior.ts` already records that tragion, condylion, gonion and cervicale cannot be recovered from that edge. So this is a hypothesis, not a promised improvement: that the vertical position of the silhouette's widest point and the jaw outline, after levelling, predicts the ear cluster's heights better than the population template does. It might; it might instead move the cluster with cheek fullness and crop. It earns a place in the seeder only by beating the template on a held-out set of paired front and side captures (the owner's own scans and consenting users' pairs, since the labelled side set has no fronts), by a margin agreed before the run. If it loses, it is dropped and the document says so. It does not enter cycle 1. |
| B | Make every send-through calibrate the seeder, automatically and with a guard | a nightly protected job, a consent-text change, a few days | See "The loop that learns" below. Today a send-through lands in a private table and bucket and waits for a person; the job turns each one into a measured error against the current seed method, a durable photo-free calibration record, and, when the existing rule is met, a proposed offset in a pull request. |
| C | Train a small keypoint model on our own thirteen points. This is the first step in the list that actually observes the ear. | 300 to 600 labelled synthetic profiles, plus the 56 real ones already in `.side-dataset/labels.json`; two to three weeks | A heatmap regressor on a light backbone at 256 pixels, exported for on-device inference (a few megabytes, well under 100 ms). It looks at the ear itself, which the segmentation mask fundamentally cannot: the mask has hair, face skin and body skin, and an ear is texture inside skin. Labelling is done with the Calibrate tool the app already has, at roughly a minute a face. Synthetic faces sidestep consent for training; the real labelled set and the consented rows are the evaluation set, so the synthetic-to-real gap is measured rather than assumed. |
| D | Keep the segmentation seed as the fallback | already built | If the model's confidence is low, or it disagrees with the mask by more than a threshold, seed from the mask and template as today, and say so. |

Do B this cycle and start generating and labelling for C now, because the
labelling is calendar time. Run A as a gated experiment in the background;
it costs a few days and either earns its place with a number or is dropped.
The ordering is deliberate: B makes the target measurable, C is the only step
that reaches the ear cluster by looking at it, and A is a cheap bet whose
outcome is not known.

**The loop that learns.** What happens today when somebody answers yes to
"send this through to our team": the side photograph, the automatic points
and the corrected points are written to `side_landmark_feedback` and a
private bucket, owner-scoped, with a 90-day expiry
(`SIDE_CORRECTION_FEEDBACK.md`). Nothing in the product reads them back.
The one consumer is an offline script, `scripts/analyze-side-feedback.mjs`,
which somebody runs by hand with the service credentials; it prints, per
landmark, how many people moved it, the median correction in unit-face space
and the spread, and applies a written rule for when a landmark has earned an
offset (at least 25 movers with a median larger than half the interquartile
range). It emits a JSON block to paste into a calibration table. The owner's
own Calibrate exports go to `docs/calibration-incoming.json` and are
reviewed by hand before anything reaches the corpus. So the honest answer to
"does every user's send-through calibrate what is right and wrong" is no: it
is stored, and it calibrates only when a person runs the script and pastes
the result. Nobody has been receiving them automatically, including this
session, which cannot reach the database at all.

What to build so that every send-through does count:

1. A protected nightly job (service role, same pattern as the cleanup cron)
   that runs the script's analysis over all unexpired rows, grouped by the
   `seed_method` each row already records, and writes two numbers per
   method to a small metrics table: the accept-without-drag rate and the
   per-landmark median error. That is the 80 percent figure, live.
2. A durable, photo-free calibration record per consented row: the thirteen
   automatic and thirteen corrected points in normalised unit-face space,
   face direction, head-size features and the seed method version. Points
   are not a photograph, but they are derived from one, so the consent text
   says plainly that the coordinates are kept after the photo expires and
   that "Revoke" removes both. Until that sentence ships, the record expires
   with the photo.
3. When the script's rule is met for a landmark, the job opens a pull request
   with the proposed offset as a generated data file and the evidence
   (n, median, spread, before and after error on the held-out rows). A person
   merges it. Placement never changes in production without that step,
   because a median estimated from a handful of rows moves the seed away
   from the faces it currently gets right.
4. Once the keypoint model in C exists, each consented pair joins its
   training or evaluation split by subject, with the photo used inside its
   90-day window and only the derived record kept after.

**Consent timing, and why it matters for the number.** The consent question
is asked after the person has already answered "Yes, they look right" or
corrected the points. Two things follow. People who accept without looking
rarely consent, so the rows over-represent people who corrected, and the
accept rate computed from rows is biased. And the rate itself does not need
a photograph: whether the placement was accepted, corrected or skipped is
one event with no image in it, and it can be recorded for every side scan
without consent. So: record that outcome for everyone, and ask the photo
consent before the placement is shown (one sentence, same dialog family), so
the set of people who say yes is not shaped by what they saw. That is all
"consent timing" means.

**What not to do.** Do not tune the current template harder against the same
56 profiles; that is fitting to the target it already fits. Do not ask people
to place points themselves as the default; the owner is right that they will
not, and the flow already treats automatic as the path and manual as the
exception. Do not run any of this in the cloud.

## 1.2 Scores: the side calibration, and "lowkey the front"

The side scale has a written plan (`PLAN_SIDE_CALIBRATION_AND_METRIC_DETAIL.md`,
section A) and it still holds: the four side metrics that pull every correctly
placed profile into the bottom decile do so because their constructions do not
compute the quantity their published norm describes (nasal projection is not
Goode's ratio, the gonial angle norm is skeletal, the E-line norms are in
millimetres, and total convexity is 12 degrees off where glabella sits). The
plan's phase 1 gate was eight to ten hand-placed profiles from different
people. Two things have changed since it was written and both make it cheaper:

- The Calibrate export produces thirteen coordinate pairs and no photograph,
  so collecting from real people is a message and a paste, not a data-handling
  exercise.
- The synthetic profiles being labelled for 1.1 C **cannot** be used here.
  `CLAUDE.md` is explicit that synthetic diversity exists for placement
  geometry only, never for scoring, and a norm is scoring. So the norm refit
  still waits on real profiles, and that is the one input only the owner can
  supply.

Then the sequence in the plan: fix each construction to match its citation
or hold it out, re-fit only what is recentred with a deliberately wide spread,
and keep the success test that a correctly placed profile scores near the
median.

The front is smaller and better understood. Five offsets are on the task list
with evidence: eye separation reads 6.0 percent high across three people
(#63, the one that is established), jaw-to-cheek 10.1 percent high on two
(#59), the frontal jaw angle about 26 degrees high because the construction
differs from the reference's (#60), brow tilt about 11.9 degrees low which
looks like a sign convention (#64), and women reading about half a point high
because the reference population is older than the users (#51). Order them by
kind, not by size: constructions first (#60, then #64 if it is a convention),
because a construction fix moves the number for everyone and changes what the
offset even is; then the two measured offsets; then regenerate the reference
table, re-fit the shrink, and rerun the repeat-photo reliability corpus so the
per-metric reliability weights reflect the corrected constructions. The bizygo
fix (#65) showed the shape of this: one landmark moved six metrics.

## 1.3 Do we have a facial fat detector, or a pigmentation and blemish identifier?

No, to both, and the code is honest about it.

- **Fat.** `bodyProfile.ts` takes body fat as a number the person types.
  Max's persona tells him the scan cannot see body fat. There is no soft
  tissue measurement class at all, which is task #56's diagnosis of the pillar
  gap. A "body fat from a selfie" number is not something the product should
  ever print: the literature that predicts adiposity from faces predicts a
  perceived quantity with wide error, and the sentence "the app says my face
  is fat" is the kind of claim `CLAUDE.md` exists to prevent. The honest
  version is measurements, reported as measurements: submental contour and
  the cervicomental angle from the profile (the points already exist), cheek
  fullness relative to bizygomatic width and jaw definition from the front
  mesh, tracked scan to scan as "what moved", never converted to a percentage.
  That is what #56 should become.
- **Pigmentation and blemishes.** `skin.ts` produces five image statistics
  (tone spread, redness spread, chroma spread, texture, under-eye ratio),
  each relative to the person's own skin so that skin tone cannot enter the
  score. It does not localise or count anything. `skinConcernCatalog.ts` is a
  map from an observable pattern to safe advice, and the concerns that drive
  the plan come from what the person declares in the quiz.
  `SKIN_ANALYSIS_TRIAL.md` sets the gates for a real detector: a licensed,
  consented dataset with lesion masks and dermatologist labels, subjects held
  out rather than photos, per-class sensitivity and precision targets, no
  subgroup more than a tenth below the whole, "unable to assess" below
  threshold, and no skin output ever touching the structural score. None of
  that data exists in the repo and buying it is a budget line, not a sprint.

**Can detectors be built?** Yes, under three conditions, and the order of
work is fixed by them.

1. **Data with labels.** Synthetic faces are permitted for placement
   geometry only and are useless as skin ground truth anyway, and the
   labelled side set has no skin labels. The product already collects the
   two halves of a weak label: the person's own declared concerns in the
   quiz, and a consented photograph. Pairing them, under a new consent that
   names skin analysis as the purpose, gives a self-labelled set at scale.
   A dermatologist-labelled subset (a few hundred faces, bought or
   commissioned, balanced across skin tones and age bands) is still needed
   as the gate, because self-labels are wrong often enough to make a model
   confidently wrong.
2. **An on-device model, not a cloud one.** A small segmentation head that
   marks regions of "visible inflamed spots", "visible redness pattern" and
   "uneven pigment", run at scan time after the eligibility gate, giving a
   region mask and a confidence per class. Outputs are patterns, never
   conditions, in the wording the trial document fixes.
3. **The trial document's gates before anything is shown.** Sensitivity and
   precision per class on a subject-held-out set, repeat-photo agreement,
   no subgroup more than a tenth below the whole, "unable to assess" below
   threshold, and no effect on the structural score.

Cost: the labelled subset is the long pole and is calendar time and money;
the model is a few weeks once the data exists. The facial-fat side needs no
detector at all: the soft-tissue measurement class (#56) is measurement from
landmarks the engine already places, and it can ship first.

Recommendation: build the soft-tissue measurement class now; start the
consent and data collection for skin if the owner wants detection as a
product line; do not ship a skin label before the gates pass. Do build the soft-tissue
measurement class (#56) because it is measurement, and it is what most people
asking about "facial fat" actually want to track. Surface the existing skin
statistics with their confidence rather than hiding them, and keep the
self-declared concerns driving advice. If the owner wants lesion detection as
a product line, the trial document is the specification and the first
purchase is the dataset.

---


# 2. Max: the body

## 2.1 The diagnosis

The owner's words were "super old looking, his fall over is silly, his
fighting animation is bad". The read of the code and the frozen frames agrees
and says why: **it is the body, not the keyframes.** Max is one SVG
(`maxCharacterMarkup`) with three degrees of freedom: move the egg, rotate one
paddle, fade a prop in. Every one of the 24 states rendered in the contact
sheets is the same silhouette wearing a sticker. The class-swap runtime cannot
blend, so every act begins and ends with a measured snap (a 5 pixel jump and a
6 to 8 percent scale pop at each hand-off, three per act). The fall is
`transform: rotate(98deg)` on a thing that hovers, so there is no ground to
hit, which is why it reads as a layout bug rather than a fall. Adding more
keyframes to this rig cannot fix any of that. The brand master in
`public/brand/max-avatar.png` is the same egg with a visor, so the drawing and
the brand agree with each other and both have the ceiling.

What is worth keeping is the behavioural layer, which is genuinely good: six
moods, the reaction API (cheer, nod, shake, under two seconds, replace not
queue), silence first, never the same act twice, asleep when off screen, and
the reduced-motion gating. Those are the inputs to whatever body replaces this
one.

## 2.2 The redesign: a rigged 3D Max from the master, through Higgsfield

The owner's call is the 3D redesign. Here is how it is done with the tools
already connected, and what it costs.

**Owner's decision (2 September).** The body stays. Max keeps the
cloud-lobed cobalt shell, the dark screen face, the mint antenna, the stub
arms and the hover shadow; he is not to be humanised, and the arms do not
gain joints. Two things change: the screen eyes get pupils so he can look at
the reader and at the number, and the whole character becomes a rendered
3D object with volume, lighting and material, animated cleanly and crisply
instead of by class swaps on a flat SVG. The reader's findings that the
silhouette reads as a device and that every act is the same egg are recorded
in section 4 as the reader's view; the owner's call overrides the fix they
propose, and the table below marks them so.

**Step 1, the character.** Start from the master in
`public/brand/max-avatar.png` unchanged in silhouette, add pupils to the
screen eyes, and produce a turnaround (front, three-quarter, side, back) with
the character-sheet workflow so the 3D pass has consistent views. Nothing
else on the sheet is new.

**Step 2, the mesh and rig.** Higgsfield `generate_3d` (image to 3D, with
rigging) turns the turnaround into a rigged GLB. Check the result at three
sizes before accepting it: the 88 pixel Coach-tab stage, the 46 pixel chat
face, and a 320 pixel hero.

**Step 3, the moves.** With no limbs and no feet, the move set is what a
hovering body can do with weight and intent: a breathing bob with real mass
(slow up, quicker settle), a lean toward the screen, a yaw turn to look at
something, a head tilt, a nod, a shake, a small spin, a squash on landing and
a stretch on lift, an antenna flick as a reaction, and the screen face doing
the rest (pupils, brows, mouth). `animation_actions` clips are a reference
for timing and weight, not a rig to retarget; the clips that need arms or
legs are out. No props, no skateboard, no push-ups, no fight. The pet and the
fight were retired for a reason and `mountMaxPet` has no caller today; the
dead states and their nine keyframes get deleted in the same cycle
(section 2.4).

**Step 4, delivery, and the real choice.** Two ways to put a 3D Max on a
web page:

| route | what ships | pros | cons |
|---|---|---|---|
| Pre-rendered loops | Each move rendered from the GLB to a short transparent WebM (VP9 alpha; HEVC alpha for Safari) or a WebP sprite sheet, one file per move and per mood | No runtime dependency, no GPU work on the page, the existing scheduler and class model drive it almost unchanged, ships in days | Blending between moves is a crossfade, not a true transition; gaze cannot follow the pointer; a dozen files to manage |
| Real-time | The rigged GLB plus a lazy-loaded renderer (three.js core with the GLTF loader and animation mixer, or `model-viewer` on top of it), loaded only on surfaces that show him above about 88 pixels | True blending (crossfade between clips on the mixer solves the snap for good), gaze follow, a mood layer that is additive, one asset | A renderer is a few hundred kilobytes gzipped and a WebGL context on the page; needs the same deferral discipline as the face engine (#93); a draw call every frame on a phone is the lag the idle module was built to avoid |

Recommendation: **ship the pre-rendered route first**, because it delivers the
whole visible upgrade in one cycle with nothing new on the critical path, and
keep the rigged GLB as the source so the real-time route is a follow-up rather
than a redo. Below 88 pixels (chat face, ask-Max face, small tab face) do not
animate him at all beyond a blink; a static render of the new head is the
right thing at that size, which also closes the finding that the full
repertoire currently plays at 44 to 58 pixels where props are smudges.

**Budget.** Character sheet and mesh in a day of iteration, the move set in a
day, rendering and integration two to three days, the CSS teardown a day.
Roughly a week for the pre-rendered route. Real-time is another week on top,
mostly deferral and performance work, and should only start once the
pre-rendered Max has been on the page long enough to say whether gaze follow
is missed.

## 2.3 Does his design associate with self-improvement?

The owner's call is that the silhouette stays, so the answer has to come
from motion and attention rather than from anatomy: eyes that look at the
reader and at the number (the pupils), movement with mass and settle rather
than bounce, small confident reactions, and no props. The reader's view, kept
here for the record, was harsher: the visor says "I display a status", the
light-bar eyes cannot make eye contact, the paddles cannot point or hold
anything, and the egg on a hover shadow is a smart speaker with a face. A
coach who cannot demonstrate a stretch undercuts the plan he sells. The
associations to build in are physical (he stands, he moves like somebody who
trains, he can point at the screen), attentive (eyes that look at the reader
and at the number), and calm (no bouncing, no props, small confident
movements). The palette can stay. The register should move from "device" to
"someone who is on your side", which is the whole reason a coach exists on the
page.

## 2.4 What to fix in the current Max now, whatever the render timeline

These are real defects in the shipped drawing and each is a small change.
The owner asked for them to be fixed immediately; they go in their own pull
request ahead of the render work:

| sev | defect | where | fix |
|---|---:|---|---|
| P1 | One tap freezes him for the session: `.poked` is added on click and never removed, and its rule outranks breathing and every act's body motion | `maxCharacter.ts:481`, `style.css:4322` | Remove `poked` on the hop's `animationend` (greet already does this for `waving`); lower the rule's specificity; add a test that a poked drawing still breathes a second later |
| P2 | Hovering mid-act strips the act class cold, so the arm teleports and the prop vanishes | `maxIdle.ts:176` | On pointer enter, skip the next act and let the running one finish; fade a prop over 150 ms if it must be cut |
| P2 | The fight and the fall are unreachable but ship in every drawing: eight states, nine keyframes, six extra SVG nodes, the `.maxpet` rules | `maxCharacter.ts:395`, `maxPet.ts` | Delete `maxPet.ts`, `wireFight`, the `fight` option, the block group and the dead keyframes; keep one paragraph in the header saying why a fall needs a ground plane and a rig |
| P2 | The loader runs 34 animations (four stacked copies with a 3D turn) and half the drawings never sleep because `mx-asleep` is only applied by the idle mount | `maxCharacter.ts:358` | One Max in the loader with the mood cycled by class; one shared IntersectionObserver applying sleep to every `.mx-svg`; make the pause rule win with `animation-play-state: paused !important` |
| P2 | The animated repertoire plays on five surfaces under 60 px | `maxCharacter.ts:434` | Raise the gate to about 88 px and make it a per-surface option |
| P3 | Pupil follow sets an inline `animation: none` on every pointer move and never restores it, so lookout and thinking lose their eyes | `maxCharacter.ts:455` | Drive gaze through a CSS variable on a wrapper group so keyframes on the pupils keep composing |
| P3 | The idle handle is discarded so listeners outlive the drawing for up to ten seconds, and `__mxWired` is set before the size gate so a drawing that measured zero in a hidden tab can never be wired | `maxCharacter.ts:435` | Store the handle on the stage and destroy it from the surface teardown; move the flag after the gate |
| P3 | Reduced motion leaves excited Max frozen 7 px above a shrunken shadow because mood-level rules escape the reduced-motion block | `style.css:4920` | Add `animation-iteration-count: 1 !important` to the global reset and make the Max block win over mood rules |

---


# 3. Max: the mind

## 3.1 What he can see today, and the two promises it breaks

Per turn Max receives: the current report's headline figures, nine of the
measurements, four focus lines, a one-sentence delta since the last scan, the
titles of local protocols plus the server plan items, and the last sixteen
turns of the one thread he is in. He never sees other threads, protocol dates
or check-ins, or the quiz profile (goals, consented channels, diet exclusions,
declared skin concerns). And on the Coach tab, and on every reopened saved
thread, he is sent an empty context, so the persona appends "This person has
not completed a scan yet" directly under a header that says "He has read every
measurement in your scans" (`maxTab.ts:204`, `:228`; `_maxPersona.ts:296`).
That is the single most damaging defect on the coach surface and it is a
context-building fix, not a model fix.

The second broken promise is the benefit line "Unlimited chats with Coach
Max" against a server cap of 30 a day, reset on a UTC date, delivered as a
refusal with no countdown (`maxTab.ts:76`, `_maxPersona.ts:33`). The
owner's call is that the cap stays at 30 to keep spam down, so the fix is
the line, not the limit: "Up to 30 messages a day with Coach Max", a count
under the composer once fewer than five remain, and a reset time in the
person's own timezone instead of "tomorrow".

## 3.2 Memory: what Max remembers, and what he must never remember

The owner asked for Max to get a memory. The schema from #224 already holds
conversations (words only), messages, and plan items with a status. What is
missing is a durable, structured memory about the person, and rules for it.

**Three layers.**

1. **The scan record** (already exists, read-only for Max). Latest own scan,
   movement since the previous one, per-region standing. Rebuilt into the
   context on every open, including from the Coach tab and reopened threads.
   Store the scan id on `max_conversations` at creation so a reopened thread
   is grounded in the scan it was about.
2. **The plan and its history** (exists, half-wired). Plan items with status,
   start date, judging window, check-in dates and the verdict when judged.
   The sync must become a reconciliation (send every protocol with its status,
   update on conflict) so declined and judged items stop being "active" in
   his head. Memory that cannot forget is worse than none.
3. **Facts about the person, stated by the person** (new). A small table,
   `max_memory_facts (user_id, key, value, source_conversation_id, stated_at,
   expires_at)`, holding only things the person said in their own words and
   that a coach would reasonably keep: their goal in a sentence, a date they
   care about, what they tried before and what happened, a constraint
   (budget, country, allergies, "no dairy"), what they do not want mentioned.
   Bounded: a cap of forty facts, newest replaces oldest by key, a 180-day
   expiry unless restated.

**Rules.**

- A fact is written only from an explicit statement in the person's own
  message, extracted server-side after the reply, and shown back as a chip
  ("Remembered: you want this done before December"). One tap forgets it.
  Max never writes a fact from his own inference.
- Nothing inferred from a photograph is ever a memory. No ethnicity, no
  health guess, no "looks tired".
- Memory is read into the scoped block with a one-line provenance ("You told
  me on 14 August that...") so he can be corrected.
- Settings gets a "What Max remembers" list with delete per row and delete
  all, beside the existing correction-feedback list, with the same
  owner-scoped API shape.
- The scoped block tells him what was recorded this turn ("Recorded: added
  daily sunscreen to the tracker" or "No plan change was recorded") so he
  never claims a save that did not happen and never fails to acknowledge one
  that did.
- Hard limit unchanged: no endpoint returns another user's anything.

**Recall.** On open, the block is: scan record, the active plan with dates,
the facts, and the last sixteen turns of this thread. Across threads, only
the facts and the plan cross over; the words of another conversation do not.
That keeps the prompt under the cache breakpoint and keeps a stray remark in
one chat from following the person around.

## 3.3 The conversation itself

Fixes to how he talks and how the exchange works, all small:

- Put the verdict ladder and the rarity bar in `SAFETY_RULES`. Today the
  prompt has neither, and the context block primes "measures above 61 percent
  of the reference set", one step from the sentence `CLAUDE.md` bars. Add:
  describe a score only with the plain ladder words; never say attractive,
  handsome or beautiful; never say how rare a face is or how many people sit
  above or below it. Pin with a test beside the em dash test.
- Enforce the em dash ban on the stream, not just in the prompt: replace the
  code point with a comma and a space in the delta loop before it is sent and
  before it is saved. The owner's instruction is that the conversation is not
  to be injected with them; this is the only way to guarantee it.
- Stop silent truncation. The route sets a 700-token cap with thinking left
  adaptive, so a plan can arrive half-written and be saved as if finished.
  Disable thinking on this route, give the text headroom, watch `stop_reason`
  and append a visible "I ran out of room, say continue" when it hits.
- Give Max the quiz profile: goals, consented channels with a rule not to
  advise outside them, diet exclusions, declared skin concerns. The plan page
  respects these and Max currently does not.
- Loosen the plan-memory parser ("can you add sunscreen to my plan?" and
  "retinol isn't working, what else?" currently persist nothing) and read the
  `X-Max-Plan-Change` header on the client into a confirmation chip.
- Show the plan button when Max's closing sentence is present, not only when
  the question matched a regex; the prompt already mandates the sentence.
- Keep the thread on close (pause, do not end), show "Opening that chat" while
  a saved thread loads, keep the draft on failure with a Try again pill,
  disable the composer properly on the daily limit with the count shown under
  it once it drops below five, replace the 402 dead-end with the paywall card,
  add a Stop control while streaming, and do not let Escape or a backdrop tap
  throw away a typed question.
- Add delete and archive for a saved chat. The column exists; nothing writes
  it. These are conversations about a person's face.

## 3.4 The Coach tab: everything it should be

The owner asked for the complete list: what should be in it, what it should
be able to do, how it keeps context, and what people should want to achieve
there. The frame is the reason people use a general assistant, specialised
for one person with one goal: **they want someone who already knows the
situation, tells them the truth, gives them a plan they can act on today,
remembers what they said, and notices what changed.** Everything below is one
of those five.

**Knows the situation**

- Opens with the latest scan in hand, by name and date, and says what it
  contains. Not "ask me anything", but "Your 22 August scan: 6.4 overall,
  jaw up 0.3, skin flat. Want the plan or the read?"
- Carries the quiz profile and the facts (3.2) and shows them in one line so
  the person knows what he knows.
- Knows the plan's dates: what starts when, what is being judged when, what
  the next check-in is.

**Tells the truth**

- The plain ladder, no rarity, the measured confidence on anything indicative
  (the report already flags these; he should say "indicative" too).
- Says what the scan cannot see (body fat, skin conditions, anything
  medical) rather than improvising a lever, which the old chat captures show
  him doing when he had no numbers.

**Gives a plan they can act on today**

- The check-in is his line, so it is a Max speech card at the top of the tab
  with his face, the question as the headline, and the answer pills under it;
  not a form inset labelled CHECKING IN under a chat list.
- Every plan row is a control: I've started, pause, not doing this, ask Max
  about it. Under each row, the next date ("Max checks in on 12 September").
  Today the rows are inert green text.
- "Create a plan for me" from the tab produces plan pills the person can add,
  built from the recommendation catalogue by title match, not a paragraph and
  an empty tracker.
- Plans render as a plan (3.5), and product steps carry a direct link with
  the directions (3.6).

**Remembers what they said**

- Section 3.2. Plus the small honest signals: "Remembered" chips, a "What Max
  remembers" list, and a delete on each.

**Notices what changed**

- After a rescan, the first thing on the tab is the movement, in his voice,
  tied to what was in the plan: "Jaw moved 0.3 since you started the posture
  work. Skin has not, and it is week 6 of 12, so that is expected."
- A judged item gets a verdict card (kept, replaced, dropped) that he wrote
  and the person confirms.

**Layout and type.** Above 1100 pixels the tab is two columns: Max, the
check-in and the composer on the left; conversations and the plan on the
right. Metadata has a 12 px floor, controls 13 px, the check-in question 16 px
serif, tracker rows 14.5 px. The 8 px badge and the 10 px tracked labels are
what make the page read as settings.

**What it does not become.** Not a general chatbot: off-goal questions get a
short answer and a turn back to the plan. Not a diagnosis desk. Not a place
that ranks the person against anyone.

## 3.5 Plans: how they are crafted and how they are shown

A plan is a structured object, not prose:

```
PlanDraft {
  goal: string            // in the person's words
  horizon: weeks          // from the longest judging window in it
  steps: PlanStep[]       // 3 to 6, never more
}
PlanStep {
  recId: string           // from RECS, so evidence, window and buy guide come along
  why: string             // one sentence tied to a measurement or a stated goal
  when: "morning" | "night" | "daily" | "weekly" | "once"
  startBy: date | null
  judgeAt: date           // startBy + weeksToJudge
  pairedWith: recId[]     // moisturiser and SPF for anything abrasive (3.6)
}
```

Max drafts it from the catalogue and the scan, capped at six steps, and the
server returns it as a marker block the client strips and renders. On screen
it is a card per step with the evidence label, the window, the dates and the
direct link, above a single timeline that shows the judging dates, and an
"Add these to my plan" control that commits them as protocols. Changing a step
regenerates only that card. The check-in engine already exists
(`protocol.ts`); this feeds it rather than replacing it.

## 3.6 Product links: a shelf, not a search box

The "Compare what is sold near you" button builds a Google search from the
display sentence ("A brow tint kit, or a salon appointment"). The owner's
direction is direct links on the universal iHerb store, with a harshness
rating, mandatory pairing, and the directions from the label or the industry
body rather than from memory. The product-link sweep verified each product on
`www.iherb.com` in canonical form (`/pr/<slug>/<id>`, no country subdomain,
no tracking parameters) and took the directions from the FDA Drug Facts label
on DailyMed or the maker's own label, quoted.

**Harshness scale.** 0 nothing to pair; 1 mild, moisturiser advised; 2 an
active that thins or dries the surface, moisturiser and daily SPF required
and only one such active per routine slot; 3 a prescription-strength or
procedure-level item, which the catalogue does not sell.

**Pairing rule, applied in the plan renderer.** Any step with harshness 2
automatically carries the moisturiser and the SPF as paired steps, and the
plan will not place two harshness-2 actives in the same slot; it splits them
morning and night or alternate nights, which is what every label below says
in its own words.

**Verified so far.** The sweep verified each row on the universal store and quoted the label. Three things it found that differ from what was assumed:

- Differin is not a spot treatment. The Drug Facts direction is a thin layer over the entire affected area, and the maker says so in its own FAQ. Whole-face, once a day.
- Vanicream says "apply liberally". The two-finger amount is the floor; "a small amount is enough" must not be printed.
- The owner's azelaic pick, APLB Azelaic Acid Peptide Cream (150112), does not state an azelaic percentage. Its 26.6 percent is a complex of azelaic acid, a peptide and centella, with azelaic acid about 26th on the ingredient list, so it does not meet the 10 percent the guide asks for. Purito Azelaic Acid 10 (157097) does; the fragrance-free alternative is Anua Azelaic Acid 10 (151638), out of stock when checked.
- The current buy-guide example "PanOxyl 2.5% wash" does not exist; PanOxyl sells 4 and 10 percent. The example text in the catalogue is corrected in the same PR as the links.

| rec | product on www.iherb.com | id | harshness | directions, from the label | pair with | caveat |
|---|---|---:|---:|---|---|---|
| adapalene | Differin, Adapalene Gel 0.1% Acne Treatment, Fragrance Free, 0.5 oz (15 g) | 86314 | 2 | From the Galderma Drug Facts label (adults and children 12 years and older): use once daily. Clean the skin gently and pat dry before applying. Cover the entire affected area with a thin layer; the label's own example is that if the acne is on the face, apply it to the entire face. Do not use more than one time a day; applying more than directed will not give faster or better results and may worsen irritation. Avoid contact with eyes, lips and mouth, and wash hands after use. Do not apply to damaged skin (cuts,… | Must be paired with a plain fragrance-free moisturiser and a daily broad-spectrum sunscreen. The label requires sunscreen outdoors, and Galderma's FAQ recommends following the gel with a gentle non-comedogenic moisturiser to manage irritation. Spacing: the… | The owner's assumption that this is a spot treatment does not match the label. The Drug Facts direction is to "cover the entire affected area with a thin layer", with the example "if your acne is on the face, apply the product to the entire face" (Galderma Drug Facts on DailyMed, setid 0739d631-171b-42a8-bd55-0022b8df2d8a, revised December 7, 2022). Galderma's own FAQ at differin.com/allfaqs.html says: "It's not a… |
| spf | Vanicream Facial Moisturizer, Mineral Sunscreen with Ceramides, For Sensitive Skin,… | 127086 | 0 | Label directions (FDA Drug Facts, Pharmaceutical Specialties Inc, label dated 15 October 2024, identical on vanicream.com): "Apply liberally 15 minutes before sun exposure. Reapply at least every 2 hours. Use water resistant sunscreen if swimming or sweating. For children under 6 months of age: Ask a doctor." In practice: last step of the morning routine, over any moisturiser or active; it is itself a moisturiser, so on plain days it can be the only cream. Zinc oxide sunscreens are thick, so dot it across the… | Nothing required. Harshness 0. It layers over any active in this list (adapalene, azelaic acid, benzoyl peroxide, salicylic acid) as the final morning step, and it is the daily SPF those actives depend on. | The owner's note "a small amount is enough" contradicts the label, which says "Apply liberally" (DailyMed setid d8c9a8d0-1f24-2240-e053-2a95a90a8dee, and the Directions block on vanicream.com). Print the thick-texture spreading advice, but keep the two-finger amount as the floor. Water resistance: the Drug Facts label does not claim it (its directions carry the standard non-water-resistant wording, "Use water… |
| salicylic | PanOxyl Clarifying Exfoliant, 2% Salicylic Acid, For Acne Prone Skin, 4 fl oz (118 ml) | 130317 | 2 | From the Drug Facts label (active ingredient salicylic acid 2%, purpose: acne medication): "shake well before using; clean the skin thoroughly before applying this product; cover the entire affected area with a thin layer one to three times daily; because excessive drying of the skin may occur, start with one application daily, then gradually increase to two or three times daily if needed or as directed by a doctor; if bothersome dryness or peeling occurs, reduce application to once a day or every other day." It… | Must be paired with a plain, fragrance-free moisturiser and a daily broad-spectrum SPF, since salicylic acid thins the surface layer and increases sun sensitivity. The label states: "skin irritation and dryness is more likely to occur if you use another… | None of the three products named in the buy guide are stocked on iHerb: Paula's Choice and The Ordinary do not appear in the iHerb catalogue at all, and the CeraVe salicylic acid items iHerb carries are washes, which the guide excludes. PanOxyl Clarifying Exfoliant is the closest match: a 2% salicylic acid leave-on liquid, alcohol-free, with no fragrance or parfum in the ingredient list, from an established US… |
| benzoyl-peroxide | AcneFree Oil-Free Acne Cleanser, 2.5% Benzoyl Peroxide, Fragrance-Free, 8 fl oz (237 ml) | 147322 | 2 | From the manufacturer's Drug Facts (AcneFree LLC, filed with the FDA and published on DailyMed): "Use every morning and evening. Apply a dime-size amount to damp skin and gently massage, avoiding the eye area. Rinse well. Use wash on entire affected area one to two times daily. Because excessive drying of the skin may occur, start with washing once daily, then gradually increase to two times daily if needed or as directed by a doctor. If bothersome dryness or peeling occurs, reduce cleansing to once a day or… | Must be paired with a plain, fragrance-free moisturiser after every wash and a daily SPF. The label itself says "if going outside, apply sunscreen after using this product". Spacing rule from the label: "Skin irritation and dryness is more likely to occur if… | Three things for the owner. First, the buy guide's example, "PanOxyl 2.5% wash", does not exist in PanOxyl's current line: PanOxyl sells a 4% creamy wash and a 10% foaming wash and bar, all of which iHerb stocks, so the example text in recommendations.ts should be corrected. Second, the only 2.5% leave-on gel that iHerb has ever carried, Neutrogena On-the-Spot (item 85706), is now marked as a discontinued item on… |
| azelaic | Purito Azelaic Acid 10 Koji Tea Tree Serum, 30 ml (1.01 fl oz) | 157097 | 2 | Label text, as printed in iHerb's Suggested use section and identically on purito.com: "Gently shake 3 to 5 times to disperse the capsules. Apply evenly to the face and pat gently for absorption." Purito places it as the first serum step after toner, in this order: cleanser, toner, this serum, cream, sunscreen. Label warnings: for external use only; avoid contact with eyes; do not use on broken, wounded or irritated skin; discontinue use if rash, redness or itching occurs and consult a doctor if irritation… | Rating 2. Pair with a plain, fragrance-free moisturiser applied after the serum (the label's own routine order puts cream after this step) and a broad-spectrum SPF every morning; the label states "Use sunscreen while using this product." The label gives no… | Not fragrance-free in the strict sense: Purito labels it "No Synthetic Fragrance", but the formula contains tea tree leaf water at 10% and tea tree leaf oil at 50 ppm (0.005%, delivered in capsules that burst on application), plus 0.1% kojic acid. Somebody whose skin reacts to essential oils should prefer the fragrance-free Anua Azelaic Acid 10 Hyaluron Redness Soothing Serum (iHerb id 151638) when it returns to… |
| niacinamide | Advanced Clinicals 5% Niacinamide Serum, 1.75 fl oz (52 ml) | 110665 | 1 | Manufacturer directions (advancedclinicals.com product page, quoted): "Apply a thin layer to clean face and neck daily. Follow with your favorite Advanced Clinicals face cream." In plain terms: once a day, on cleansed skin, a thin layer over face and neck, then your moisturiser on top. Any plain fragrance-free moisturiser does the job of the "face cream" the label names. The manufacturer FAQ adds: "For those with sensitive skin, we recommend patch testing before full use." The label does not specify morning or… | No mandatory pairing at harshness 1. It layers under a plain fragrance-free moisturiser (the emollient entry) and the label itself says to follow with a face cream. It can sit in the same routine as the stronger actives in the list (benzoyl peroxide,… | Not a single-ingredient serum: alongside 5% niacinamide it carries ascorbic acid (vitamin C), ferulic acid, apple fruit extract, sodium hyaluronate and aloe. No fragrance, parfum or essential oil appears in either published ingredient list, and the manufacturer FAQ names "5% Niacinamide Face Serum" on its list of products with no added fragrance. Two ingredient lists circulate (an older one with Saccharomyces/Zinc… |
| emollient | Cetaphil Moisturizing Cream, Fragrance Free, 16 oz (453 g) jar | 114687 | 0 | iHerb's Suggested use for this listing (product code CET-91756): "Smooth generously over body to hydrate and protect very dry, sensitive skin from moisture loss. Reapply as needed for enhanced hydration." Cetaphil's own US product page for the same UPC (302993917564) adds that it is "Ideal for daily use on face or body", to "Gently massage the cream into your skin until it is fully absorbed", and to use it "as often as needed, but at best every day, especially directly after your morning shower or evening bath to… | Nothing required at rating 0. It is the plain moisturiser that the rating 2 items in the plan (adapalene, benzoyl peroxide, salicylic or azelaic acid) need alongside them, and it sits under a daily SPF in the morning. No spacing rule of its own. | The ingredient list on iHerb includes sweet almond oil, sunflower seed oil, benzyl alcohol and phenoxyethanol as preservatives, and a small amount of niacinamide and panthenol. Anyone with a tree-nut allergy or a known reaction to benzyl alcohol should check with a pharmacist first. It is a petrolatum-based rich cream marketed for dry to very dry skin; the listing says "Won't Clog Pores" and Cetaphil says face or… |
| silicone-scar | HealFast, Scar Gel, 1.06 oz (30 g), 100% medical-grade silicone | 154585 | 0 | Manufacturer directions: "Clean and dry skin area. Apply a small amount of gel on and around the scar area, then massage for 3-5 minutes. Apply 2-3 times daily." The retail description adds: use for at least 60 to 90 days, and for best results 6 to 12 months. Apply only to a closed, healed scar. Label warnings: "For external use only. Avoid contact with the eyes or mouth. Do not ingest. If redness or allergic symptoms develop, stop use, and consult your doctor." and "Do not apply HF Scar Gel to open wounds,… | Nothing required. Silicone gel is an inert occlusive, not an acid or retinoid, so no moisturiser or spacing rule is needed. Daily SPF on a fresh scar is sensible on its own merits and can go on once the gel has dried, but it is not a label requirement. | This is the gel, which the buy guide reserves for where a sheet will not stay on; on a face that is most scar sites. For a flat area such as a forehead or cheek, iHerb also lists HealFast 100% Silicone Scar Strips, 5 reusable sheets (product id 154588); the manufacturer says to wash and dry the scar, cut the sheet to size, apply tacky side down, wear 12 to 24 hours, remove daily to wash with mild soap and water,… |
| fluoride | Crest Cavity Protection Fluoride Anticavity Toothpaste, Regular, 5.7 oz (161 g) | 112457 | 0 | Label directions (Procter & Gamble Drug Facts, via DailyMed): adults and children 2 years and older, brush teeth thoroughly after meals or at least twice a day, or use as directed by a dentist. Do not swallow. Children under 6: use a pea-sized amount and supervise brushing until good habits are established; under 2: ask a dentist. The label says nothing about rinsing. The owner's "spit, don't rinse" step is not on the Crest label; it comes from NHS guidance, which says not to rinse your mouth immediately after… | Nothing required at harshness 0. No moisturiser, SPF or spacing rule applies. It sits alongside the other teeth entries (cheese after meals, whitening strips) with no interaction to manage. | Strength is 1100 ppm fluoride (sodium fluoride 0.243% w/w), below the guide's 1350 to 1500 ppm band. That is a market limit, not a product defect: the US OTC anticaries monograph (21 CFR 355.10) caps sodium fluoride, monofluorophosphate and stannous fluoride pastes at 850 to 1150 ppm, and iHerb ships US-market goods, so no listing on www.iherb.com reaches 1350 ppm. NHS guidance says adults should use at least 1350… |
| whitening | Crest 3D Whitestrips Glamorous White, Enamel Safe Dental Whitening Kit, 28 strips (14… | 92948 | 2 | From the Crest label as reproduced on crest.com: "Use one treatment once a day for 30 minutes." One treatment is one upper strip and one lower strip. PEEL: "Peel Whitestrips from backing liner." APPLY: "Apply gel side of strip to front teeth. Align straight edge of strip with gumline. Fold over teeth and press to secure." REVEAL: "After 30 minutes, peel strip from corner and pull gently across to ease removal. You may rinse or brush to remove remaining gel." During wear: "Do not eat, smoke, sleep, or drink (with… | The moisturiser-and-daily-SPF pairing on the harshness scale is a skin rule and does not apply to an oral product; the working pairings are these. Keep the fluoride toothpaste recommendation running alongside (spit, do not rinse). If sensitivity appears, use… | This is the US-strength product and iHerb ships it from the US. The label does not print the peroxide percentage. The UK and EU cap over-the-counter whitening at 0.1 percent hydrogen peroxide, with anything up to 6 percent dentist-only, so this kit sits far above what can be sold there and a parcel may be refused or the country storefront may not offer it. Australia caps OTC at 6 percent and New Zealand also… |
| brow-tint | Godefroy Instant Eyebrow Tint, Medium Brown, 3 Application Kit | 89254 | 1 | From the manufacturer's directions (godefroybeauty.com product page) and the label text reproduced on retailer listings. 1. Allergy test, 48 hours before the first use: squeeze a small amount of Solution No.1 onto the end of the applicator stick and apply it to the inside of your arm, apply Solution No.2 directly on top, let it stand 2 minutes and wipe clean, then wait 48 hours. Proceed only if there are no visible signs of irritation. 2. Prep: wash the eyebrows with mild soap and water or an oil-free makeup… | No moisturiser or SPF pairing is required; this is a hair dye, not a skin active. The label pairs it with a thin barrier of petroleum jelly around the brow. Keep it apart from brow shaping: the label says do not use immediately after waxing or tweezing, or… | Shade: the guide says a shade at or one step below your hair colour, and that darker reads as drawn on. Medium Brown is the middle of the range and the safe single default; iHerb sells the same kit in Light Brown (product 89255), Dark Brown (89253) and Natural Black, so pick to your own hair and, if between two, take the lighter. Ingredients: the "no PPD, no peroxide" marketing is accurate, but it is still a… |
| keto-shampoo | Nizoral Anti-Dandruff Shampoo, ketoconazole 1% w/w, Clean (fresh scent), 7 fl oz (200 ml) | 120625 | 1 | From the manufacturer's Drug Facts (Kramer Laboratories label on DailyMed, version dated 17 March 2026), adults and children 12 years and over: "wet hair thoroughly; apply shampoo, generously lather, rinse thoroughly. Repeat; use every 3-4 days for up to 8 weeks or as directed by a doctor. Then use only as needed to control dandruff." Children under 12: ask a doctor. The front panel says "Use Nizoral Anti-Dandruff just twice a week to control your dandruff symptoms." The US label gives no leave-on time; it is… | No pairing is required at this rating. It is a rinse-off wash, so there is no leave-on layering or spacing rule; the label makes no statement about use alongside minoxidil or any other product. A plain conditioner on the lengths is reasonable if hair feels… | Not fragrance-free: "fragrance" is in the inactive ingredients and the variant is sold as a fresh scent (iHerb names it "Clean"). Label warnings: for external use only; do not use on scalp that is broken or inflamed, or if allergic to any ingredient; avoid contact with eyes and rinse thoroughly if it gets in; stop use and ask a doctor if a rash appears or the condition worsens or does not improve in 2 to 4 weeks;… |
| hair-colour | Herbatint Permanent Haircolor Gel, 4N Chestnut, 170 ml single kit (colour gel 60 ml,… | 5111 | 2 | From the Herbatint label and manufacturer instructions. Sensitivity test 48 hours before every use, even if you have coloured before: put a small amount of the mixed product on a plaster on the inner forearm or behind the ear, leave 45 minutes, rinse, and do not use the product if itching, redness or swelling appears in or around the spot within the next 48 hours. Do not wash your hair for 24 hours before colouring. Apply to dry, unwashed hair. Wear the gloves. Apply a moisturiser along the hairline and face… | Rated 2 because it is an oxidative dye with diamminobenzenes and a hydrogen peroxide developer that can irritate the scalp and, in a sensitised person, cause a severe allergic reaction. Pair it with a plain, fragrance-free moisturiser (the label itself says… | The link is one shade, 4N Chestnut, a mid-dark neutral brown and the shade with the most ratings on iHerb. The person has to pick the N (natural) shade that sits at their own root colour or one level darker; the same listing family covers 1N Black through 10N Platinum Blonde. The owner's guide says go at or near natural and darker. Herbatint's own FAQ adds that when torn between two shades choose the lighter one,… |
| silicone | HealFast, 100% Silicone Scar Strips, 5 Reusable Sheets | 154588 | 0 | From the maker's label (healfastproducts.com, Medical Grade Scar Sheeting: Strips): "1. Wash and dry both scar and hands. 2. Cut sheeting to desired size covering the scar area, remove the plastic film, and apply with the tacky side down to the affected area. 3. Wear sheets for 12 to 24 hours, remove daily to be cleaned. 4. Use consistently for at least 60-90 days." The label adds that for best results use is continued for 6 to 12 months, that softening may show within days and texture within 4 to 8 weeks (longer… | Rating 0, so no mandatory pairing. Nothing goes under the strip: the label says the skin must be washed and dried first, so no moisturiser, sunscreen or other product on the scar while the strip is on or it will not adhere. In the hours the strip is off, a… | Sheets suit raised or thickened scars (hypertrophic, keloid) on healed, closed skin. They do nothing for indented acne scars, and the label bars use on unhealed or irritated skin. On the face a strip is awkward and visible, so it is a night-time tool; the same maker's gel (HealFast Scar Gel, iHerb item 154585) is the daytime face format but was out of stock on www.iherb.com at research time. The gels and sheets… |

14 products verified so far; the sweep continues over the rest of the catalogue and rows are appended as they land.

Not added: minoxidil (not recommended: iHerb does not carry minoxidil in any strength or form, so no link can be added and the question of whether iHerb ships it to New Zealand or Australia does…); dermastamp; vitamin-e-scar.

**Dropped at the owner's instruction:** vitamin E for scars and the
dermastamp. Neither enters the catalogue or the shelf.

## 3.7 The Goal Visualizer

The owner's direction is a Goal Visualizer: from the person's saved front and
side photographs, a realistic, natural rendering of the specific goals they
have selected, bounded by target measurements, with a teaser before a goal or
product is added. It is a product surface, separate from the creator carousel
that #228 built for fictional identities. `NATURAL_GOAL_PREVIEW_PLAN.md`
already holds the promise, the may-change and must-not-change lists, the
motion language and the release gates, and all of that stands. What it lacks,
and what this section adds, is the loop that makes a generated face honest:
a contract, a render, a re-measurement, and a rejection path.

**The measurement contract.** A goal is not a prompt; it is a set of bounded
deltas on named measurements. Selecting "leaner lower face" produces, for
example, a target band on the jaw-to-cheek ratio and the cervicomental angle
of the profile, each capped at a plausible per-person change over the plan's
horizon and each drawn from the same metric registry the report uses. Every
measurement outside the contract carries a tolerance of zero: bone geometry,
eye, nose, lip, chin and jaw shape, ethnicity, age and sex traits must
re-measure as unchanged. The contract is written before any image exists and
is stored with the preview spec (`GoalPreviewSpec` gains a `contract`
field), so what the render was allowed to do is on record.

**The render.** The front and side photographs go to the image provider with
the contract expressed as bounded, non-anatomical instructions (presentation,
grooming, skin surface, a modest leaner presentation where the contract
permits it), never as free text a person typed. Both views are rendered so
the profile cannot drift from the front. The output carries the synthetic
label in the image and in the surrounding UI.

**The re-measurement.** The rendered front and side go back through the same
on-device engine that measured the originals: the same landmarker, the same
side placement, the same metrics. This is the step that turns a picture into
a claim the product can stand behind. The contract is then checked in both
directions: did the targeted measurements move within their bands, and did
every other measurement stay within noise of the original.

**The rejection path.** A render that misses the contract is not shown. It
is retried with the contract tightened (fewer goals, smaller deltas), and
after a bounded number of attempts the person sees "We could not make an
honest preview of that goal set" and the plan cards, never a face that failed
the check. A render that passes is shown as current against goal with the
divider, with the What-changed drawer listing exactly the contract lines
that moved and by how much, in measurement terms, tied to the plan cards.

**The teaser.** Before a goal or product is added, the person may see a
single, low-cost teaser: the current face with the targeted region marked
and the contract stated in words and numbers ("jaw definition, up to this
much over twelve weeks"), not a generated face. The generated preview is the
reward for committing to the goal and giving the consent below. That keeps
generation cost behind intent and keeps the teaser from being a forecast.

**The consent boundary.** This is the first time the product sends a person's
own photographs off the device for rendering, and the side photograph is new
even against the earlier preview plan. It needs its own consent, separate
from the landmark-feedback consent: named provider, what is sent (the two
photographs and the contract, nothing else), retention at the provider,
deletion on revocation, exclusion from training and advertising, adults only,
and never for a guest's scan. The privacy page names it. Revocation removes
the provider artefacts and the stored preview reference, as the earlier plan
already requires.

**What it is not.** Not a forecast, not a procedure, not a measurement the
person has reached, and not the creator carousel. Weekly tracking compares
scans to scans; the preview is never the destination the tracker reports.

**Sequence.** Contract model and re-measurement harness first, on synthetic
faces, with no consent surface. Then provider evaluation against the harness.
Then the consent surface, the staff-only route, and a small adult cohort.
This slots after cycle 2 in section 6 because it depends on the plan object
(3.5) for the contract and on Max's memory for the goal in the person's
words.

**Mechanism.** A `productLinks` table in code (rec id, store, url, verified
date, harshness, directions, pairs), rendered as the primary link with the
retailer named, the search kept as the fallback when a row is missing or older
than 90 days. The guardian-minor and no-evidence exclusions stay exactly as
they are. Links are universal store pages and iHerb sends the shopper to their
country at checkout; that is expected and is not tracking.

---


# 4. Findings by surface

Severity: P1 a broken promise or a visible defect on a paid path, P2 something
a paying user notices, P3 polish. Effort: S under a day, M one to three days,
L a week or more. "Reader" means the finding was produced by a surface reader
against the cited line or capture and has not yet been independently refuted;
"confirmed" means the author of this document reproduced it. Every row
carries the file and line to check first.

## 4.1 Coach Max chat and the Coach tab

Files: client

The chat sheet itself is the strongest part of this surface: the buffered typewriter drain, the stall dots under a half-written answer, the thinking pose, the markdown scrub and the deterministic follow-up chips are all careful work and read well in OLD-chat-chips.png and OLD-chat-thinking.png. The Coach tab around it does not reach the same bar. Its headline promises "He has read every measurement in your scans" while every chat opened from the tab, including a reopened post-analysis thread, sends an empty context, so the coach on the tab is a Max with no numbers. The plan is rendered as four inert rows labelled "Ready to start" in accent green with nothing to tap, and the one check-in question is rendered as a form inset without Max's face or name, so his most important line on the page reads as app chrome. Error and edge states are the weakest area: a failed send empties the input and asks the user to retype, the daily-limit refusal leaves the composer live, an expired-plan 402 dead-ends in a red bubble with no path to the paywall, and Escape or a backdrop tap discards a typed draft or aborts a streaming answer without asking. Type sizes of 8 to 11px on labels, metadata and states, inside a 760px column on a wide monitor, are what make the tab feel like a settings page rather than a coach.

| sev | finding | where | fix | effort | status |
|---|---|---|---|---|---|
| P1 | Coach tab chats run without the scan the tab says he has read | `src/ui/maxTab.ts:204` | Build the context on the dashboard from the owner's latest stored scan (the same recipe as results.ts chatContext: report, tone, scans, movement, activePlan; task #138 already reopens a stored scan as a full report). Pass it from both openMaxChat calls in maxTab.ts. Replace TAB_GREETING with a line that names the scan: "Hey, I'm Max. I've got your latest scan open. Ask me anything about it." If no scan exists, keep… | M | confirmed |
| P1 | Plan rows are inert: "Ready to start" looks like a control and does nothing | `src/ui/maxTab.ts:113` | Make each row a button that opens a small sheet: "I've started" (moves to running), "Not doing this" (declined), "Ask Max about it" (opens the chat with the item as initialQuestion). Show the next step under the state: "Max checks in on 12 Sep" from startBy, or "Waiting on your date" when startBy is null. Use ink for the state text and reserve accent for the one actionable state. | M | reader |
| P2 | A failed send empties the input and asks the user to retype; the daily limit leaves the composer live | `src/ui/maxChat.ts:241` | On failure, restore the question to the input (input.value = question) and add a "Try again" pill inside the error bubble that resubmits. Detect the 429 (response.status) and disable the composer with placeholder "Max is back tomorrow" for the rest of the session. Read X-Max-Remaining and show "3 messages left today" under the composer once it drops below 5. | S | reader |
| P2 | From the Coach tab, "Create a plan for me." produces prose and nothing trackable | `src/ui/maxChat.ts:160` | On the dashboard pass onOpenPlan that reopens the latest scan on its Improve tab. Better: when requestedActionPlan fires, render "Add to my plan" pills under the reply built from the scan's recommendation catalogue (RECS) that match Max's text by title, each calling offerProtocol + commitProtocol. Add a one-line hint under the tracker: "Tell Max 'add X to my plan' and it appears here." until the pills ship. | M | reader |
| P2 | Check-in copy breaks grammar on plural titles, visible in the owner's production screenshot | `src/engine/protocol.ts:366` | Avoid verb agreement with the title: "I only ask because the clock on ${thing} is about ${weeks} weeks, and it starts the day you start, not today." For the verdict: "You've had ${thing} done and you can see it." Add a test that runs every prompt through a plural title such as "brow and lash growth oils". | S | reader |
| P2 | Coach tab type scale: 8 to 11px labels in a 760px column read as a settings page | `src/style.css:781` | Set a 12px floor for any metadata and 13px for controls on this tab; raise .klabel to 11px with 0.14em tracking; the badge to 10px. Give the check-in question 16px serif and the tracker rows 14.5px. On min-width 1100px, lay the tab out as two columns: Max, the check-in and the composer on the left, conversations and plan on the right, so the canvas is used. | M | reader |
| P2 | The check-in is Max's line but is rendered as a form inset without him | `src/ui/maxTab.ts:145` | Move the check-in to the top of the tab as a Max speech card (reuse the maxread pattern: face, name, the question as the headline, pills beneath). Fold the stage copy into that card when there is nothing to ask. Put the composer directly under it, then conversations, then the plan. | M | reader |
| P2 | Reopening a thread shows a blank sheet, and closing the results chat forgets the thread | `src/ui/maxChat.ts:194` | Show a single dimmed row "Opening that chat…" in the log while loading. Keep the last conversationId per source in module state and pass it back on reopen within the same session so closing the sheet pauses the thread rather than ending it. Offer "New chat" in the sheet header for a deliberate fresh start. | S | reader |
| P2 | Escape and backdrop tap discard a typed draft or abort a streaming answer with no confirmation | `src/ui/maxChat.ts:228` | Ignore backdrop taps and Escape while inFlight or while the input has text; on Escape with a draft, blur the input instead. Keep the X button as the explicit close. Add a Stop control during streaming (see the 90-second finding). | S | reader |
| P3 | Expired-plan 402 dead-ends in a red bubble with no route to the paywall | `src/ui/maxChat.ts:422` | When the JSON carries upgrade: "max", replace the composer with a single "Continue with Max" button that opens the existing paywall card from maxTab.ts, and change the bubble to "Your Max plan has ended. Pick it back up and I'll carry on from here." | S | reader |
| P3 | 90 seconds of thinking dots with no Stop and a disabled composer | `src/ui/maxChat.ts:49` | Swap Send for a Stop button while inFlight (abort, keep the partial text). After 8 seconds without a first token, add a small line under the dots: "Still working on it." Cut GIVE_UP_MS to 45 seconds. | S | reader |
| P3 | Paid-tab composer opens the modal on focus, so keyboard tabbing through the page pops the chat | `src/ui/maxTab.ts:206` | Open on pointerdown, Enter or submit rather than focus. For the chips, apply the fade mask only when scrollWidth exceeds clientWidth and let the row wrap to two lines above 600px where the 560px sheet has the room. | S | reader |

Questions the reader could not settle from the sandbox:

- Can the dashboard reconstitute a full Report from a StoredScan (task #138 suggests yes)? If so the Coach-tab context fix is a few days; if the stored row only holds scores, it needs a slim context builder and is bigger.
- Was the check-in deliberately rendered without Max's face and name to keep it quiet, or is that a leftover from when it lived inside his read on the results page (the CSS comment at style.css:7554 describes it as an inset inside his read)?
- The owner's screenshot shows four protocols "Ready to start" at once. Is tracking several in parallel the intent, or should "I'm going with this" on the results page cap the list so the single check-in card can keep up?

## 4.2 Max the mascot: character design and animation

Files: src/ui/maxCharacter.ts, src/ui/maxIdle.ts, src/ui/maxPet.ts, mx-* rules in src/style.css

Max is a well-reasoned appliance, not a coach. The behavioural layer is genuinely strong: the six-mood vocabulary drawn once and swapped by class, the "concerned, never disappointed in you" ethics, the reaction API (cheer, nod, shake, under two seconds, replace-not-queue), the wave-twice-then-stop rule, the silence-first idle scheduler and the mx-asleep class that pauses eight animations per drawing when he is off screen are the work of somebody who understood what Duo does. The drawing underneath cannot deliver any of it: an egg with a dark visor, two light-bar eyes and one elbow-less paddle has three degrees of freedom (move the egg, rotate the paddle, fade in a prop), so all 24 states in M1 are the same silhouette wearing a sticker, and the CSS class-swap model that drives them cannot blend, so every act begins and ends with a measured snap of several pixels and a 6 to 8 percent scale pop. The fight and the fall the owner dislikes are now unreachable (mountMaxPet has no caller) yet still ship in every drawing, and one real bug turns him rigid: a single tap leaves `.poked` on the SVG forever, which outranks both the breathing and the body half of every subsequent act. A redesign should keep the rules, the moods and the sleep and reduced-motion gating, and replace the body and the animation runtime, because the body is the ceiling.

| sev | finding | where | fix | effort | status |
|---|---|---|---|---|---|
| P1 | One tap freezes Max for the rest of the session | `src/ui/maxCharacter.ts:481` | Remove `poked` on the hop's animationend, the same way greet() removes `waving` (lines 670-675), or time it out at 620ms. Also drop the rule's specificity to `.poked .mx-bob` so it can never outrank an act. Add a test in maxCharacter.test.ts that a poked drawing still has a running mx-bob one second later. | S | confirmed |
| P1 | Silhouette reads as a smart device, not a coach | `src/ui/maxCharacter.ts:33` | Owner's call (2 Sep): the body stays. Pupils are added; volume and motion come from the 3D render, not from a new silhouette. | L | owner decided |
| P1 | Every act is the same egg with a different sticker | `src/ui/maxCharacter.ts:236` | Owner's call (2 Sep): no joints. The move set is limited to what a limbless body can do and rendered in 3D; the prop acts go. | L | owner decided |
| P2 | Every act starts and ends with a snap: the class-swap model cannot blend | `src/ui/maxIdle.ts:127` | Drive transitions with the Web Animations API instead of class swaps: keep the breath as a base animation and layer wind-up, act and settle with `composite: "add"` (or `accumulate`) so they ride on top of it; author each act's first and last keyframes to equal the wind-up's end and the settle's start. If the rig moves to Rive, its blend transitions solve this for free. | M | reader |
| P2 | Hovering mid-act teleports the arm and vanishes the prop | `src/ui/maxIdle.ts:176` | On pointerenter set `hovered = true` so the next act is skipped, and let the running act complete (every act's keyframes already return to rest). If an act must be cut, add `mx-settle` and hide the prop with a 150ms opacity fade rather than removing the class in one frame. | S | reader |
| P2 | The fight and the fall are dead code that still ships in every drawing | `src/ui/maxCharacter.ts:395` | Delete maxPet.ts, wireFight, the `fight` option, the mx-arms-block group, the nine dead keyframes and the .maxpet rules; keep a one-paragraph note in the header. If a knock-down ever returns it needs a ground plane, a parabolic arc, a centre-of-mass origin, limb lag and an impact squash, which means a rig, not a class. | S | reader |
| P2 | The full repertoire plays at 44 to 58px, where the props are smudges | `src/ui/maxCharacter.ts:434` | Raise the gate to about 88px (the maxtab-stage size) and make it an explicit option per surface rather than a measurement; below it run only breath, blink and glance. Also set `__mxWired` after the gate so a drawing that measured 0 inside a hidden tab can be wired later. | S | reader |
| P2 | The loader runs 34 animations and half the drawings never sleep | `src/ui/maxCharacter.ts:358` | Loader: one Max, cycle the mood by class on a 1.15s timer or by keyframes on the mood parts, instead of four stacked copies. Sleep: apply mx-asleep from one shared IntersectionObserver for every `.mx-svg` at mount time, independent of wiring. Make the pause rule win with `animation-play-state: paused !important` or wrap mood rules in `:where()`. | M | reader |
| P3 | Pupil follow permanently disables the lookout eyes and the thinking gaze | `src/ui/maxCharacter.ts:455` | Apply gaze through a CSS variable on a wrapper group (`--mx-gaze-x/y` consumed by a transform on a parent of .mx-pupils) so the keyframe animations on .mx-pupils keep composing; or only override while the pointer is inside the stage and clear both inline properties on pointerleave. | S | reader |
| P3 | Idle handle is discarded and listeners outlive the drawing | `src/ui/maxCharacter.ts:435` | Store the handle on the stage element and destroy it from the surface's own teardown (results.ts:143 already has a destroy pattern); remove the pointermove listener on the stage's pointerleave; move the `__mxWired` assignment after the gate succeeds. | S | reader |
| P3 | Reduced motion leaves excited Max frozen mid-hover, 7px off his shadow | `src/style.css:4920` | Add `animation-iteration-count: 1 !important` to the global reset at line 133 as belt and braces, and make the Max block win over mood rules (either `.mx-svg .mx-bob { animation: none }` selectors or wrap the mood rules in `:where()`), holding `transform: none` on .mx-bob and .mx-shadow. | S | reader |

Questions the reader could not settle from the sandbox:

- Is the pet fully retired (mountMaxPet has no caller), so maxPet.ts, wireFight and the fight and fall states can be deleted outright, or is it parked for a return?
- Is a character runtime dependency acceptable (Rive is roughly 150KB, Lottie similar) given the deferred-face-engine precedent, or must Max stay dependency-free SVG plus CSS? The answer decides whether blending is achievable at all.
- Does the blue-and-visor device register have to survive, or is the owner open to real eyes with sclera and pupil, a mouth that opens and feet, now that Duo is the stated reference?

## 4.3 Coach Max server side: persona, conversation memory, plan crafting, product links

Files: api/_maxPersona.ts, api/_maxConversation.ts, api/_maxAccess.ts, api/max-chat.ts, api/max-conversations.ts, src/engine/maxContext.ts, src/engine/recommendations.ts, results.ts link builder

The server is well built where it matters most: every query is owner-scoped, the age comes from the profile row rather than the payload, the scan block is sanitised against tag and newline forgery, the rate claim is atomic and refunded on provider failure, and the cached persona block (about 8.2k chars) clears the 1,024-token minimum for the configured model, so I found no cross-user leak and no free-proxy path. What Max actually receives per turn is narrower than the product says: the current report's headline figures, 9 of the measurements, four focus lines, a one-sentence delta, the titles of local protocols plus server plan items, and the last 16 turns of this one thread; he never sees other threads, protocol dates or check-ins, the quiz profile (goals, diet, consent), or any numbers at all when opened from the Coach tab or from a saved thread, where the prompt tells him the person has never scanned. After PR #224 the words of each conversation and an insert-only list of plan titles persist; plan state never updates back, so declined items stay active in his memory. The prompt bans em dashes and markdown and carries strong medical and self-worth rules, but it has no verdict ladder, no ban on attractive or handsome, and no rule against rarity claims, while the context block primes the exact "above N% of the reference set" framing. The weakest points for a paying member are the "Unlimited chats" promise against a 30-a-day cap, the Coach-tab amnesia, and silent truncation from a 700-token cap with thinking left on by default; the product links are honest but land on a search for display copy rather than a curated shelf.

| sev | finding | where | fix | effort | status |
|---|---|---|---|---|---|
| P1 | Paywall sells unlimited chats, server caps at 30 a day | `src/ui/maxTab.ts:76` | Change the benefit line to a true one ("Up to 30 messages a day with Coach Max") or raise or remove the cap. Have the client read X-Max-Remaining and show "N left today" under the composer once it drops below 5. Return a resetsAt ISO timestamp with the 429 instead of "tomorrow" and format it in the person's locale. | S | confirmed |
| P1 | Coach tab and reopened threads tell Max the person has never scanned | `src/ui/maxTab.ts:228` | Store the scan id on max_conversations at creation. When a thread is reopened or the tab chat is started with an empty context, rebuild the scoped block from that scan (or the latest own scan) via buildMaxContext before the request, either client-side from readAllHistory or server-side from a stored report summary. Until then, change the tab copy to match what he can see. | M | confirmed |
| P2 | Replies can be cut mid-sentence and saved that way | `api/max-chat.ts:250` | Pass thinking: {type: "disabled"} (or output_config effort low) for this chat route and give max_tokens text headroom. Watch the message_delta event for stop_reason "max_tokens" and append "I ran out of room there. Say continue and I will finish." before closing. Log usage.cache_read_input_tokens once to confirm the breakpoint is hit. | S | confirmed |
| P2 | Max never sees the quiz profile the plan cards are gated on | `src/engine/maxContext.ts:90` | Add a profile section to ContextInput and the scoped block: goals picked, channels consented to with a rule "do not advise on channels not listed", diet exclusions, declared skin concerns. Sanitise with the existing clean() and keep it below the cache breakpoint. | S | reader |
| P2 | Plan memory only grows; declined and judged items stay active for Max | `api/max-conversations.ts:93` | Make the sync a reconciliation: send title and status for every protocol including declined and judged, map to completed or replaced, and update on conflict instead of ignoring. Or add a DELETE on max-conversations for a plan item and call it when a protocol leaves the active set. | S | confirmed |
| P2 | Plan button keys off the question regex, not Max's promised sentence | `src/ui/maxChat.ts:254` | Detect the sentinel sentence in Max's final text (an exact string the prompt already mandates, so it is not prose parsing) and show the button when present; keep the question regex as a fallback. Longer term, have Max close a plan with a marker line the server strips and turns into a flag. | S | reader |
| P2 | Memory commands are brittle and Max cannot tell whether one fired | `api/_maxConversation.ts:43` | Loosen the parser (strip leading "can you" and "please", trailing "please", "thanks" and "?", allow a trailing clause). Append one line to the scoped block each turn: "Recorded this turn: added daily sunscreen to the tracker" or "No plan change was recorded". Render a small confirmation chip in the client from the header. | S | reader |
| P2 | System prompt has no verdict ladder and no rule against rarity claims | `api/_maxPersona.ts:267` | Add to SAFETY_RULES: "Describe a score only with these words: needs work, needs improving, below average, okay, alright, decent, good, very good, top of the scale. Never say attractive, handsome or beautiful. Never say how rare their face is or how many people are below or above them. A percentile may be quoted as a percentile only." Reword line 267 to "Percentile: 61st in the reference set". Pin both with a test… | S | reader |
| P2 | Compare link searches display copy with no region hint | `src/engine/recommendations.ts:151` | Add a query field per buy guide written as a shopping query ("adapalene 0.1% gel", "brow tint kit"). For direct links, add an owner-curated product_links table (rec_id, region, retailer, url, verified_at) served by a small endpoint; resolve region from the profile country or navigator.language; show the direct link with the retailer named; fall back to the search when no verified row exists or the row is older than… | M | reader |
| P2 | Saved chats cannot be deleted or archived | `api/max-conversations.ts:48` | Add DELETE /api/max-conversations?id= that sets archived_at, owner-scoped through maxAccessForUser like the reads. Add a row action in the Coach tab list and a scheduled purge of archived threads after 30 days. | S | reader |
| P3 | Em dash ban is a prompt request, not enforced on the stream | `api/max-chat.ts:277` | In the delta loop replace U+2014 with ", " before enqueueing and before persisting. It is a single code point, so chunk boundaries cannot split it. | S | reader |
| P3 | A failed turn leaves an orphan question in Max's server history | `src/ui/maxChat.ts:428` | In the no-text branch of the stream's finally block, delete the just-inserted user row alongside the claim release. Or insert the user message only after the first text delta arrives. | S | reader |

Questions the reader could not settle from the sandbox:

- CLAUDE.md bars model identifiers in code comments and pushed artifacts, yet api/max-chat.ts:40-46 names two model families in a comment and DEFAULT_MODEL pins an identifier. Is a functional constant exempt, or should the identifier live only in the MAX_CHAT_MODEL environment variable with a neutral comment?
- The client waits up to 90 seconds for a stream (GIVE_UP_MS in maxChat.ts:49). Does the Vercel function configuration for /api/max-chat allow a streamed response that long, or is there a shorter platform cutoff that would end a slow plan reply with the "lost my train of thought" line?
- The #224 plan doc lists duplicate-request safety as a release gate, but the client mints a fresh turnId per fetch so the unique index on (conversation_id, client_turn_id) never dedupes a retry. Was that gate exercised, and is the client-side inFlight guard considered sufficient?

## 4.4 Scan flow: landing, upload and camera entry, front photo confirm, scan-loading pass

Files: src/main.ts, src/ui/camera.ts, src/ui/autoCapture.ts, src/ui/photoTutorial.ts, src/ui/scanGate.ts, src/ui/measurePass.ts, index.html, src/style.css

The landing itself is in good shape: the serif headline, the dark demo card and the two dressed capture buttons read as a real product, the copy is plain and honest, and the measure pass is a genuinely premium loading screen because it draws the real constructions off the real landmarks with a bar tied to its own known duration. The weakness is everything between choosing a photo and seeing that pass. The upload path can sit silent for the whole 6.5 MB engine download and then a further 16 MB segmentation download with an empty narration line and a bar at zero, and every failure it can produce (engine failed, unreadable HEIC) is written in capitals to a mono line below the proof and journey sections where nobody is looking. The most common recovery action, Retake photo, re-asks the gender question and re-offers the tutorial inside the same scan, which reads as the app forgetting what it was just told. Underneath, five synchronous detections on a 2160 px canvas freeze a reading band that animates `top`, so the one moment the screen promises motion is the moment it stalls. These are all small, well-located fixes; the architecture is right, the waits and the handoffs are what let it down.

| sev | finding | where | fix | effort | status |
|---|---|---|---|---|---|
| P1 | Retake photo re-asks gender and re-offers the tutorial inside the same scan | `src/main.ts:2011` | Give the retake its own path that keeps the scan's answers: on decline, call openCamera() directly for the camera method and el.fileInput.click() directly for upload, skipping ensureScanAllowed, ensureSex and the tutorial offer. If the allowance gate must still be honoured, pass a `retake` flag that ensureScanAllowed treats as the same scan (its own comment already says re-verifying is the SAME scan). | S | confirmed |
| P1 | Upload path goes silent while the engine downloads, and every error lands in an all-caps mono line below the fold | `src/main.ts:1745` | Paint the scan stage the instant a file is chosen: show the photo, add the scanning class, and set the narration line to "Loading the analysis engine" while ensureEngine resolves, then "Finding the face". Report decode failures and engine failures in a dialog next to the stage (confirmScanAction already exists) in sentence case: "This browser cannot read HEIC photos. On iPhone, set Settings, Camera, Formats to Most… | S | reader |
| P1 | First scan stalls on a 16 MB segmentation model with a blank narration line and the bar at zero | `src/engine/headCovering.ts:10` | Warm segmenter() inside warmEngine alongside initLandmarker; it shares the same wasm fileset. Narrate the wait: "Checking for hats and hoods" in el.status while it runs. Race detectHeadCovering against a bounded timeout (four to six seconds) that resolves to available:false, so a slow connection skips the check rather than stalling the scan. Consider serving the model brotli-compressed or trimming it if a smaller… | M | confirmed |
| P2 | Stale rejection sentence and a dead Retake button sit under the next photo while it is being read | `src/main.ts:1717` | Clear el.status (and remove `swapping`) in resetToUpload, and set an honest opening line at the top of handleCanvas before the first await: "Finding the face". | S | reader |
| P2 | The reading band animates `top`, so it freezes during the synchronous five-pass detection | `src/style.css:516` | Animate the band with transform: translateY() and give it will-change: transform so it composites; do the same for the reel-land keyframe. Yield to the event loop between VARIANTS in detectStable (await a rAF or setTimeout 0 per variant) so the paint keeps up, or move detection to a worker as a follow-up. | S | reader |
| P2 | The two capture buttons sit below the fold on common laptop viewports | `src/style.css:244` | Bound the card by viewport height as the live-camera rule already does (width: min(460px, calc((100vh - 300px) * 0.8))) so the frame shrinks until the buttons fit, or repeat a compact Use camera / Upload photo pair under the headline in the left column at 1100px and above. | S | confirmed |
| P2 | Camera says "Center your face in the frame" in red while the engine is still downloading | `src/engine/captureGuide.ts:498` | Pass isReady() into checkFrame (or check it in onCheck) and while the landmarker is not loaded show a neutral, not red, state: hint "Loading the face engine", detail "A few seconds on first use". Keep the lamp grey rather than red until the first detection runs. | S | reader |
| P2 | No-face and rejection screens drop out of the stage into a half-empty two-column layout with a hard cut | `src/main.ts:1921` | Keep the stage for decision screens: swap `scanning` for a `holding` class that shares the stage layout without the sweep, or flipThrough the frame down and render the sentence and buttons in .pane-analysis so the right column is used. Also label the upload path's button "Choose another photo" (captureMethod is known). | S | reader |
| P3 | Front photo preview is pillarboxed in a black slab inside the light confirm card | `src/style.css:1685` | Size the figure to its content: width: fit-content; margin-inline: auto; with the border and radius on the figure, so the photo carries its own edge. Keep the dark background only as a fallback while the canvas paints. | S | reader |
| P3 | Scan narration and rejection messages are not announced to assistive tech | `index.html:328` | Add aria-live="polite" and aria-atomic="true" to #status, give the bar role="progressbar" with aria-valuenow updated from the tick, and move the rejection buttons into a sibling container so the live region announces only the sentence. | S | reader |
| P3 | Greyed-out wordmark and a 9 px "FRONT + SIDE · V1" tag on the front door | `index.html:85` | Render the wordmark as static text (not a disabled button) at full ink for guests, and drop the tag from the landing or replace it with something a visitor can use, such as "On-device analysis", at a readable size and contrast. | S | confirmed |
| P3 | Escape on the confirm dialog discards the capture and re-opens the camera | `src/ui/scanConfirm.ts:111` | Make Escape a no-op on this dialog (or focus the Retake button without activating it), and reserve the destructive path for the explicit Retake photo button. | S | reader |

Questions the reader could not settle from the sandbox:

- Is /models/selfie_multiclass_256x256.tflite served brotli-compressed on Vercel, and what is the measured first-scan time on a mid-range Android over 4G? The sandbox could not observe network timing.
- Is keeping detection on the main thread (no worker) a deliberate decision because of the deterministic-landmark promise, or would a worker for detectStable be acceptable?
- Is the landing meant to be scrolled to reach the capture buttons on 13-inch laptops, or should the CTA always be in the first viewport?

## 4.5 Signed-in results report after a scan

Files: src/ui/results.ts, metricDetail.ts, scoreStrip.ts, pillarDeck.ts, scoreCard.ts, report CSS

The bones are strong: a real empirical curve with a marker that cannot disagree with the number, tappable measurement rows that draw callipers on the face, a well-built metric modal that pans between constructions, honest "not scored" and "no curve" states, and a mobile hierarchy (summary, sticky rail, return-to-face pill) that is already ahead of the OLD-ui phone shots. Max clipped in the corner (M9) is gone in the current code: renderResults unmounts the pet and a test pins that. The weakest point is copy discipline on the region tabs, where a typed-out paragraph prints the exact count-rarity sentence CLAUDE.md bars ("only N in every 100 guys are below you"), in coach voice, for every account including guests, and reads a raw percentile while the chips beside it read the stated one. Second weakest is navigation state: the scroll-to-top fix for tab changes cannot fire under a sticky rail, and the phone overview silently drops the reference switch and the rescan delta. The rest is premium polish: an entry choreography that skips the action row, a 3-column button grid that shows a hole, an oversized curve callout on desktop, and a listener that stacks per scan. All of the OLD-* shots predate several of these areas, so the em-dash chip and "Top 38.4%" they show are already fixed in code; the findings below are against the current build.

| sev | finding | where | fix | effort | status |
|---|---|---|---|---|---|
| P1 | Region tabs print the barred count-rarity sentence, in coach voice, to everyone | `src/ui/templates.ts:189` | Rewrite regionSummary in the plain register the rest of the report uses and route every figure through standing()/statedPct. For example: "Your {best} is the strongest reading here: {value} against a {sex} average of {mean}, {rankShort}. The one to work on is {worst}: {value} against {mean}, {rankShort}. All in, {score} out of 10 across the {region}. About {scoreHigherText(statedPct)} of {sex} faces score higher."… | S | confirmed |
| P2 | scrollReportToTop never fires: a sticky rail always reports top >= 0 | `src/ui/results.ts:681` | Anchor the scroll on a zero-height sentinel placed just before the rail (the same trick #view-toggle-anchor uses) with scroll-margin-top equal to the sticky offset, and scroll when the rail carries is-stuck or when the sentinel's top is below the sticky offset: `if (sentinel.getBoundingClientRect().top < stickyTop - 1) sentinel.scrollIntoView({ behavior, block: 'start' })`. Honour prefers-reduced-motion as the… | S | confirmed |
| P2 | Phone overview drops the reference switch, the rescan delta and the guest label | `src/style.css:5881` | Render a compact row inside mobileScoreSummary under the view cards: the refswitch button and the delta chips (and the guest name as the OVERALL card's eyebrow). Alternatively keep the header and hide only .big and .big-chip, which the existing 5936 rule already does. Wire ref-switch once via the same document delegation wireMaxAsk uses so the mobile copy survives re-renders. | S | reader |
| P2 | Action row is a fixed 3-column grid that shows an empty cell and a truncated price | `src/style.css:1368` | Make .ract-row use repeat(auto-fit, minmax(0,1fr)) like .ract-utils already does, keep the odd-item span rule, and shorten the label to "Video analysis · $2.99" ("Voiced analysis · ready" once a credit exists). | S | reader |
| P2 | Two percentiles under one curve: "Bottom 20%" beside "About 81% score higher" | `src/ui/templates.ts:318` | Have populationLine and rarityLine pass the stated value: `scoreHigherText(statedPct(pct, tailLimit))`, or derive both strings from standing() so "Bottom 20%" always pairs with "About 80% score higher". Keep the clampToTail behaviour for the profile. | S | reader |
| P2 | Entry choreography skips Max's read, primary measurements and the action row | `src/ui/results.ts:2137` | Build the step list from `root.querySelectorAll(':scope > *')` plus the .ovw and .pillars children, in DOM order, so every direct block including .maxan, both panels and .ractions gets an --overview-delay. Keep the count-up and bar timing keyed to the same delay. | S | reader |
| P3 | Late entitlement or profile reads replay the whole overview animation | `src/ui/results.ts:2874` | Give showOverall a `quiet` option used by syncMaxSurfaces and the silent select: when #body already holds .overview-reveal, patch the affected nodes in place (maxan block, voiced button, lock cards) or re-render with animateOverview and countUp skipped and bars set to their final width. | M | reader |
| P3 | wireRecTracking stacks a document click listener on every scan | `src/ui/results.ts:2078` | Add `let recTrackingBound = false;` and return early when set, mirroring wireMaxAsk. | S | reader |
| P3 | Metric modal swipe is plausibly dead on touch: no touch-action on the stage | `src/ui/metricDetail.ts:492` | Add `.mdx-stage { touch-action: pan-y; }` so horizontal moves stay with the page's pointer events, and listen for pointercancel to clear downX. Keep the 44px threshold. | S | reader |
| P3 | Profile regions tell every user they are below average on comparisons | `src/ui/results.ts:1981` | In sideRegionDeck (and celebCard generally) check whether any reference face carries any of the region's metric ids; when none does, print the metricDetail line: "No reference face in the set carries profile measurements yet, so there is nothing to compare against. The set grows with every analysed face." Fix the threshold wording to "in the top 60% on the measurement" derived from CELEB_MATCH_MIN_PCT. | S | reader |
| P3 | Curve callout scales with the panel and dominates the desktop chart | `src/ui/curve.ts:174` | Cap the population SVG at max-width: 440px centred in the panel, or shrink the callout to 56x24 units with 8/7-unit text and a 1-unit stroke, so it reads as a label at every width. Keep the flip logic. | S | reader |
| P3 | Flat rescan chip prints "0.0 vs last scan" and "+0.0" on tiny moves | `src/ui/results.ts:1329` | When the class resolves to flat, print "No change vs last scan" (or "No change vs 3d ago") and drop the number; keep the signed number for up and down. | S | reader |

Questions the reader could not settle from the sandbox:

- On a desktop with a portrait capture the sticky .pane-photo (photo at 38% of 1240px plus caption, divider, Front/Side toggle and chips) can run past 800px tall; on a 768px-tall laptop viewport does the Front/Side toggle sit below the fold and stay unreachable while reading? The sandbox could not render this surface to check.
- Is the typed region paragraph (regionSummary, the mono typebox) meant to count as Coach Max's read in the owner's mind, or as the plain instrument? It is unlabelled on screen, so the answer decides whether the P1 fix is a rewrite or a gate plus a COACH MAX'S READ label.
- On a phone, once the photo has left and the 56px FRONT/PROFILE return pill appears over the right edge of the rail, do the last tabs (Symmetry, Plan) remain fully tappable at the end of the scroll? The CSS reserves 62px of padding but no fresh capture exists to confirm.

## 4.6 Onboarding funnel: guest signup wall, auth modal and /auth portal, first-run quiz, offer screen with Max, decline and downsell sheets, settings

The wall itself is the strongest part of this surface: the teaser shows the person's own two photographs with the score, ladder and eight regions held back, the sweep-then-pop reveal is short, and the copy is honest about what is behind the blur (09-guest-signup-wall.png). The auth form, price cards and legal lines are also carefully reasoned, with the $0-anchored price, the renewal sentence under each button and no invented outcome statistic. The weakest point is what happens the moment someone signs up: the wall promises "It unlocks the moment you are in" and the account then lands in a locked six-step questionnaire (last name, mobile, how you heard about us, two free-text essays) that ends on a paywall, before any result. Around that sit several first-use rough edges a paying user would hit: three greyed-out buttons as the first impression of the wall, a sign-in form headed "Create an account", the wrong error sentence for an unconfirmed email, and an offer screen where the price block overlaps and Max sits clipped beside an oversized bubble. None of these are large builds; the questionnaire is the only one that needs a product decision.

| sev | finding | where | fix | effort | status |
|---|---|---|---|---|---|
| P1 | Signup wall promises instant unlock, then locks the person in a six-step questionnaire ending on the paywall | `src/engine/onboarding.ts:154` | Keep one required card (first name and date of birth, which is all the plan gate needs) and make last name, mobile, discovery source and both essays optional with a visible Skip. Show the analysis first and run the remaining questions from the plan step or the Coach tab, where the answers change something the person can see. If the lock must stay, name the reason on the card: "One question so we know which plans we… | M | reader |
| P2 | "Email not confirmed" and "email rate limit exceeded" both surface as "That does not look like a valid email." | `src/engine/auth.ts:490` | Add explicit branches ahead of the generic email test: "not confirmed" -> "Confirm your email first. Open the newest link we sent to you, then sign in."; move the rate-limit check above the email check. | S | reader |
| P2 | Sign-in mode inside the wall is headed "Create an account to see your analysis" | `src/ui/authForm.ts:40` | Vary the title by mode in the analysis context: signup "Create an account to see your analysis", password "Sign in to see your analysis", link "Email me a link to see my analysis". Keep the lede as it is. | S | reader |
| P2 | Social buttons open as "CHECKING…", re-check on every mode switch, and on failure stay dead with a tooltip-only explanation | `src/ui/authForm.ts:189` | Memoise the availability promise at module scope so the check runs once per page, wrap the fetch in AbortSignal.timeout(4000), and on timeout or failure remove the social row (or render the buttons enabled and report the error in .acct-msg on click) instead of leaving disabled controls. Drop cursor: wait for the settled states. | S | reader |
| P2 | Closing the offer with the X keeps your self-scan; answering "Not now" then "No thanks" loses it, and nothing says so | `src/ui/onboardingFunnel.ts:207` | Pick one rule and apply it to every exit: either route the X and Escape through the same confirmation, or make the decline stamp only follow an explicit "No thanks" and say on the sheet that closing without answering keeps the choice open. Rename the primary button to "Keep the free trial offer". | S | reader |
| P2 | Max card price block overlaps: "for your first 7 days" collides with the weekly-price line | `src/style.css:5693` | Replace the negative top margin with margin: 6px 0 10px and give .plan-top b a small bottom gap so the two lines stack. Re-check at 1280px and 390px. | S | reader |
| P2 | Max pop-out on the paywall: a bubble the height of the phone screen and a character clipped to a sliver | `src/style.css:4375` | Give Max a fixed 96px slot beside the bubble with nothing clipped, cap the bubble at four lines with a tap-to-expand, and play one exchange on a tap of the card rather than on a timer. Keep the greeting on the timer, since that is the part that works. | M | reader |
| P3 | Offer headline "One more scan. Seven days to explore." is a riddle on the screen where it appears | `src/ui/onboardingFunnel.ts:708` | "Your pathway is ready. Seven days free to explore it." and keep the card details for what the trial includes. If the one-personal-scan rule matters here, say it in the lede: "Free accounts get one scan of their own face. A trial gives you a scan every week." | S | reader |
| P3 | Gate strip says your face is "about to be" measured, directly under a card saying it just was | `src/ui/gateDemo.ts:32` | "Reference faces, measured the same way yours just was." | S | reader |
| P3 | Quiz opens with "Let's make this yours, first." when no name is known | `src/ui/onboardingFunnel.ts:997` | Drop the vocative when the name is empty: "Let's make this yours." and "Let's make this yours, Nikau." when it is known. | S | reader |
| P3 | Password rule is 6 characters at signup and 8 at reset | `src/ui/authForm.ts:293` | Pick one minimum that matches the Supabase project policy and use a single constant for the placeholder, minlength and both checks. | S | reader |
| P3 | Plan card feature lists open only by clicking the card; the hint is not a control | `src/ui/onboardingFunnel.ts:832` | Render the hint as a button with aria-expanded and aria-controls pointing at .plan-feat, and let the card click delegate to it. | S | reader |

Questions the reader could not settle from the sandbox:

- Are Google and Apple sign-in actually enabled in the production Supabase project? If either is not, authForm.ts:212-217 leaves that button permanently disabled reading "COMING SOON" at the top of every wall and portal form.
- On a 390px phone, does the account modal open with the blurred teaser filling the first screen and the "Create free account" button well below the fold? style.css:7479-7486 puts the teaser first on narrow widths and the phone captures (09b, 09c) show the inline gate rather than the modal, so it could not be checked here.
- On the "We couldn't load your profile" screens (onboardingFunnel.ts:455, settings.ts:112), is the close button reachable on a phone? style.css:920 places .trial-loading .trial-close with margin: -280px 0 0 min(650px, 80vw), which looks like it lands off the right edge at 390px.

## 4.7 Side-profile flow: upload, automatic placement, the "Do these points look right?" question, manual placement, consent

The bones are good: the placement is measured before it is offered, the walkthrough is photo-first with a single in-frame advance, and the consent copy matches CLAUDE.md (opt-in, 90 days, not for advertising, nothing about a guest's prior). Against a premium bar the automatic path is the weakest part of the whole scan. The #154 simplification did not land as built: showReviewActions() is rendered and un-hidden before afterAutomatic() runs, so the full manual review screen (Confirm, One by one, Points are wrong, reset, sound toggle, and the thirteen tabbable handles) sits under both the question and the consent dialogs, exactly what screenshots 07, 08a and 08d show. The two dialogs then ask the same question about the same picture, in which the rings are drawn at 1.35 px and cannot be seen, and both cards carry fine print that is false. Underneath that, five of the thirteen points are never found in the photo (they are template positions at a head width that silently falls back to a population average), and nothing in the picture or the heading says so, which is what the misplaced jaw corner and hinge in 06 look like to a user: a finished placement with an accept button already focused. Smaller items (a leaked Enter listener, inconsistent focus and Escape, a consent card that does not match its siblings, stale and miscounted copy) are all cheap to fix.

| sev | finding | where | fix | effort | status |
|---|---|---|---|---|---|
| P1 | Review row and thirteen point handles stay live under the question and consent dialogs | `src/ui/sideFlow.ts:1535` | Keep mode-pending until afterAutomatic settles: remove it only on the manual branch and after the awaits (or in a finally), and call showReviewActions lazily on the edit branches instead of before the dialog. Set e.section.inert = true while any side dialog is open and clear it in each settle(). Adjust the ordering assertion in placementDialog.test.ts. | S | confirmed |
| P1 | Dialog preview rings are invisible at inspection size | `src/ui/sideFlow.ts:1784` | Scale the ring with the drawn box in the expanded view (for example radius = max(2.5, w / 160), stroke 1.25 px) and draw a 1 px dark halo under the teal, as the live .vpoint does with its inset shadow; raise connector alpha to about 0.7 when expanded. Keep the thumbnail constants and change the test to assert only the thumbnail ring stays a pinpoint. | S | reader |
| P1 | Both dialogs' fine print promises something the flow does not do | `src/ui/sideFlow.ts:1620` | Line 1620: "Placing them yourself gives a more accurate score. Taking these skips the walkthrough; you can still say they look off on the next screen." Line 1466: "Yes goes straight to your analysis. No lets you place them yourself first." | S | reader |
| P2 | The same picture is judged twice: "Use these points" then "Do these points look right?" | `src/ui/sideFlow.ts:1458` | Make the first dialog the question: heading "Do these thirteen points look right?", buttons "No, I will place them" and "Yes, use these". Yes goes to consent then analysis with verified true; No goes to the existing "Would you like to place them yourself?" branch. Delete the second question and keep the blocked and low-confidence framings on the merged card. Update placementFlow.test.ts and placementDialog.test.ts. | M | reader |
| P2 | Five template-placed points look identical to the eight measured ones, and a template head is presented as "We placed the points for you" | `src/ui/sideVerify.ts:614` | (1) Have headWidthFrom report the fallback (return width plus a templated flag) and let seedSidePointsSmart lower confidence or set a flag so the dialog uses the "Here is our best guess" framing and focuses "Place them myself" when the head width was not measured. (2) Draw BACK_POINTS with a distinct treatment in paintPlacementPreview and on .vpoint (dashed ring or amber) and say "the dashed five are estimated" in… | M | reader |
| P2 | Walkthrough Enter listener leaks across a retake or close | `src/ui/sideFlow.ts:1154` | Hold the handler in a module-level slot like sideKeyHandler (150) and remove it in clearWalkthrough and close, or register it with an AbortController whose signal is aborted in the verifier's destroy. | S | reader |
| P2 | Modal dialogs without focus containment, accept button pre-focused, Escape inconsistent | `src/ui/sideFlow.ts:1637` | Focus the card's h2 (tabindex -1) on open rather than either button. Set inert on #v-side while any side dialog is open. Give all three cards one Escape rule: either none (defensible given "no way past without answering") or the safe answer on all three. | S | reader |
| P3 | The consent card is a different component from the two cards before it | `src/style.css:1806` | Render consent through the side-mode card (same class, same animation, flex centring with overflow-y: auto), keeping its copy and thank-you state; delete the .side-feedback-* rules. | S | reader |
| P3 | "The five behind it" names four, then three, and never the chin bottom | `src/ui/sideFlow.ts:1462` | One sentence in all three places: "Eight points on the front of the face are measured from the photo. The other five (chin bottom, neck point, jaw corner, jaw hinge and ear notch) are estimated from an average head, so check those first." | S | reader |
| P3 | Upload screen tells people to "choose edit", a control that no longer exists | `src/ui/sideFlow.ts:182` | "Afterwards, TrueMax places thirteen points on the photo and asks whether they look right. You can accept them or place them yourself, one at a time." Apply to both the TS string and the static copy in index.html. | S | reader |
| P3 | Phone review row: the reset glyph becomes a lone unlabeled circle above three stacked buttons | `src/style.css:1842` | On 760 px and below keep the glyph and Confirm on one row (grid 38px 1fr) and stack the two ghost buttons beneath, or give the glyph a visible "Reset" word on phones. | S | reader |
| P3 | Sound toggle is a 24 px target at 65% opacity, mounted where no sound can happen | `src/style.css:6578` | 36 px hit area with the same 13 px glyph (padding, not a bigger icon), opacity .85 at rest; mount it only when the review or walkthrough actually starts (the edit branches); keep aria-pressed and add a brief "Sounds on" / "Sounds off" label fade beside it. | S | reader |

Questions the reader could not settle from the sandbox:

- On a 390 x 844 phone, does the "Do these points look right?" card fit without scrolling? EXPANDED_RESERVE_H is 320 (sideFlow.ts 1806) but the card's own furniture by the stylesheet (backdrop and card padding, label, heading, four-line copy, buttons, two-line fine print) sums to roughly 365 px, which would put the answer buttons just below the fold. No phone capture of this dialog exists.
- For the 06 capture, did seedSidePointsSmart take the segmentation or the mesh candidate, and did headWidthFrom fall back to the 0.73 average? That would confirm the template-head diagnosis behind the fifth finding.
- placementFlow.test.ts pins consent being asked on the "yes, they look right" branch, while confirmPlacement's own rationale (sideFlow.ts 1391 to 1397) says an untouched seed teaches nothing and asking is friction. Which rule is intended? If the yes-branch ask stays, the automatic path is three modals before analysis.

## 4.8 Signed-in dashboard: Home, Scans, Celebrities and Coach tabs

Files: src/ui/dashboard.ts, src/ui/maxTab.ts, src/ui/historyView.ts, the wordmark route in src/main.ts

The bones are better than most of the category: the hero leads with the average rather than the last photo, the noise band is drawn into both charts, deltas are labelled as noise when they are noise, and the bottom bar with a direction-aware slide and per-tab scroll memory feels like a place rather than a stack of modals. Against a premium bar the surface still falls short in three ways. Home does not answer "what should I do today": the one line that would (the streak-due sentence in greeting.ts) is only ever rendered in the empty hero, and the plan a person is meant to act on lives two taps away on the Coach tab, which reads as a settings page of white cards with 10px mono labels rather than a coach. On a wide window every size is a phone size inside a 1080px column, which is the "mobile site in a browser" tell the owner noticed. State handling has one real conflict (Home scan rows both navigate and expand), the entry route waits on three sequential network reads with no feedback, and the dashboard presents device-local history as the account's home, so a second device or a cleared browser looks like data loss. Note that OLD-dash-desktop.png and OLD-dash-phone.png show landing content under the dashboard; that is a full-page capture of a position:fixed overlay, not a layering bug, and those two captures predate the tab bar. The phone captures OLD-tab-home.png and OLD-tab-scans.png are the current structure.

| sev | finding | where | fix | effort | status |
|---|---|---|---|---|---|
| P1 | Home scan rows both navigate to Scans and expand in place on one tap | `src/ui/dashboard.ts:272` | Pick one behaviour. Recommended: delete lines 271-273 and keep the in-place expand, then add an "Open this scan" link inside .dash-scan-pop-in that calls openScanRecall(scan, previous) so the full report is still one tap away. If navigation is the intended behaviour, delete the popover markup, wireScanRows and the .dash-scan-pop CSS, and drop aria-expanded from the row. | S | confirmed |
| P1 | The "scan is due" sentence never renders for anyone who has a streak | `src/ui/dashboard.ts:428` | Render subline(ctx) under the hello in the populated hero as a .dash-hero-sub line. When streak.daysLeft is non-null, also surface it beside the New scan control (for example a small "by Sunday" under the pill, or "Scan by Sunday" as the pill label) so the action carries its own deadline. | S | reader |
| P2 | Wordmark tap waits on three sequential network reads with no pressed or busy state | `src/main.ts:1126` | Open the dashboard immediately with membership "member" and the cached knownAdult, then let the existing MEMBERSHIP_BRAND_EVENT upgrade the header badge and rebuild the Coach panel when the entitlement lands (dashboard.ts can listen once per open). Run ensureOnboarded in parallel rather than before. At minimum add a pressed state and aria-busy on #logo-home for the duration. | M | reader |
| P2 | Device-local history is presented as the account's home, so a new device reads as data loss | `src/ui/historyView.ts:207` | Short term (S): when signed in and local history is empty, say the true thing in both empty states: "Your scans stay on the device they were taken on. This device has none yet." Longer term (L): sync the numbers and thumbnails, which historyView.ts 213-214 already declares are not the sensitive part, keyed to the account so Home is the same on every device. | S | reader |
| P2 | Three different baselines for "how much did I move" within one scroll, with the chip's baseline unstated | `src/ui/dashboard.ts:603` | Label the chip baseline ("+0.3 vs last") in both dashboard.ts and historyView.ts, and add a one-line key under the hero meta: "Chips compare each scan to the one before. Max reads the whole run." Or collapse to two: make the hero delta the same first-versus-latest read Max uses, and keep the per-row chip as the only pairwise figure. | S | reader |
| P2 | No desktop type scale: phone pixel sizes in a 1080px column on a 2000px window | `src/style.css:3004` | In the min-width:1100px query raise the base: .dash-inner font-size 16px, mono labels 11-12px with slightly less tracking, hero number up to 112px, Coach and Scans body copy 15px. Use the width: place Region by region beside the hero on Home, and on Coach put the performance tracker beside the conversations card in a two-column grid. | M | reader |
| P2 | Coach tab headline promises a read of every measurement that the dashboard chat does not have | `src/ui/maxTab.ts:148` | Either build the context from the latest own scan (readOwnComparableHistory()[0], loadArchive for its report) the way results.ts does, and pass it to openMaxChat from the tab; or change the stage copy to what is true: "Plans, priorities and check-ins live here. Open any scan and he will talk through its exact numbers." Do the first if the archive load is under a second, otherwise ship the copy now and the context… | M | confirmed |
| P2 | Celebrities tab is a grid of initials with no relation to the user's own numbers | `src/ui/dashboard.ts:210` | In the detail, add a third column with the user's latest own value per metric (load the latest own scan's archive, same path scanRecall uses) and a small "you" marker; sort the list by closeness. If that is too much for the tab's weight, demote Celebrities to the Home strip and give the freed bar slot to the plan. | M | reader |
| P3 | Tablist semantics are broken and there is no keyboard model for tabs or the celebrity detail | `src/ui/dashboard.ts:233` | Move the scan button outside the role="tablist" element (wrap the three or four tabs in their own div with the role), add aria-controls to each tab and id to each panel, implement roving tabindex with arrow keys, give the search input aria-label="Search celebrities", and give the detail role="dialog" with Escape to close and focus returned to the card that opened it. | S | reader |
| P3 | Dashboard overlay lets touch scroll chain into the invisible landing page beneath it | `src/style.css:2761` | Add overscroll-behavior: contain to .dash, and toggle a body.dash-open { overflow: hidden; } class in openDashboard and close(). | S | reader |
| P3 | Empty dashboard quotes 0.9 points of noise while every other surface prints 0.6 | `src/ui/greeting.ts:106` | Interpolate DISPLAY_NOISE.toFixed(1) into the greeting line and the templates.ts sentence, and add the two to the test that pins noise copy so the constant cannot drift again. | S | reader |
| P3 | Check-in card on the Coach tab breaks subject-verb agreement with plural plan titles | `src/engine/protocol.ts:366` | Rephrase so the verb does not depend on the noun's number: "I only ask because something like that takes about 16 weeks before anyone could honestly tell you whether it worked, and that clock starts the day you start, not today." Or carry a plural flag on the protocol and pick needs/need. | S | reader |

Questions the reader could not settle from the sandbox:

- Is the dashboard meant to become the post-sign-in landing for a returning member? Today only the wordmark opens it (main.ts 1110) and nothing after sign-in routes there; dashboard.ts 46-47 explains first load goes to capture for the TikTok funnel, but that reasoning is about a first visit, not a member with a streak.
- Are scan numbers intended to sync to the account eventually? The Scans footer says device-only, while the code describes the history and streak as what the account is for; the answer decides whether the empty-state copy fix is a stopgap or the design.
- Where should the daily plan live: is the Coach tab the intended home of "Your current plan", or should the next action surface on Home under the hero so a returning user sees it without a tab change?

## 4.9 Motion and transitions across the whole app: src/style.css

Files: 337 transition/animation declarations, 41 infinite loops

The set pieces are genuinely strong: the photograph landing (capture-settle), the one-way reading band, the FLIP on the stage (camTakeover.ts), the report arrival, the region point-to-point transition, and the rundown renderer, which uses one quintic smoothstep and four named constants for every move, are above what most consumer apps ship, and reduced-motion coverage is broad at 60+ media blocks. What is missing is a system. style.css carries 58 distinct durations (80ms to 7.5s, around 30 of them under 700ms) and 53 distinct easing tokens, 48 of them hand-written cubic-beziers of which 30 are used exactly once, so a single region tab tap runs five clocks on five curves and the app feels tuned scene by scene rather than of a piece. The weakest points are the exits (every sheet, dialog and overlay animates in and is removed in one frame), the hard display cuts between scan screens, and a handful of layout and paint properties animated during the scan and on scroll on a phone. The one outright bug is the global reduced-motion rule at line 133: flattening durations to 0.01ms turns the 41 infinite loops that are not individually stopped into per-frame strobes on the trial spinner, the typewriter caret and Max's antenna.

| sev | finding | where | fix | effort | status |
|---|---|---|---|---|---|
| P1 | Global reduced-motion rule turns infinite loops into per-frame strobes | `src/style.css:133` | Replace line 133 with the standard pattern: `* { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; animation-delay: 0ms !important; transition-duration: 0.01ms !important; transition-delay: 0ms !important; scroll-behavior: auto !important; }`. Then give the spinner a static state: `.trial-loader { animation: none; border-top-color: var(--line); }` with the loading text carrying the… | S | reader |
| P2 | Every modal, sheet and overlay animates in and is removed in one frame | `src/ui/maxChat.ts:72` | One helper in src/ui/dismiss.ts: `leave(el, cls = "leaving")` adds the class, resolves on animationend or a 240ms fallback timer, then removes the node; under prefers-reduced-motion it removes immediately. CSS pairs each entrance with `.leaving` running the same keyframes with `animation-direction: reverse` at 0.6x the enter time and the exit curve (for example `.maxchat.leaving { animation: mc-fade 110ms… | M | reader |
| P2 | No motion system: 58 durations, 53 easings, five clocks on one tab tap | `src/style.css:753` | Add tokens to :root and migrate by search-and-replace, keeping the curated set pieces (capture-settle, frame-read, mx-* character keyframes, offer stagger, acct teaser) as named exceptions. Durations: `--t-instant: 100ms` for colour, border and opacity on hover and press (absorbs the 80 to 160ms cluster); `--t-fast: 180ms` for state changes that do not move position: chips, toggles, tab selection, tooltips,… | M | reader |
| P2 | The reading band animates `top` across the photograph for the whole scan | `src/style.css:518` | Keep the band at `top: 0` and animate `transform: translateY(-105%)` to `translateY(240%)` (the same travel expressed in the band's own height), with `will-change: transform` only while `.scanning`. Convert the others the same way: idle-sweep to translateY, acct-sweep to a translateX on an oversized child, acct-hunt and the rangebar and track thumbs to `transform: translateX(calc(var(--x) * 1%))` on a 100%-wide… | S | reader |
| P2 | Phone header animates `padding` on scroll and re-lays out the page under the thumb | `src/style.css:5842` | Give the header one fixed padding and express the compact state with transforms on its children (`.wordmark { transform: scale(.82); transform-origin: left center }`, avatar `scale(.8)`) plus an opacity fade on `.tag`; the height change then comes from a single `height` value set on the header with the rail top hard-coded to it, no live measurement needed. For the caption collapse use the `grid-template-rows: 1fr`… | S | reader |
| P2 | Scan screens cut between each other with display toggles | `src/main.ts:3104` | One `swapView(from, to, dir)` in main.ts: add `.leaving` to `from` (opacity 1 to 0 over --t-fast with --e-in, translateX(-12px * dir)), then toggle `hidden` and play the existing `view-from-right/left` keyframes on `to`, forcing a reflow between class writes as dashboard.ts:352 does. Route startSide, onBack, showFrontReview and resetToUpload through it. Skip the animation under reduced motion and when `from` is… | M | reader |
| P3 | Entrance keyframes blur large surfaces and `forwards` fill leaves blur(0) behind | `src/style.css:764` | Drop `filter` from overview-drop, offer-shell and dash-in-head (opacity plus translateY plus scale(.985) reads the same at these sizes), or if blur is wanted keep it under 3px on one element only. Use `backwards` fill and end at `filter: none`, not `blur(0)`, wherever it stays. | S | reader |
| P3 | Layout properties transitioned on whole-page containers, and two accordion techniques | `src/style.css:267` | Run the big three (landing collapse, report column, side-inner) through the existing `flip()` in camTakeover.ts so the same visual is a compositor transform; standardise every accordion on the 0fr/1fr wrapper; make the placement card's expand a FLIP on the card with the canvas drawn at final size. | M | reader |
| P3 | Press transforms that reverse or get destroyed mid-transition | `src/style.css:2405` | Make the swap a one-shot class added on click and removed on animationend, as retakeGlyph does (`.cam-swap.spun svg { animation: retake-spin .45s var(--e-io) }`). For tabs use `:active { transform: scale(.975); transition-duration: 60ms }` and defer buildTabs by one frame when the pressed tab is inside the row being rebuilt. | S | reader |
| P3 | Measure pass: narration writes before its fade finishes and the bar eases out | `src/ui/measurePass.ts:383` | Drive the bar linearly (`p * 100`) so it represents time, which is the motion system's rule for progress. Use one cross duration token (--t-fast 180ms) for the status fade, the timeout and the viewfade so they cannot disagree, and write the text on transitionend rather than a timer. | S | reader |
| P3 | Two smooth scrolls in main.ts ignore prefers-reduced-motion | `src/main.ts:1674` | Add `html { scroll-behavior: smooth } @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto } }` and drop the `behavior` option from every scrollIntoView call, or export one `scrollTo(el)` helper from countUp.ts next to prefersReducedMotion and use it in all five places. | S | reader |

Questions the reader could not settle from the sandbox:

- Does the landing-page collapse (#v-upload grid animation, style.css 267) ever run on a phone, or is body.cam-takeover the only phone path? The min-width 1100px wrapper suggests desktop only, and the sandbox could not open the camera on a phone viewport to confirm.
- Has the measure pass been profiled on a mid-range Android phone with the frame-read band running alongside the detector? The sandbox has no phone GPU, so the lag findings are from the properties animated, not from a trace.
- Under Reduce Motion should the trial spinner keep rotating (progress rather than decoration) or become a static ring with the text carrying the wait? The fix for the global rule depends on that call.

## 4.10 Colour, typography and theme consistency

Files: src/style.css tokens and literals, src/quick.css, src/league/league.css, dark takeover surfaces

The core light theme is in good shape: the :root tokens are well reasoned (the --mut comment shows contrast was actually measured), Fraunces at the top of its opsz axis with Inter body is a genuinely premium pairing, and the landing, auth and guides captures (01, 03, 04) read as one product. The system frays at the edges. Only 13 colour tokens exist, yet style.css carries 277 hex and 282 rgba literals (100 unique six-digit values, 15 distinct near-blacks, 21 neutral greys), quick.css adds six more blacks and three more greys, league.css runs its own palette, and every dark takeover (tutorial, lightbox, face frame, featured plan card, Max bubble, League) invents its own black. The weakest points a paying user hits first are the three brand-wordmark states that sit at 1.3 to 2.1:1 on cream, the League page rendering in Times and DejaVu because it never loads the brand fonts, and a type scale with 39 distinct sizes of which 158 declarations are under 12px, which is why the Coach tab reads as a settings page.

| sev | finding | where | fix | effort | status |
|---|---|---|---|---|---|
| P1 | Member and Max wordmark states are neon on cream at 1.3 to 2.1:1 | `src/style.css:178` | Keep the base .wordmark colours (TRUE in --ink, MAX in --acc, 5.25:1 on card) for every state on the light theme, and drop the text-shadow glows there. If member and Max states must be visible, express them as a small chip beside the wordmark ("MEMBER", "MAX") using --acc on --acc-soft, and move the neon variants behind a .on-dark scope for reel frames only. Raise .brand-guest to --mut at full opacity. | S | reader |
| P1 | League page renders in fallback fonts because it never loads Fraunces or Inter | `src/league/league.css:33` | Add the two self-hosted imports at the top of league.css: @import "@fontsource-variable/fraunces/opsz.css"; @import "@fontsource-variable/inter/wght.css"; (both are already in the bundle, latin subsets only), delete the local() @font-face, and set font-variation-settings: "opsz" 96, "wght" 300 on the hero heading so it matches the app's display axis. Replace the SF Mono --mono in league.css with Inter to honour the… | S | reader |
| P2 | Fine-print labels at 9px sit between 1.6:1 and 1.8:1 | `src/style.css:196` | Give every caption a floor of 11px and --mut (4.60:1 on --bg). For the version chip, use --mut on --line border at 11px with 0.1em tracking; for .foot use 11px --mut and make the Privacy and Terms links --acc. Retire #b6b8b2 and #c2c3be as text colours; keep them for hairlines only. | S | reader |
| P2 | --warm is used as running text at 3.4 to 3.8:1 | `src/style.css:2540` | Split the token: keep --warm #c4694f for borders, bars and chips, and add --warm-ink #a44535 for any text under 18px (down deltas, cautions, errors). Apply the same split to --down. Both values already exist in the file, so this is a token rename plus a sweep of about ten rules. | S | reader |
| P2 | Nine greens in play, and the answered button puts white on 3.0:1 green | `src/style.css:6545` | Define exactly two accent tokens: --acc #0e7a68 for text and fills on light ground (already 4.73:1 on --bg), and --acc-lit #4bf5c5 for fills on dark ground with --ink-on-lit #071e19 text. Retire #16a97a, #34c79a, #39edbd, #12dca8, #2f9e73 and #107a57 in favour of those two. Repaint .gnext-in.ready as --acc-lit with dark text so the answered state matches the featured CTA and clears 12:1. | M | reader |
| P2 | No type scale: 39 sizes, half-pixel steps, and the Coach tab set in 9.5 to 12px | `src/style.css:5444` | Adopt a fixed scale as tokens: --t-xs 11px (labels, floor), --t-sm 13px, --t-md 15px (body), --t-lg 17px, --t-xl 22px, --t-2xl 28px, plus the existing display clamps for Fraunces. Sweep every declaration under 12px up to --t-xs, and set the Coach tab body (.maxtab-msg, plan rows, tracker copy) to --t-md with the eyebrow badges at --t-xs. Delete the half-pixel sizes as part of the sweep. | M | reader |
| P2 | 277 hex and 282 rgba literals bypass 13 tokens; 30 different near-blacks | `src/style.css:21` | Add a second tier of tokens and sweep: --ink-2 (secondary ink), --dark-bg #101113, --dark-panel #191b22, --dark-line rgba(255,255,255,.16), --on-dark #f7fffc, --on-dark-mut rgba(255,255,255,.62), --hairline (the light greys). Rule: no hex outside :root except gradients and photo-overlay scrims, and those documented with a one-line reason. Do it in three PRs: greys, blacks, greens. | M | reader |
| P2 | Every takeover is a different black, and /quick tints the browser chrome dark over a cream page | `quick.html:23` | Set quick.html theme-color to #f4f3ef to match its body, or give /quick the League's dark ground since it is a League page. Then use the --dark-bg token from the census fix for every full-screen takeover and dark card, and give each takeover the same 0.2s fade so the move into dark feels like one gesture across the product. | M | reader |
| P2 | Featured plan card: 9px price caption collides with the weekly line, and gold arrives as a third accent | `src/style.css:5693` | Remove the -4px top margin on .plan-week and raise .plan-top small to 11px with a 4px gap so the caption and the weekly line stack. Drop the gold on MAX inside the card: TRUE in --on-dark, MAX in --acc-lit, no glow. Reserve any gold for the tone scale (.tone-mid) where it means something. | S | reader |
| P3 | Max's cobalt is unbound to any token and disagrees with the only other blue | `src/ui/maxCharacter.ts:63` | Name it: --max #4f82e6 and --max-deep #2b52a6 in :root, have maxCharacter.ts read them (or export them from one module both sides import), and repaint the walkthrough asking button and .vpoint.gfocus with --max so the blue always means Max. Keep the mint antenna as the brand tie. If the owner prefers a single-family palette instead, shift BODY_MID toward the teal (#1f8f8a family) and test against M1. | S | reader |
| P3 | --muted is referenced 17 times but never defined; three fallback greys stand in for one token | `src/quick.css:315` | Replace var(--muted, ...) with var(--mut) and strip every fallback value from var(--mut, ...) and var(--acc, ...) in quick.css and style.css; style.css is always loaded first on those pages. Replace calib.css's nine #6b7280 with var(--mut). | S | reader |
| P3 | Guides page wordmark and breadcrumb wear the browser's default underline | `src/style.css:3589` | Move text-decoration: none onto .wordmark itself (it is a button on the app and an anchor on the content pages, so the rule belongs on the class). Style .guide-breadcrumbs a as --mut with an underline only on hover, matching the app's other quiet links. | S | reader |

Questions the reader could not settle from the sandbox:

- Are the neon member and Max wordmark states (#12dca8 with glow, gold MAX) meant to appear on the cream app at all, or were they designed for the dark reel frames and leaked into the topbar?
- Should the Creator League stay a permanently separate visual world with its own --lg tokens, or should it consume the same dark-surface token set as the app's takeovers once one exists?
- Is a system dark mode on the roadmap? Nothing handles prefers-color-scheme today, and the answer decides whether the dark-surface tokens should be built as a full theme or only as a material for takeovers.

## 4.11 Performance and lag

Files: boot path, bundle composition, engine loading, scan pipeline main-thread cost, memory, Max animation cost

The landing itself is in reasonable shape at runtime: 654KB total transfer, first paint at ~300ms on localhost, zero running animations, only 80ms of long tasks unthrottled, and the demo reel is correctly parked off-screen and in hidden tabs. The weak point is the first scan, which is where a paying user forms their opinion. Measured on the built bundle with a 1728x2160 upload: the front scan blocks the main thread for 3.99s unthrottled and 11.0s at 4x CPU throttling (a mid-range phone proxy), in two big stalls, because five full-size detections per photo run synchronously (thirty for a camera burst) and because a 16MB segmentation model plus a second 11MB WASM runtime are fetched and instantiated in the middle of the scan rather than warmed with the engine. During those stalls the scanning sweep freezes, since it animates a layout property. The bundle is the second issue: the landing parses 1.03MB of decoded JavaScript across six modulepreloaded chunks, including all of supabase-js (storage, postgrest, realtime) for signed-out visitors and the MediaPipe JS glue that the WASM deferral was supposed to keep off this page, because everything in main.ts is a static import. Memory is bounded rather than leaking (canvases are shrunk on reset), with one real accumulator: a document-level click listener added on every results render. Max's cost is modest per instance but structurally main-thread (inner-SVG transforms) and several instances never get the sleep class the codebase relies on.

| sev | finding | where | fix | effort | status |
|---|---|---|---|---|---|
| P1 | First scan fetches a 16MB segmenter and a second WASM runtime mid-scan | `src/main.ts:1907` | Warm the segmenter with the engine: in ensureEngine, after initLandmarker resolves, call the shared segmenter() so the model and second module arrive during the camera permission and tutorial. Feed segment() a 512px copy of the photo instead of the 2160px canvas. Start detectHeadCovering before detectStable and await it afterwards so the fetch overlaps the CPU work. Longer term, evaluate a smaller covering check so… | S | reader |
| P1 | Landmark detection runs five full-size passes per photo synchronously on the main thread | `src/engine/consensus.ts:39` | Move FaceLandmarker into a Web Worker (tasks-vision supports workers; vercel.json already allows worker-src 'self' blob:) and pass ImageBitmaps, keeping IMAGE mode determinism. As a same-day step, await nextFrame() between burst-frame detections and between variants so the page repaints. Separately, test detecting on a 1280 copy against the calibration set before changing the ingest, since landmarker.ts:20-24… | M | reader |
| P2 | Landing parses 1.0MB of JavaScript, including supabase-js and the MediaPipe glue, before anyone can scan | `src/main.ts:68` | Make the scan-time modules (results, sideFlow, camera, overlays, recommendations, metricDetail, maxCharacter) one dynamic import triggered from the same warmEngine intent at main.ts:979-993. Load engine/auth.js lazily from mountAccountButton and openAccount, and eagerly only when a sb-*-auth-token key exists in localStorage. Load celebs.js from the Celebrities tab and dashboard search only. Target: landing =… | M | reader |
| P2 | Every results render adds another document-level click listener | `src/ui/results.ts:2078` | Add a recTrackingBound guard mirroring wireMaxAsk, or register the delegated listener once at module load. | S | reader |
| P2 | Max copies that never sleep: nine infinite animations each on the ask button, tab faces and loaders | `src/ui/maxCharacter.ts:434` | One shared IntersectionObserver plus visibilitychange, mounted wherever maxCharacterMarkup is inserted, that toggles mx-asleep on every .mx-svg regardless of size. Add a .mx-still variant for faces under 40px with only blink and glance. In the loader, pause the three faces that are not in their slot with animation-play-state. | S | reader |
| P2 | Engine warm starts at the tap on a phone, so the compile lands inside the camera open | `src/main.ts:987` | Extend rather than reverse the on-intent rule: after first paint, when navigator.connection reports effectiveType 4g and saveData is false, warm on the first scroll or after a requestIdleCallback with a 5s timeout. Keep today's behaviour on slow or metered connections. | S | reader |
| P3 | Max animates inner SVG groups, so every frame is a main-thread repaint | `src/ui/maxCharacter.ts:101` | Move the bob, squash and shadow onto the wrapping span (transform and opacity only, will-change: transform), keep only lids and pupils animated inside the SVG, and turn the sparks off by default. Alternatively rasterise the resting loop to a short looping WebP. | M | reader |
| P3 | Scan sweep animates top, so it freezes exactly when the engine runs | `src/style.css:518` | Animate transform: translateY on the ::before with will-change: transform so the compositor keeps it moving while WASM runs; keep the canvas reveal for after detection completes. | S | reader |
| P3 | Hero typefaces are discovered after the stylesheet, so the headline swaps in late | `src/style.css:17` | Copy the two latin woff2 files to public/fonts, declare those two @font-face rules inline in the index.html head, add link rel=preload as=font type=font/woff2 crossorigin for both, and drop the matching fontsource subsets. | S | reader |
| P3 | A camera scan retains five full-resolution burst canvases through the side flow | `src/main.ts:1975` | Burst frames are measured and never shown (comment at main.ts:1808-1813), so downscale them to the detection resolution before storing (1280 long edge, about 6.5MB each), and drop src once photoCanvas has it. | S | reader |

Questions the reader could not settle from the sandbox:

- Is the 2160 ingest cap needed for detection on the main product or only for the /quick export? Detecting on a 1280 copy would cut the per-photo WASM readback about threefold, but landmarker.ts:20-24 shows detector settings shift scores, so it needs a calibration-set drift check first.
- Would a smaller or float16 variant of the multiclass segmenter be acceptable for the head-covering heuristic, which only feeds two ratio thresholds? The current float32 model is 15.1MB even gzipped.
- All numbers here come from headless Chromium on the sandbox CPU with 4x throttling as a phone proxy and a zero-latency network. A run on a mid-range Android over 4G against production would set the true baseline and confirm Vercel serves the .wasm and .tflite compressed.

## 4.12 User-facing copy and voice across the app

Files: templates, results strings, onboarding funnel, tone prompt, verdict ladders, League tool cards, Enhance panel

The copy system is unusually disciplined for a consumer app: the em dash detector runs clean, the plain verdict ladder matches CLAUDE.md word for word and is pinned by tests, the rarity sentence on the report is directional rather than a count, and the deterministic templates never print "undefined". The weakest area is exactly the class the brief named: sentences that promise more than the code delivers. "Unlimited chats" sits on the Max sell screen above a hard 30-message daily wall, the League tool card sells "a real 4K upscale" against a 2x cap and a metered "4K pass" that no meter records, a "coming soon" server tier is advertised inside a tool whose own source says it will not ship, and the lock card still quotes a measurement count typed thirty PRs ago. Two copy defects also break the product's own rules: Coach Max's region read can print the near-verbatim sentence CLAUDE.md bars, and the overview quotes 0.9 points of photo noise while every other surface says 0.6. Beneath those, the polish gaps are small and cheap: the population line breaks grammatically at the bottom of the scale and overclaims at the top, the em dash sweep left four colon-before-conjunction scars, and the plain ladder that is the product default cannot be chosen once a person has answered the tone prompt.

| sev | finding | where | fix | effort | status |
|---|---|---|---|---|---|
| P1 | "Unlimited chats with Coach Max" sells past a 30-message daily wall | `src/ui/maxTab.ts:76` | Change the bullet to "Chat with Coach Max about your numbers, up to 30 messages a day" or drop the adjective entirely: "Chat with Coach Max about your numbers". In maxChat.ts read X-Max-Remaining and show a quiet line under the composer when five or fewer remain: "5 messages left today. Max is back tomorrow." | S | confirmed |
| P1 | League Tools card promises "a real 4K upscale" and a metered "4K pass" the engine never performs | `src/league/main.ts:1229` | Card body: "Sharpen, colour and a clean upscale of up to 2x for photos, towards 4K where the source allows. Clips are cleaned at their own size. Nothing is uploaded and no detail is invented." Render sentence: "Renders are the calls that cost us money (a voiceover, a generated image), everything else is unmetered." | S | reader |
| P1 | Coach Max's region read can print the sentence CLAUDE.md bars | `src/ui/templates.ts:194` | Replace both helpers with the directional form already used everywhere else: "About N% of guys measure higher there" built from scoreHigherText, and "ahead of most guys" or the plain percentile for the standout line. Rewrite the comment at 181-186 to quote CLAUDE.md rather than contradict it. | S | reader |
| P2 | Population line is ungrammatical at the bottom of the scale and overclaims at the top | `src/ui/templates.ts:95` | Clamp inside populationLine by default (tailLimit 1 via statedPct) and phrase the tails without "About": "More than 99% of male faces score higher." and "Fewer than 1% of male faces score higher." Add both tails to rarityConsistency.test.ts. | S | reader |
| P2 | Overview quotes 0.9 points of photo noise; every other surface says 0.6 | `src/ui/templates.ts:752` | Interpolate the constant: `Two photos of the same face differ by about ${DISPLAY_NOISE.toFixed(1)} points, so a single scan is one reading rather than a verdict.` The file already imports DISPLAY_NOISE. | S | reader |
| P2 | The plain verdict ladder cannot be chosen, and settings misnames the default | `src/ui/tonePrompt.ts:57` | Add a third option to the prompt, "Plain reading. The words a person would say out loud: needs work, okay, decent, good." mapped to polite, and make settings name all three states: "plain", "describing the face", "kept civil". Reword the kind option to what it prints: "The same result, with the kinder word for each rung." | S | reader |
| P2 | "Server pass · stronger, coming soon" advertises a tier the file says will not ship | `src/ui/enhancePanel.ts:94` | Remove the chip, or state the fact plainly: "Server pass: not offered. Every engine we tested changed faces, and this tool will not." | S | reader |
| P2 | Lock card promises "all thirty-one measurements", a count typed at #53 | `src/ui/results.ts:2923` | Interpolate `${METRICS.length}` or drop the number: "This is the part underneath: every front measurement, what each one did to the number, and how far it can actually move." | S | reader |
| P3 | Em dash sweep left four colon-before-conjunction scars | `src/ui/maxTab.ts:185` | Full stops. "Hey, I'm Max. Ask me anything. Open a scan if you want me talking through your exact numbers." / "Scan your face to see your first measurement. Every one after it lines up here so you can watch it move." / "...as it does between people, so it is shown and not scored." / "...than the brow's visible tail, so this number runs about 12° below..." | S | reader |
| P3 | Lever copy promises a two-week result the tracker says takes four | `src/ui/templates.ts:598` | "Two weeks of lower sodium and alcohol is the earliest this number can move. Give it four before you read it." and "Consistent sleep and lower sodium bring the measured aperture back over a few weeks; judge it at four." | S | reader |
| P3 | Coach Max still calls the reader "bro" and "girl" | `src/ui/templates.ts:418` | Use the name the opener already carries, or drop the vocative: "${size} up over ${days} days, and that's past what the camera can fake. That's the look of somebody who actually did the thing." | S | reader |
| P3 | Voiced-example fallback invents a status and overstates the narration | `src/ui/results.ts:1561` | "The example clip could not be loaded. The format: your scan, your key measurements narrated in Coach Max's voice, about forty seconds." | S | reader |

Questions the reader could not settle from the sandbox:

- index.html:244-245 promises "Your score is free, and stays free... on every plan, forever", while the decline sheet (onboardingFunnel.ts:216-218) tells a free account that declines the trial "you will not be able to scan yourself again" (guestAllowance returns 1 guest scan, weeklyAllowance is 1 for every tier). Is "the score is free" meant to cover repeat self-scans, or only the first one? To a first-time reader the two surfaces contradict each other.
- The blunt ladder still hands out "Very good looking", "Great looking" and "Model looks" (analysisMode.ts:344-368, 378-380), the same register as the "very attractive" the owner removed from the plain ladder. Is the blunt ladder deliberately exempt from that call, or should it converge on the plain reading now that no ladder carries slang?
- Max's live chat replies are model output. The persona bars em dashes (api/_maxPersona.ts:230) but nothing post-processes the text, so the rule holds only as far as the model obeys it. Is a server-side replace of em dashes with a comma or full stop acceptable so the product rule holds at runtime?

## 4.13 Creator League

Files: /league

The signed-out gate is the strongest part of this surface: the screenshot shows a clean dark page with a clear chip, a serif headline, honest terms copy and one auth form with explicit sign-in versus sign-up modes. The tools are a different story. The two flagship exports (the beat reel and the Polisher) still save through a bare anchor click that the product's own saveFile.ts documents as broken on iOS Safari, and both print "Saved." regardless. The Cast has three real state bugs: redoing a portrait silently wipes a filmed sixteen-render scene set, leaving the mode mid-film keeps spending quota in a hidden panel, and every landed shot repaints the grid and throws away anything typed into the change boxes. Long renders (up to 260 seconds server side for a pair) show one static sentence with no elapsed time, counter or cancel. Naming is half-migrated: the League doors say The Cut, The Cast, The Polisher and The Rundown, but every room still says Make a TikTok, AI Model Reel, Enhance and Full Analysis, and the Clips Library door promises celebrity references and demo exports that the on-device library does not contain.

| sev | finding | where | fix | effort | status |
|---|---|---|---|---|---|
| P1 | Reel and Polisher exports use a bare anchor download, which saveFile.ts says fails on iOS | `src/ui/beatReelPanel.ts:1654` | Route both through saveFile(blob, exportName("reel", ext), "reel") and saveFile(..., "card"/"reel") for the Polisher, and print outcomeMessage(outcome) instead of "Saved.". Keep the render busy flag until the save resolves so the fresh-tap dialog cannot be dismissed by a panel close. | S | reader |
| P1 | Redoing a portrait rebuilds the whole preview and destroys the filmed scene set | `src/quick.ts:3629` | Hold the scene set in module state keyed to the run, and on a portrait redo swap only the changed <img src> and its sources entry instead of re-rendering host.innerHTML. If a full re-render is kept, re-attach the existing grid and status node, and if the after full-length anchor changed, say so with a confirm before discarding shots. | M | reader |
| P1 | Leaving The Cast mid-film keeps spending quota into a hidden panel with no way to stop | `src/quick.ts:3458` | Add a Stop filming button next to the status line, an AbortController passed into filmOne, and a run counter checked before every iteration; leaveMode and enterMode("ai") bump the counter. Add a beforeunload warning while a set or a pair is in flight, matching the carousel. | S | reader |
| P1 | Clips Library door promises content that does not exist and Open does nothing on a fresh device | `src/league/main.ts:1243` | Either seed the strip with the AI demo faces the product already ships (public/demo, which are permitted) and drop the word celebrity, or rewrite the card to "Faces you have saved on this device, scored instantly, no rescan" and make #clips land on a visible empty state ("Nothing saved yet. Scan a face, then Save to library.") rather than silently staying on the pillars. | S | reader |
| P2 | Every landed shot repaints the whole scene grid and wipes text typed into the change boxes | `src/quick.ts:3371` | Patch only the figure that changed (append a figure per landed shot, replace one img on redo) instead of rewriting innerHTML. Disable the Redo and Film again buttons while any filmOne is in flight, and give makeSceneSet a run token so a superseded run stops painting. | M | reader |
| P2 | A pair generation can take four minutes and shows one frozen sentence with no timer, counter or cancel | `src/quick.ts:3180` | Split the pair into per-frame requests the way scene mode already does (filmOne), so the after lands in about a minute and the grid fills frame by frame with a 1 of 4 counter. Failing that, add an elapsed timer and a line such as "Usually two to four minutes. The after arrives first." and a Cancel that aborts the fetch. | M | reader |
| P2 | League door names do not match the room names they open | `src/league/main.ts:1216` | Carry the four House names into quick.html pillar labels, the modebar names, the enhance and reel dialog headings, and replace CREATOR STUDIO with THE CAST or CAROUSEL CREATOR. Derive the slide range on the League card from CAROUSEL_MIN_SLIDES and CAROUSEL_MAX_SLIDES so it cannot drift again. | S | reader |
| P2 | Saved characters are a promise with no library behind it | `quick.html:130` | Render a small "Your characters" chip row above the form from the stored list (name, sex, first line of description); tapping one fills the fields and chips. Store the approved after data URL alongside so the reroll anchor survives too. Until that ships, change the helper to something true, such as "Give them a name for the file names." | M | reader |
| P2 | Pair redo uses window.prompt while the scene grid uses an inline box with opposite semantics | `src/quick.ts:3583` | Put the same inline change box under each pair frame, with blank meaning reroll, and keep one Redo handler shape. Mirror the busy state on the status line the way the scene redo does. | S | reader |
| P2 | Lightbox is hard to close on a phone, unlabelled, unlocked, and has no actions inside it | `src/quick.ts:3287` | Close on tap of the image as well as the backdrop, add role=dialog aria-modal and move focus to the close button then back to the opener, lock body scroll while open, dedupe the wrap, and add Save and Redo buttons plus previous and next arrows inside the lightbox so the set can be reviewed in one pass. | M | reader |
| P2 | Sixteen scene shots need sixteen taps and sixteen share sheets, and each Save gives no outcome | `src/quick.ts:3435` | Add Save all and Save the afters buttons that build one stored ZIP via buildStoredZip with scene-side file names, and switch each per-shot Save to show outcomeMessage on the button for two seconds like the pair buttons do. | S | reader |
| P2 | Em dash in the low-confidence tempo message | `src/ui/beatReelPanel.ts:1372` | Replace with: "Read with low confidence (0.42). Check that the ticks line up with the spikes below before rendering." Add this file to the em dash detector's scope so the reel panel is covered. | S | reader |

Questions the reader could not settle from the sandbox:

- Were the beat reel and Polisher exports deliberately left on the bare anchor path (for example because of blob size through navigator.share), or did they simply predate the #135 phone export work and never get migrated?
- Is the Clips Library card meant to become a seeded library of celebrity references and demo exports, or should its copy describe the on-device saved-faces strip that exists today?
- When a creator stops The Cast mid-set, should the in-flight scene still bill one slot, or should the client hold a cancel token the server honours so the reservation is released?

## 4.14 Landing page and public pages: index.html, src/main.ts

Files: landing parts

The landing is a considered, honest page: a strong serif headline, a demo card that earns its number with visible work, a proof band that refuses fake social proof, and fine print that carries the AI-face disclosure exactly as the standing decision requires. The public guides read in the same plain, factual voice, their meta, canonical and JSON-LD are complete, every internal link resolves through vercel.json, and no em dashes appear in any user-facing text. What undercuts the premium bar is the first five seconds: on the 1280x633 viewport that was actually captured the two capture buttons sit below the fold because the desktop grid rule out-specifies the viewport-height cap, the header shows a dimmed disabled brand mark beside a 9px "V1" build chip at 1.8:1 contrast, and the page ships roughly 320 KB gzipped of application JavaScript (auth client, sex-inference tables, settings) before anyone taps anything. On the public pages the wordmark renders as an underlined hyperlink and the header CTA carries seven different labels across nine pages. Everything found is small to fix apart from splitting the landing bundle.

| sev | finding | where | fix | effort | status |
|---|---|---|---|---|---|
| P1 | Capture buttons fall below the fold on short desktop viewports | `src/style.css:244` | Carry the viewport-height cap into the desktop rule so specificity cannot drop it: `body:not(.cam-takeover) #capture-stage { width: min(100%, 460px, 56svh); }`. At 633px that yields a 354px card whose shutter row ends near 600px; at 900px it is still the full 460px. Re-check that the reel's absolute-pixel furniture (pillar row, callouts) still reads at 354px. | S | confirmed |
| P2 | Signed-out header shows a dimmed disabled brand mark next to a 9px "V1" build chip | `index.html:87` | Render the wordmark in full ink for guests (keep it inert or scroll-to-top; a grey disabled control is the wrong signal), drop the `title` and `disabled` attributes, and remove the "FRONT + SIDE · V1" chip from the header. If a build label is wanted, it already has a home in the footer next to `#build-stamp`. If a chip must stay, set it to var(--mut) at 11px so it clears 4.5:1. | S | reader |
| P2 | Landing ships about 320 KB gzipped of application JavaScript before any interaction | `index.html:471` | Give the landing its own entry (src/landing.ts) that imports only the reel, headline and capture bootstrap, and dynamic-import the scoring, auth and settings graph from `warmEngine()` and from the first Sign in / Sign up click, the same intent pattern already used for the model. Put the two header pills in index.html as static markup (hidden until auth resolves) so the header never pops. Target under 100 KB gz… | M | reader |
| P2 | Brand wordmark renders as an underlined hyperlink on every public page | `src/style.css:3589` | Move the reset to the base rule: `.wordmark, .wordmark:hover { text-decoration: none; }` at style.css:150, and delete the `.auth-page` special case. | S | reader |
| P2 | Opening "What gets measured" jumps the headline upward | `src/style.css:229` | Take the open paragraph out of the centering maths: render it as an absolutely positioned popover under the summary (fade in, no height change), or reserve the space by giving `.sub-more` a `min-height` equal to its open height. Either keeps the h1 and the card fixed while the text appears. | S | reader |
| P3 | Seven different labels for the same header CTA across the public pages | `methodology.html:57` | Use one header label everywhere, "Scan your face", and one closing CTA, "Get your free face score", and style the header link as the same pill the landing uses for Sign up. | S | reader |
| P3 | Headline swaps to a different sentence after load on return visits | `src/main.ts:615` | Decide the headline before first paint: a ten-line inline script in the head reads `truemax:landing-visits` and writes the chosen lead, em and tail into the h1, and main.ts only repaints when a signed-in name arrives. Alternatively set `data-visit` on `<html>` inline and keep the three lines in CSS `content`. | S | reader |
| P3 | Journey step 3 carries an internal project caveat on the marketing page | `index.html:285` | Keep the claim inside what the sample supports and drop the project status: "We compare rescans conservatively: a small movement between two photographs is reported as likely capture noise, not as change." | S | reader |
| P3 | Dead demo-score shim would substitute community ratings for engine output if re-keyed | `src/ui/demoReelShim.ts:35` | Delete src/ui/demoReelShim.ts, the `applyShim` import and the `?real=1` switch at demoReel.ts:6-8, and rewrite the comments at demoReel.ts:14-20 and main.ts:501 to say the card shows the engine's measured output on the synthetic cast. | S | reader |
| P3 | Demo card and disabled wordmark are noise for assistive technology | `index.html:119` | Put `aria-hidden="true"` on `#oval-idle` and add a visually hidden sentence before the stage, "Product demo: a photograph being scanned and scored." (no caption on the card itself, per the standing decision). Fix the wordmark as in the header finding so the first announced element is the h1. | S | reader |
| P3 | Guide articles have no main landmark | `face-score.html:60` | Wrap each article in `<main class="legal-shell guide-shell">` (or `<main><article>`) on the four guide pages so every public page exposes the same landmarks. | S | reader |

Questions the reader could not settle from the sandbox:

- Phone landing: from the CSS a 375x667 phone puts the capture buttons about 60px below the fold (sticky topbar, three-line headline, disclosure, a 404px-tall card from `min(420px, 100%, 52svh)`), while a 390x844 phone fits. Can a phone capture confirm this before it is treated as a finding?
- Is the "FRONT + SIDE · V1" header chip meant to be visible to the public, or is it a leftover from the internal build that can go?
- The guide pages carry no script, so a signed-in member who follows the footer to /guides sees a signed-out header with "Scan your face" and no account pill. Is that acceptable for the static pages, or should they carry the account state?


All fourteen surface reads are in.


# 5. Confirmed in the browser this session

These were reproduced on the local build, not read from code.

| sev | finding | where | fix |
|---|---|---|---|
| P1 | After "Use these points", the "Do these points look right?" dialog is shown while the full manual-review furniture (Confirm, One by one, Points are wrong, Reset points to the automatic placement) is still rendered underneath it, and it is still there under the consent dialog that follows "Yes, they look right". Both are in the accessibility tree at once; captures 07 and 08d. | `src/ui/sideFlow.ts:1535`, where the review row is shown before the automatic branch settles | Do not mount the review furniture until the person answers No. The one-tap path was the point of #152 and #154; the furniture underneath is what those PRs were meant to remove. |
| P1 | The automatic side placement on the tutorial's own reference profile lands the polygon visibly in the wrong place (capture 06). This is the seed the owner is asking about in section 1.1. | `src/engine/sideMask.ts`, `sidePrior.ts` | Section 1.1, steps A to C. |
| P2 | Scan-loading narration goes blank and the bar sits at zero while the 16 MB segmentation model downloads on a first scan (captures 08, 08b, 08c, and the scan-flow reader's P1). | `src/engine/headCovering.ts:10`, `src/main.ts:1907` | Warm the segmenter with the landmarker, narrate the wait, bound it with a timeout that skips the optional check. |
| P2 | The two capture buttons sit below the fold at 1280x633 (capture 01). | `src/style.css:244` | Bound the demo card by viewport height so the buttons fit, as the live-camera rule already does. |
| P1 | A second count-rarity sentence lives in Max's read on the results page: "sitting ahead of N in every 100 guys" (the region-tab reader found the first pair at lines 189 to 198). The rarity bar applies to every surface, coach-toned or not. | `src/ui/templates.ts:501` | Rewrite to the plain standing ("in the top 15 percent of the reference set") through the same statedPct path; add a test that greps every template for "in every 100". |
| P3 | The wordmark renders as a disabled button and a 9 px "FRONT + SIDE · V1" tag sits top right on the landing page (capture 01). | `index.html:85`, `src/style.css:196` | Static wordmark at full ink; drop the tag. |

---

# 6. Sequencing

Five cycles, each one PR, in the order that returns the most to a paying
member soonest. Effort is engine time; calendar time is longer wherever it
says "owner".

| cycle | contents | why this order |
|---|---|---|
| 1. Blockers | Every P1 in the backlog below, generated from all landed reads and the confirmed rows, deduplicated | Each is a sentence or a screen the product says and then contradicts, or a stall on a paid path. |
| 2. Max's mind | Memory facts table and settings list, plan reconciliation, quiz profile in context, verdict ladder and rarity bar in the prompt, em dash scrub on the stream, truncation guard, parser loosening, the chat edge states, delete and archive | One PR because they share the API files and the tests. |
| 3. Max's body | The same character rendered in 3D with pupils, the limbless move set, pre-rendered loops, the 88 px gate | The eight defects in 2.4 ship ahead of this on their own PR; the owner sees the turnaround before any rendering. |
| 4. The Coach tab and plans | The tab layout, the check-in as a Max card, plan rows as controls, the plan object and its renderer, the product shelf with the verified links | Depends on 2 for the plan object and on the sweep finishing for the shelf. |
| 5. Side placement and scores | 1.1 A and B; 1.2's construction fixes on the front; the side norm refit once real profiles arrive | C runs in parallel as labelling time and lands when the model beats the mask on the held-out set. |

The Goal Visualizer (3.7) slots after cycle 2. The remaining P2 and P3 rows
in section 4 are folded into whichever cycle touches their file.

## The P1 backlog, generated

This list is produced by the same generator as section 4 from every read
that has landed plus the confirmed rows in section 5, with duplicates across
surfaces merged. Cycle 1 is this list; there is no other list of blockers.

| # | blocker | where | fix | effort | seen in | status |
|---|---|---|---|---|---|---|
| 1 | Coach tab chats run without the scan the tab says he has read | `src/ui/maxTab.ts:204` | Build the context on the dashboard from the owner's latest stored scan (the same recipe as results.ts chatContext: report, tone, scans, movement, activePlan; task #138 already reopens a stored scan as a full report). Pass it from both openMaxChat calls in maxTab.ts. Replace TAB_GREETING with a… | M | 4.1, 4.3 | confirmed |
| 2 | Plan rows are inert: "Ready to start" looks like a control and does nothing | `src/ui/maxTab.ts:113` | Make each row a button that opens a small sheet: "I've started" (moves to running), "Not doing this" (declined), "Ask Max about it" (opens the chat with the item as initialQuestion). Show the next step under the state: "Max checks in on 12 Sep" from startBy, or "Waiting on your date" when startBy… | M | 4.1 | reader |
| 3 | One tap freezes Max for the rest of the session | `src/ui/maxCharacter.ts:481` | Remove `poked` on the hop's animationend, the same way greet() removes `waving` (lines 670-675), or time it out at 620ms. Also drop the rule's specificity to `.poked .mx-bob` so it can never outrank an act. Add a test in maxCharacter.test.ts that a poked drawing still has a running mx-bob one… | S | 4.2 | confirmed |
| 4 | Silhouette reads as a smart device, not a coach | `src/ui/maxCharacter.ts:33` | Owner's call (2 Sep): the body stays. Pupils are added; volume and motion come from the 3D render, not from a new silhouette. | L | 4.2 | owner decided |
| 5 | Every act is the same egg with a different sticker | `src/ui/maxCharacter.ts:236` | Owner's call (2 Sep): no joints. The move set is limited to what a limbless body can do and rendered in 3D; the prop acts go. | L | 4.2 | owner decided |
| 6 | Paywall sells unlimited chats, server caps at 30 a day | `src/ui/maxTab.ts:76` | Change the benefit line to a true one ("Up to 30 messages a day with Coach Max") or raise or remove the cap. Have the client read X-Max-Remaining and show "N left today" under the composer once it drops below 5. Return a resetsAt ISO timestamp with the 429 instead of "tomorrow" and format it in… | S | 4.3, 4.12 | confirmed |
| 7 | Retake photo re-asks gender and re-offers the tutorial inside the same scan | `src/main.ts:2011` | Give the retake its own path that keeps the scan's answers: on decline, call openCamera() directly for the camera method and el.fileInput.click() directly for upload, skipping ensureScanAllowed, ensureSex and the tutorial offer. If the allowance gate must still be honoured, pass a `retake` flag… | S | 4.4 | confirmed |
| 8 | Upload path goes silent while the engine downloads, and every error lands in an all-caps mono line below the fold | `src/main.ts:1745` | Paint the scan stage the instant a file is chosen: show the photo, add the scanning class, and set the narration line to "Loading the analysis engine" while ensureEngine resolves, then "Finding the face". Report decode failures and engine failures in a dialog next to the stage (confirmScanAction… | S | 4.4 | reader |
| 9 | First scan stalls on a 16 MB segmentation model with a blank narration line and the bar at zero | `src/engine/headCovering.ts:10` | Warm segmenter() inside warmEngine alongside initLandmarker; it shares the same wasm fileset. Narrate the wait: "Checking for hats and hoods" in el.status while it runs. Race detectHeadCovering against a bounded timeout (four to six seconds) that resolves to available:false, so a slow connection… | M | 4.4, 4.11 | confirmed |
| 10 | Region tabs print the barred count-rarity sentence, in coach voice, to everyone | `src/ui/templates.ts:189` | Rewrite regionSummary in the plain register the rest of the report uses and route every figure through standing()/statedPct. For example: "Your {best} is the strongest reading here: {value} against a {sex} average of {mean}, {rankShort}. The one to work on is {worst}: {value} against {mean},… | S | 4.5 | confirmed |
| 11 | Signup wall promises instant unlock, then locks the person in a six-step questionnaire ending on the paywall | `src/engine/onboarding.ts:154` | Keep one required card (first name and date of birth, which is all the plan gate needs) and make last name, mobile, discovery source and both essays optional with a visible Skip. Show the analysis first and run the remaining questions from the plan step or the Coach tab, where the answers change… | M | 4.6 | reader |
| 12 | Review row and thirteen point handles stay live under the question and consent dialogs | `src/ui/sideFlow.ts:1535` | Keep mode-pending until afterAutomatic settles: remove it only on the manual branch and after the awaits (or in a finally), and call showReviewActions lazily on the edit branches instead of before the dialog. Set e.section.inert = true while any side dialog is open and clear it in each settle().… | S | 4.7, 5 | confirmed |
| 13 | Dialog preview rings are invisible at inspection size | `src/ui/sideFlow.ts:1784` | Scale the ring with the drawn box in the expanded view (for example radius = max(2.5, w / 160), stroke 1.25 px) and draw a 1 px dark halo under the teal, as the live .vpoint does with its inset shadow; raise connector alpha to about 0.7 when expanded. Keep the thumbnail constants and change the… | S | 4.7 | reader |
| 14 | Both dialogs' fine print promises something the flow does not do | `src/ui/sideFlow.ts:1620` | Line 1620: "Placing them yourself gives a more accurate score. Taking these skips the walkthrough; you can still say they look off on the next screen." Line 1466: "Yes goes straight to your analysis. No lets you place them yourself first." | S | 4.7 | reader |
| 15 | Home scan rows both navigate to Scans and expand in place on one tap | `src/ui/dashboard.ts:272` | Pick one behaviour. Recommended: delete lines 271-273 and keep the in-place expand, then add an "Open this scan" link inside .dash-scan-pop-in that calls openScanRecall(scan, previous) so the full report is still one tap away. If navigation is the intended behaviour, delete the popover markup,… | S | 4.8 | confirmed |
| 16 | The "scan is due" sentence never renders for anyone who has a streak | `src/ui/dashboard.ts:428` | Render subline(ctx) under the hello in the populated hero as a .dash-hero-sub line. When streak.daysLeft is non-null, also surface it beside the New scan control (for example a small "by Sunday" under the pill, or "Scan by Sunday" as the pill label) so the action carries its own deadline. | S | 4.8 | reader |
| 17 | Global reduced-motion rule turns infinite loops into per-frame strobes | `src/style.css:133` | Replace line 133 with the standard pattern: `* { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; animation-delay: 0ms !important; transition-duration: 0.01ms !important; transition-delay: 0ms !important; scroll-behavior: auto !important; }`. Then give the spinner a… | S | 4.9 | reader |
| 18 | Member and Max wordmark states are neon on cream at 1.3 to 2.1:1 | `src/style.css:178` | Keep the base .wordmark colours (TRUE in --ink, MAX in --acc, 5.25:1 on card) for every state on the light theme, and drop the text-shadow glows there. If member and Max states must be visible, express them as a small chip beside the wordmark ("MEMBER", "MAX") using --acc on --acc-soft, and move… | S | 4.10 | reader |
| 19 | League page renders in fallback fonts because it never loads Fraunces or Inter | `src/league/league.css:33` | Add the two self-hosted imports at the top of league.css: @import "@fontsource-variable/fraunces/opsz.css"; @import "@fontsource-variable/inter/wght.css"; (both are already in the bundle, latin subsets only), delete the local() @font-face, and set font-variation-settings: "opsz" 96, "wght" 300 on… | S | 4.10 | reader |
| 20 | Landmark detection runs five full-size passes per photo synchronously on the main thread | `src/engine/consensus.ts:39` | Move FaceLandmarker into a Web Worker (tasks-vision supports workers; vercel.json already allows worker-src 'self' blob:) and pass ImageBitmaps, keeping IMAGE mode determinism. As a same-day step, await nextFrame() between burst-frame detections and between variants so the page repaints.… | M | 4.11 | reader |
| 21 | League Tools card promises "a real 4K upscale" and a metered "4K pass" the engine never performs | `src/league/main.ts:1229` | Card body: "Sharpen, colour and a clean upscale of up to 2x for photos, towards 4K where the source allows. Clips are cleaned at their own size. Nothing is uploaded and no detail is invented." Render sentence: "Renders are the calls that cost us money (a voiceover, a generated image), everything… | S | 4.12 | reader |
| 22 | Coach Max's region read can print the sentence CLAUDE.md bars | `src/ui/templates.ts:194` | Replace both helpers with the directional form already used everywhere else: "About N% of guys measure higher there" built from scoreHigherText, and "ahead of most guys" or the plain percentile for the standout line. Rewrite the comment at 181-186 to quote CLAUDE.md rather than contradict it. | S | 4.12 | reader |
| 23 | Reel and Polisher exports use a bare anchor download, which saveFile.ts says fails on iOS | `src/ui/beatReelPanel.ts:1654` | Route both through saveFile(blob, exportName("reel", ext), "reel") and saveFile(..., "card"/"reel") for the Polisher, and print outcomeMessage(outcome) instead of "Saved.". Keep the render busy flag until the save resolves so the fresh-tap dialog cannot be dismissed by a panel close. | S | 4.13 | reader |
| 24 | Redoing a portrait rebuilds the whole preview and destroys the filmed scene set | `src/quick.ts:3629` | Hold the scene set in module state keyed to the run, and on a portrait redo swap only the changed <img src> and its sources entry instead of re-rendering host.innerHTML. If a full re-render is kept, re-attach the existing grid and status node, and if the after full-length anchor changed, say so… | M | 4.13 | reader |
| 25 | Leaving The Cast mid-film keeps spending quota into a hidden panel with no way to stop | `src/quick.ts:3458` | Add a Stop filming button next to the status line, an AbortController passed into filmOne, and a run counter checked before every iteration; leaveMode and enterMode("ai") bump the counter. Add a beforeunload warning while a set or a pair is in flight, matching the carousel. | S | 4.13 | reader |
| 26 | Clips Library door promises content that does not exist and Open does nothing on a fresh device | `src/league/main.ts:1243` | Either seed the strip with the AI demo faces the product already ships (public/demo, which are permitted) and drop the word celebrity, or rewrite the card to "Faces you have saved on this device, scored instantly, no rescan" and make #clips land on a visible empty state ("Nothing saved yet. Scan a… | S | 4.13 | reader |
| 27 | Capture buttons fall below the fold on short desktop viewports | `src/style.css:244` | Carry the viewport-height cap into the desktop rule so specificity cannot drop it: `body:not(.cam-takeover) #capture-stage { width: min(100%, 460px, 56svh); }`. At 633px that yields a 354px card whose shutter row ends near 600px; at 900px it is still the full 460px. Re-check that the reel's… | S | 4.14 | confirmed |
| 28 | Automatic side placement lands visibly wrong on the reference profile | `src/engine/sideMask.ts:1` | Section 1.1, steps B and C | L | 5 | confirmed |
| 29 | A second count-rarity sentence in Max's read on the results page | `src/ui/templates.ts:501` | Rewrite to the plain standing through statedPct; test every template for "in every 100" | S | 5 | confirmed |

29 blockers from 14 landed reads plus the browser session; 4 duplicate rows merged.

# 7. What is deliberately not being built

- The pet, the fight and the fall. Retired at the owner's call; the code is
  removed in cycle 3.
- A body-fat number from a face, or any lesion or condition classifier.
  Section 1.3 says what is built instead.
- Cloud landmarking of any photograph.
- A general chatbot. Max answers about the goal and turns back to the plan.
- Vitamin E for scars and the dermastamp, out at the owner's instruction.
- A generated face that skips the re-measurement check in 3.7. The Goal
  Visualizer is being built; a preview that has not passed its contract is
  not shown, and no preview is ever described as a forecast.

# 8. Decisions this plan needs from the owner

1. **Max's body.** Decided 2 September: the silhouette stays, no joints,
   pupils added, motion and material get the 3D treatment. Section 2.2
   records it.
2. **Real-time or pre-rendered first.** The plan says pre-rendered first.
   If gaze follow matters from day one, it is real-time and another week.
3. **The 30-a-day cap.** Decided 2 September: the cap stays. The benefit
   line changes and the count is shown.
4. **The typed region paragraph.** Is it Coach Max's read (then it is gated
   and labelled) or the plain instrument (then it is rewritten in the plain
   register)? The plan assumes plain, because it is unlabelled on screen.
5. **Consent timing for the side loop.** Explained under "The loop that
   learns" in 1.1: record the accept, correct or skip outcome for everyone
   (no photo, no consent needed) and ask the photo consent before the
   placement is shown so the yes-set is not biased by the outcome. Yes, or
   leave the question where it is?
6. **Real profiles for the side norms.** Eight to ten people, thirteen
   coordinate pairs each from the Calibrate export. Nothing in 1.2 moves
   without them.
7. **The Goal Visualizer's provider and consent copy.** Which image provider
   receives the two photographs, its retention terms, and the wording of the
   consent. The contract-and-re-measure loop is built provider-agnostic, but
   the consent names one.
