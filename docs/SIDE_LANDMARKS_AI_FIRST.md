# AI-first side placement

Owner's decision, 2 September 2026: on every side scan, a vision model places
the thirteen points as the first pass. The on-device seeder becomes the
fallback. The person's confirm or correction is the label, and both the
model's seed and the person's answer feed the calibration loop and, later,
the keypoint model (`BUILD_PLAN_DETECTORS_CALIBRATION_AND_SWEEP.md`, section
2 and C2).

This document is the contract between the server side (Claude) and the client
flow (Codex), the privacy change it forces, and the test that decides whether
it ships as the first pass or only on refusal.

## 1. What is built

| piece | file | state |
|---|---|---|
| The pass | `api/_sideLandmarks.ts` | built, version stamp `vision-2`. Image preparation (upright, resize, labelled pixel grid), whole-frame pass in pixel coordinates, enlarged second look at the ear and chin clusters, strict parser, facing from the points, vertical anchoring helper. Section 2b says what changed from `vision-1` and why. |
| The endpoint | `api/side-landmarks.ts` | built. `POST` multipart `photo` (JPEG, PNG, WebP, under 2 MB) plus optional `width`, `height`. Signed in, origin-checked, twelve passes a day per account, claim released if the model call fails. Returns fractions, pixels when a frame was given, per-point confidence, facing, model, version, which points came from a zoom pass, remaining. Nothing stored. |
| The allowance | `supabase/migrations/20260902120000_side_landmark_usage.sql` | applied. |
| The harness | `scripts/eval-vision-landmarks.ts` | built. Model versus seeder on the labelled synthetic set, per landmark, in head widths, with the bias table and both anchored fits. |
| Tests | `api/_sideLandmarks.test.ts` | schema, prompts, parser, facing, pixels, zoom window and mapping, grid, image preparation, anchoring, version. |

The endpoint and the harness call the same function, so the benchmark number
describes production.

## 2. The go or no-go

```
ANTHROPIC_API_KEY=... npx tsx scripts/eval-vision-landmarks.ts
```

Runs the model on the 53 usable labelled profiles (three out-of-spec faces
excluded, partial labels skipped, same as `tools/side-fit.mjs`), caches the
predictions in `.side-dataset/vision-<model>-<version>.json`, and prints per landmark:
model median and p90 error, seeder median and p90 error, and the same two on
the points the labeller actually moved, which is where the seeder was wrong.
Errors are in head widths (labelled nose tip to ear notch).

The rule, printed by the harness: **on the five back points where the seeder
was wrong, if the model's median error is half the seeder's or less, AI-first
ships. Otherwise the model runs on refusal only**, and the next step is the
larger model (`--model`) or the keypoint model.

A note the table carries: a label the hand never moved equals the seed, so the
seeder's overall error is a lower bound. The "moved" columns are the honest
comparison.

The harness needs the key. It lives in Vercel and nowhere in the repo, so the
owner runs this locally, or the environment does. `vision-2` makes three model
calls per photograph (frame, ear crop, chin crop), roughly 5,000 input tokens;
the whole set is well under a dollar at the mid-size model.

Flags: `--model <id>` to sweep models (each gets its own cache file),
`--no-zoom` for the single-call variant so the zoom's own contribution can be
read off by comparison, `--ids s000,s001` and `--limit N` to spend less,
`--no-cache` to spend again.

## 2a. The result, 3 September 2026: NO-GO on AI-first

Run on 28 of the 56 labelled profiles with `claude-sonnet-5`, `vision-1`.
Errors in head widths (labelled nose tip to ear notch); the seeder figure is
taken over the points the labeller actually moved, which is the only place the
seeder is genuinely wrong.

| | model | seeder |
|---|---|---|
| front 8 | 0.409 | 0.000 (untouched by construction) |
| back 5 | 0.485 | 0.080 |
| all 13 | 0.425 | 0.075 |

Five times worse where it was needed. The harness prints the go rule and it
came back NO-GO. Three things were checked before accepting that, because a
number this bad is as likely to be a harness bug as a model failure.

