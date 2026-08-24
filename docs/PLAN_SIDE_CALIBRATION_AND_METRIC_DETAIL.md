# Two plans: the side scale, and the measurement detail view

Written after a phone session that produced six items. Four were bugs and are
fixed. Two are builds, and this is how they get built.

---

# A. The side profile scores everybody in the bottom decile

## What was measured, not what is suspected

`docs/SIDE_FIXTURES.md` holds three profiles whose thirteen points were dragged
into place **by hand** — sets E, F and G, the cleanest side data this repo has.
Scored through the shipping engine as male:

| set | side score | percentile |
|---|---|---|
| E | 3.5 / 10 | 1st |
| F | 3.8 / 10 | 6th |
| G | 3.6 / 10 | 3rd |

The screenshot that started this said **3.5, "Ahead of 1%"**. That is not one
person's profile. It is what the side engine says about a correctly placed
profile, and it is where every user is going to land.

## Four metrics carry it, in the same direction every time

| metric | E | F | G | norm | z on all three |
|---|---|---|---|---|---|
| totalFacialConvexity | 151.9 | 150.3 | 150.7 | 138 ± 6 | +2.05 … +2.31 |
| gonialAngle | 114.5 | 114.8 | 104.0 | 125 ± 7 | −1.46 … −3.00 |
| nasalProjection | 9.3 | 12.7 | 11.1 | 18 ± 4 | −1.32 … −2.18 |
| upperLipELine | +0.3 | −1.3 | −1.6 | −5 ± 3 | +1.13 … +1.76 |
| lowerLipELine | +3.4 | +1.4 | −2.6 | −3 ± 3 | +0.14 … +2.15 |

Three different poses, one direction each. That is a norm describing a different
quantity, not three unusual faces.

## The control that says the method works

`chinRecession` was added last week and built to match its published
construction exactly — Holdaway's H angle, the three landmarks the literature
names. On the same three profiles it reads **z = +0.13, −0.39, −0.43** and
scores 5.0, 5.0, 5.0.

The metrics whose construction matches their norm agree with their norm. The
ones that don't, don't. That is the whole diagnosis, and it is the same one the
long comment above `SIDE_METRICS` already makes about the three that were
recentred and the two that were held out.

## Phase 1 — prove it is the norms before touching a norm

Everything above is **three poses of one person**, and the photo aspect had to
be solved for rather than measured. That bounds what it can claim.

Collect hand-placed profiles from **eight to ten different people**, with the
image dimensions recorded so no aspect has to be recovered. The app already
exports this: `?dev=1`, place the points, "Copy points". **No photograph
leaves the device — the export is thirteen coordinate pairs.**

Then re-run the table above. Two outcomes, and the second one matters:

- **Same four metrics, same direction** → the norms. Go to phase 2.
- **The bias disappears** → it was this subject or the aspect recovery. Stop,
  and re-plan against what the corpus actually shows.

**Gate: no `dist` block is edited until this runs.** Re-fitting against three
poses of one face is how the current wrong numbers got here.

## Phase 2 — fix constructions first, fit numbers second

Each of the four gets the same question, which is the one the file already
answers for every other metric: *does this construction compute the quantity its
norm describes?*

- **nasalProjection** — almost certainly no. Ours is a perpendicular to
  nasion→subnasale over face height. The published figure is **Goode's ratio**
  (alar groove→tip over nasion→tip, 0.55–0.60), a different construction with a
  real norm. Rebuild it as Goode's and inherit the citation.
- **gonialAngle** — the construction matches, the tissue does not. 125 ± 7 is a
  **skeletal** angle off a lateral radiograph, between the bony gonion and the
  condyle. We measure the visible turn of the jaw on skin. This is exactly the
  argument that held `ramusMandible` out. Either recentre on measured
  soft-tissue values with a wide sd, or hold it out.
- **upperLipELine / lowerLipELine** — Ricketts' E-line is published in
  **millimetres** (−4 mm, −2 mm); ours is a percentage of face height. Those are
  not the same unit and the conversion was never done. Check the sign convention
  at the same time.
- **totalFacialConvexity** — 150° on three real faces against a 138° norm is a
  12° offset, which smells like glabella not sitting where the literature's G
  sits. Check the landmark before touching the number.

