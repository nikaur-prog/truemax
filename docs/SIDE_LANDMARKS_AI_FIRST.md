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
| The pass | `api/_sideLandmarks.ts` | built. Prompt, tool schema, strict parser, facing from the points, version stamp `vision-1`. |
| The endpoint | `api/side-landmarks.ts` | built. `POST` multipart `photo` (JPEG, PNG, WebP, under 2 MB) plus optional `width`, `height`. Signed in, origin-checked, twelve passes a day per account, claim released if the model call fails. Returns fractions, pixels when a frame was given, per-point confidence, facing, model, version, remaining. Nothing stored. |
| The allowance | `supabase/migrations/20260902120000_side_landmark_usage.sql` | written, **not applied**. Apply in the Supabase SQL editor before the endpoint is called. |
| The harness | `scripts/eval-vision-landmarks.ts` | built. Model versus seeder on the labelled synthetic set, per landmark, in head widths. |
| Tests | `api/_sideLandmarks.test.ts` | schema, prompt, parser, facing, pixels, version. |

The endpoint and the harness call the same function, so the benchmark number
describes production.

## 2. The go or no-go

```
ANTHROPIC_API_KEY=... npx tsx scripts/eval-vision-landmarks.ts
```

Runs the model on the 53 usable labelled profiles (three out-of-spec faces
excluded, partial labels skipped, same as `tools/side-fit.mjs`), caches the
predictions in `.side-dataset/vision-<model>.json`, and prints per landmark:
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
owner runs this locally, or the environment does. About 1,500 input tokens per
photo at the provider's resize; the whole set is a few cents.

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