**1. The error is systematic, not scatter.** Signed offsets grow monotonically
down the face: glabella +0.245 head widths, pronasale +0.346, menton +0.644,
cervicale +0.701, with sideways offset near zero at the nose. Each face implies
a y scale of 0.797 with a spread of 0.055. That is a framing error, not a model
guessing.

**2. The most favourable reframing does not save it.** Scoring the model's y
against the image width rather than its height (the shape the bias suggests)
halves the error to 0.203 overall. Still two and a half times the seeder.

**3. Anchoring the model's shape onto the seeder's accurate front points, which
is the best correction production could actually apply, is decisive.** With
framing removed entirely the front eight land at 0.055, so the model reads the
face outline well. The five back points stay at 0.254, and the ear cluster is
the worst of all: condylion 0.386 and tragion 0.393 against the seeder's 0.064
and 0.067. Six times worse.

So the model reads a profile and cannot locate an ear. That is exactly the
landmark the seeder needs help with (task #144, the ear-region research spike),
and it is the one the model is least able to give.

**A confound this test cannot resolve.** All 56 profiles in the labelled set
are 1536x2048, one aspect ratio. So "the model normalises y by the image width"
and "the model has a downward bias" cannot be told apart from this data. The
decisive follow-up is cheap: run six of the same faces square-cropped or
letterboxed and see whether the reported y moves with the frame. Six model
calls. It would not change the verdict, because conclusion 3 removes framing
altogether and the ear is still lost, but it would say whether the prompt
should state the pixel dimensions.

**What this changes.** AI-first placement does not ship. The endpoint,
allowance and harness stay: they are the apparatus for testing the next
candidate, and the harness now prints the bias table and the anchored fit so
the next model is judged on the same three questions rather than one number.
The route to accurate side points remains C2 in
`BUILD_PLAN_DETECTORS_CALIBRATION_AND_SWEEP.md`: a keypoint model trained on
our own thirteen points, fed by the consented correction loop. A general vision
model can help label that corpus offline, where a human checks it. It cannot
place the points in production.

## 2b. vision-2: what changed, and why it might pass

Written 3 September 2026, before the run. The result goes here when the owner
has run it; the verdict in 2a stands until then.

Section 2a's three findings each point at a fix, and `vision-2` is those
fixes and nothing else, so the next table can be read against this one.

**Finding: a constant vertical stretch (implied y scale 0.797, spread
0.055).** The model was asked for fractions of an image whose size it was
never told, and it guessed a frame. `vision-2` draws a labelled grid on the
photograph (a line every 100 pixels, the coordinate written on each line) and
states the width and height in the prompt. The model answers in whole pixels
it can read off the grid. The tool schema's bounds are the frame's pixel
size. This removes the thing the model had to imagine.

**Finding: the outline is read well, the ear is not (anchored front 0.055,
ear cluster 0.39).** Two responses.

- The ear cluster (ear notch, jaw hinge, jaw corner) and the chin cluster
  (chin front, chin bottom, neck point) each get a second model call on an
  enlarged crop cut around where the first pass put them, at least 1.2 head
  widths square, upscaled to 1024 pixels with its own grid. A tragus that is
  a dozen pixels wide in the frame is a hundred wide in the crop, and the
  prompt for the crop says what to find first ("the ear should be the largest
  feature in it"). A crop pass that fails leaves the first pass's placement
  in place; it never fails the photograph.
- Anchoring. Re-analysing the `vision-1` cache with a **vertical-only** fit
  (scale and offset in y, fitted on the seeder's eight front points, x left
  alone) instead of the similarity fit gave: ear cluster 0.378 to 0.191, all
  thirteen 0.425 to 0.143, back points where the seeder was wrong 0.394 to
  0.189 (ratio 2.38 against the seeder's 0.080; still NO-GO on its own). The
  similarity fit had made the ear worse, because eight points lying close to
  a vertical line pin the horizontal scale badly and the model's x was never
  the problem. `anchorVertical` in `api/_sideLandmarks.ts` is that
  correction, exported so the client can apply it to a live pass with the
  seeder's front points, and the harness prints both fits and the go rule
  with the vertical fit applied.

**What is being tested by the next run.** Whether the grid removes the
stretch (the implied y scale should come to 1.0), whether the enlarged crop
finds the ear (tragion and condylion under 0.1 after anchoring is the bar the
seeder sets), and whether a larger model does either better. The run:

```
npx tsx scripts/eval-vision-landmarks.ts
npx tsx scripts/eval-vision-landmarks.ts --no-zoom
npx tsx scripts/eval-vision-landmarks.ts --model claude-opus-5
npx tsx scripts/eval-vision-landmarks.ts --model claude-fable-5-1
```

Each line caches separately, so the four tables can be set side by side.

**Cost of the change to production.** Three calls per photograph instead of
one, roughly three times the latency (a few seconds more) and the tokens.
The daily allowance counts photographs, not calls, so nothing about the
ceiling moves.

## 3. The flow Codex wires (held, pending a model that passes section 2a)

```
side photo taken
  -> loading screen (the pass runs; seeder runs in parallel as the fallback)
  -> "We placed the points for you"
       Place them myself  -> walkthrough -> review -> confirm -> help us improve
       Use these points   -> "Do these points look right?"
            Yes, they look right -> help us improve -> analysis
            No, they look off    -> "Would you like to place them yourself?"
                 Yes, place them       -> walkthrough -> review -> confirm -> help us improve
                 No, score it as it is -> help us improve -> analysis, side marked unverified
```

Rules the client keeps:

- The pass is called only after the consent in section 4 has been answered
  yes, once, and remembered. Declined, signed out, over the daily limit, a
  502, or a five-second timeout: the seeder's points are used and the flow is
  identical from "We placed the points for you" onward.
- `classifySidePlacement` runs on the model's points exactly as it runs on the
  seed today. A hard failure is not offered; the dialog says which reading
  broke, as it does now.
- The feedback record (`api/side-correction-feedback.ts`) gains `seed_method:
  "vision"` and the `version` from the response, so the calibration export can
  split rows by pass. This is the field the learning loop keys on.
- The five back points carry their confidence into the review screen as the
  ring's opacity, so a low-confidence ear reads as a guess before anybody
  measures from it. Optional in the first cut.

## 4. The privacy change, for the owner to approve

Today the landing page says "Your photo never leaves your phone"
(`index.html:248`) and the side flow sends a photograph only inside the
consented feedback record. AI-first sends every side photograph to the model
provider before the points exist. That is a different promise and it needs
three things:

**The consent, asked once at the first side scan and remembered:**

> **Place the points with our cloud pass?**
>
> To place the thirteen side points, TrueMax sends this one side photo to our
> model provider, reads the points back and discards the photo. It is not
> stored by us and not used to train anything. Your front photo never leaves
> your phone.
>
> You can place the points yourself instead, on your device, with nothing sent.
>
> [ Send this photo and place the points ]   [ Place them myself, nothing sent ]
>
> Remember my choice. Change it any time in Settings.

**The landing line**, replacing the current one. Two options:

- "Your front photo never leaves your phone. The side photo is sent once to
  place the points, then discarded, unless you place them yourself."
- "Measured on your phone. The side photo is sent once, to place the points,
  and never kept."

**The fine print** in the scan flow and the privacy page: the provider's name,
that the photo is transmitted for the single request and not retained by
TrueMax, and that the feedback record is a separate, separately consented
thing. The provider's own retention terms are theirs to state and should be
linked, not paraphrased.

Nothing in this document changes what the feedback endpoint stores or when.

## 5. Cost and limits

- Roughly a cent per side photo at the mid-size model, a few seconds latency.
- Twelve passes per account per UTC day, claimed before the call, released on
  a failed call. The 429 carries `resetsAt` for the client to format.
- Free scans included, by the owner's decision: the point of AI-first is that
  the first scan is right.

## 6. The learning loop, stated once

The model's points are the seed. The person's confirm or correction is the
label. Training the on-device system on the model's raw output would cap it
at the model; training it on the labels, weighted by whether a hand touched
them, lets it pass the model. The feedback record already carries automatic
and confirmed points; the `version` field is what lets the nightly job tell a
vision seed from a template seed.