**The rule, restated so it is not re-broken:** a metric either matches a
published construction and keeps its published norm, or it is recentred on
measured data with a deliberately wide sd and a comment saying so, or it is held
out. Nothing keeps a norm that describes a different quantity.

## Phase 3 — re-fit, with the success criterion written down first

- The **median** hand-placed profile scores **5.0 ± 0.5**. Not 3.6.
- No metric shows |mean z| > 0.5 across the corpus.
- A test in the shape of `calibration.test.ts`: *a correctly placed profile
  scores near the median*. It fails on today's code — that is what makes it
  worth having.

## Phase 4 — only then, the auto-seed

The seeder is a real and separate problem. Of five profiles driven through it
just now, **three were refused by the plausibility guard on the automatic
placement alone** — one with a nasolabial angle of 167.4° against a 55–145
bound, which is a point in the wrong place, not a face.

It is deliberately last. Tuning a seeder against a scale that puts correct
placements in the 1st percentile is fitting to a broken target, and it needs the
same multi-person corpus phase 1 collects.

## Cost and the long pole

Roughly **four to five working days** of engine work. The long pole is not code
— it is collecting profiles from eight to ten people, which is calendar time and
needs you. **Start that now**, because everything else in phase 1 waits on it.

---

# B. Click a measurement and open it

## What is already built

More than it looks. The reference screenshots show a card with the measurement
drawn on the photo, a score and range bar, and tabs. Against that:

| the piece | where it already is |
|---|---|
| the measurement drawn on the photo | `measureOverlay.ts`, `sideMeasureOverlay.ts` — and it stopped strobing this week |
| "about this ratio" | `TRAITS` in `templates.ts`, one phrase per metric |
| score, value, ideal band, your marker | `idealWindow()` + `markerPct`, already rendered on every row |
| closest celebrity reads | `regionMatches()` + `celebs.ts`, computed per region today |
| zoom to the feature | `zoomFor()` — already drives the region tabs |
| a drag-to-correct landmark editor | `sideVerify.ts`: thirteen points, guided walkthrough, per-point hints, photographic reference crops, reset |

So this is mostly an **assembly job plus one genuinely new thing**.

## B1 — the modal, read-only (1–2 days)

New `src/ui/metricDetail.ts`. Opens from a measurement row. Carries:

- the photo with that measurement drawn, zoomed to the feature
- score, value, ideal band, the population marker
- **Overview** — the trait sentence, the norm, where this face sits
- **Celebrities** — the existing region matches, filtered to this metric
- prev / next through the region's metrics (`1 / 33`), fullscreen, close

No engine changes, no new data. This is most of the perceived value and it can
ship on its own.

## B2 — per-metric matching and the editorial line (1 day)

- `regionMatches()` gains a per-metric variant. Same data, narrower query.
- A "may indicate" line per metric — the one-clause reading of an off-ideal
  value. ~45 of them to write. Cheap, wordy, and it must stay bounded by what
  the measurement supports.

## B3 — the Edit tab (3–4 days, the real work)

The side view already has this. **The front does not** — it has 478 automatic
landmarks and no way to correct one.

Built by **generalising `sideVerify.ts` into a landmark editor that works on
either view**, not by writing a second one. For a front metric, expose only the
landmarks that metric is built from (`MetricDef.points` already names them for
the bounded side metrics; the front needs the same field filled in), on a zoomed
crop, draggable, recomputing that metric on drop.

Persisting a correction means a scan's landmarks become editable data rather
than a derived artefact — worth deciding deliberately, because it changes what a
stored scan is.

## What is deliberately not being built

**Simulate.** It is the one tab that cannot be honest: showing what someone
would look like with a different measurement means generating a face, and a
generated face presented as a preview of yourself is a promise the engine cannot
keep. Everything else in this product is a measurement with a receipt attached.

## Cost

**Six to seven days** for all three, and **B1 alone is worth shipping first.**

---

# Sequencing

**A** is more urgent — everyone is getting a 3.5. **A is also blocked on
collecting profiles from eight to ten people**, which is calendar time.

So: **start collecting for A now, build B1 while it comes in.** Then phases
A2–A4, then B2 and B3.

The one thing needed from you to start: **side profiles from eight to ten
different people**, exported with "Copy points". Thirteen coordinate pairs each,
no photographs.
