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

## 3. The flow Codex wires

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
