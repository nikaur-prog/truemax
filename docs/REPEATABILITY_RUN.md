# Measuring the noise floor: the friends-and-family scanning run

The product promises to tell somebody whether their face changed. That claim is
only true above the instrument's own noise, and right now we do not know where
that floor sits for real captures on real phones — task #47 is open, and task
#54 says the side metrics fail the repeatability bar the front metrics passed.

This is the protocol for finding out, and the tool that turns the result into
an answer.

## Why this comes before more celebrities

Two different questions, easy to confuse:

| Question | What it needs | What it tells you |
| --- | --- | --- |
| Are our **ideals** right? | Celebrity faces, human ratings | Whether "good" points the right way |
| Is our **instrument** steady? | One person, scanned twice | Whether a change means anything |

Calibrating ideals against an unsteady instrument is fitting to noise. The
noise floor comes first.

## The protocol

**Fifteen people, two scans each, at least a day apart.**

1. **Two scans per person, on different days.** Different light, different time
   of day, a genuinely new photograph each time — not the same image uploaded
   twice. Two scans of one person is the only thing that separates "his jaw
   changed" from "the phone moved".
2. **Both views every time.** Front *and* side. The side is where the
   instability is suspected, so a front-only scan does not address the
   question.
3. **At least six women.** Task #51 (women reading ~0.5 high) cannot be
   separated from one unusual face below about six.
4. **Scan them as "someone else".** The subject picker keeps a friend's face
   out of the owner's streak and trend — see `StoredScan.subject`.
5. **Do not correct the landmarks** on these scans, even though the editor now
   allows it. Hand-correction is a different measurement: it tells you what the
   engine could achieve with perfect points, not what it does achieve on its
   own, and mixing the two makes the noise floor meaningless. Run a separate
   corrected pass afterwards if you want that comparison — it is a good one.
6. **After each scan, tap "Copy diagnostics"** and paste it into a file. One
   file per person is fine; several dumps can sit in one file.

Name the person **the same way in every scan of them**. The `face:` line is the
only thing tying two dumps together, and the app leaves it blank — so type the
name in yourself when you paste, on the `face:` line.

## What a dump carries

Every raw metric, where it sits against the population, what the engine
considers ideal, how much of it is signal — and, since August 2026, the
capture conditions:

```
capture: yaw 3.1°  ·  pitch -1.4°  ·  roll 0.2°  ·  smile 0.08
taken: 2026-08-25T09:14:22.118Z
scan: 7f3c…
```

Those four numbers decide whether two dumps are comparable at all. A scan taken
at 20° of yaw or mid-smile differs from a level neutral one for reasons that
have nothing to do with the face, and without the line there is no way to tell
that scan from a genuinely unstable metric. The tool gates on them.

The scan id is there so a dump pasted twice is detectable — a duplicated paste
looks exactly like perfect repeatability, which would be the most flattering
possible bug.

## Getting the answer

```
node tools/repeat-scans.mjs scans/
```

It reports, in order:

- **what it read** — how many dumps, how many rejected on pose or expression
  and why, how many came from a build too old to carry a capture line;
- **per-metric repeatability** — within-person spread against between-person
  spread. A metric whose ratio approaches 1 carries no signal: it varies as
  much between two photographs of one person as it does between people.
  Anything under 0.3 reliability is flagged as noise;
- **score stability** — how far the overall, front and side scores move
  between two photographs of the same face. This is the headline. **A rescan
  can only honestly report a change larger than this number.**

If the side moves noticeably more than the front, the tool says so directly.
That is the confirmation task #54 is waiting on.

## What to do with it

- If overall stability is, say, ±0.3, then the delta copy on a rescan must not
  announce a 0.2 improvement as an improvement. Either the threshold moves or
  the claim changes.
- Metrics that come back as noise should not carry weight in the score.
  `engine/reliability.ts` already holds a per-metric reliability table used for
  exactly this; these numbers are how it gets corrected for real captures
  rather than harvested celebrity photographs.
- A related tool, `tools/reliability.mjs`, answers the same question from the
  scanned celebrity corpus. Its gate (15° yaw, 16° pitch) is deliberately
  mirrored here so the two can be compared.
