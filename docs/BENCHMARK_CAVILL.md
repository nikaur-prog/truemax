# Benchmark: one face, two systems

Henry Cavill, the same front and profile photographs, run through TrueMax
(build `85d44bf`) and through a competitor's paid product on 2026-08-20.
Recorded because it is the only external check the scoring has ever had, and
because the disagreement turned out to be structural rather than incidental.

Nothing here is their code, model or formula. Every number is what their UI
displayed to a paying user, and the analysis is our own arithmetic on those
displayed numbers — the same thing any customer could read off the screen.

## Headline

| | TrueMax | benchmark | gap |
|---|---|---|---|
| Overall | 5.3 | **8.3** | −3.0 |
| Front | 6.20 | 8.44 | −2.2 |
| Side | 3.70 | 7.38 | −3.7 |
| Harmony | 6.0 | 8.03 | −2.0 |
| Angularity | 4.7 | **9.2** | −4.5 |
| Dimorphism | 4.5 | 8.3 | −3.8 |
| Features | 5.5 | 7.9 | −2.4 |

## The measurements agree. The scoring does not.

Where the two systems measure the same quantity they get near-identical
numbers, and then score them completely differently:

| quantity | our value | their value | our score | their score |
|---|---|---|---|---|
| canthal tilt | 6.0° | 6.7° | 7.3 | **10.0** |
| nose : intercanthal width | 1.14× | 1.14× | not scored | **10.0** |
| jaw : cheekbone / bigonial | 0.991 | 89.4% | 4.2 | **10.0** |

This is the whole finding. Our landmarks are fine. Our reference table is
fine. What differs is the function from a measurement to a score.

## Their scoring curve, read off 29 metric cards

Each card shows the value, an **ideal band**, an axis **range**, and the
resulting score. Taking `f` = distance outside the band as a fraction of the
remaining range:

| metric | value | ideal band | range | f | score |
|---|---|---|---|---|---|
| Middle Third | 31.5% | 31.4–33.6 | 22.2–42.6 | in band | 10.0 |
| Lower Third | 36.2% | 33.9–37.0 | 26.2–44.3 | in band | 10.0 |
| Total Facial W:H | 1.35× | 1.34–1.37 | 1.07–1.64 | in band | 10.0 |
| Bigonial width | 89.4% | 87.5–91.5 | 68.6–110.4 | in band | 10.0 |
| Lateral Canthal Tilt | 6.7° | 6.0–7.7 | −4.3–18.0 | in band | 10.0 |
| Deviation IAA/JFA | 1.0° | 0.0–2.5 | −22.2–22.3 | in band | 10.0 |
| Eyebrow Low Setedness | 0.29× | 0.00–0.45 | −2.36–2.81 | in band | 10.0 |
| Eyebrow Tilt | 10.3° | 6.5–11.0 | −14.0–31.5 | in band | 10.0 |
| One Eye Apart | 1.00× | 0.95–1.00 | 0.57–1.38 | 0.00 | 10.0 |
| Ipsilateral Alar Angle | 86.3° | 86.5–92.5 | 70.2–108.8 | 0.012 | 10.0 |
| Top Third | 32.2% | 30.0–32.0 | 19.8–42.2 | 0.020 | 9.9 |
| Eye Separation Ratio | 47.0% | 45.7–46.8 | 37.4–55.1 | 0.024 | 9.8 |
| Eye Aspect Ratio | 2.96× | 3.00–3.50 | 1.52–4.98 | 0.027 | 9.9 |
| Brow Length : Face Width | 0.68 | 0.69–0.76 | 0.33–1.12 | 0.028 | 9.8 |
| Jaw Frontal Angle | 85.3° | 86.5–92.5 | 54.8–124.2 | 0.038 | 9.8 |
| Midface Ratio | 0.95× | 0.97–1.00 | 0.62–1.35 | 0.057 | 9.7 |
| Jaw Slope | 145.0° | 140.0–142.5 | 115.5–167.0 | 0.102 | 8.8 |
| Lower : Upper Lip | 1.33× | 1.55–1.85 | −0.54–3.94 | 0.105 | 9.0 |
| Interpupillary : Mouth | 0.77× | 0.83–0.87 | 0.42–1.28 | 0.146 | 8.5 |
| Neck Width | 88.0% | 92.0–98.0 | 66.2–123.8 | 0.155 | 8.6 |
| Chin : Philtrum | 1.88× | 2.15–2.45 | 0.78–3.82 | 0.197 | 7.4 |
| Face W : H | 1.86× | 1.96–2.00 | 1.55–2.41 | 0.244 | 7.2 |
| Mouth : Nose width | 1.33× | 1.42–1.50 | 1.08–1.84 | 0.265 | 5.7 |
| Nose bridge : width | 2.43× | 2.06–2.14 | 1.16–3.04 | 0.322 | 4.8 |
| Lower Third Proportion | 35.4% | 31.0–33.5 | 26.2–38.3 | 0.396 | 3.8 |

Fits `score ≈ 10·exp(−k·f²)` with k ≈ 6–9 depending on the metric. Two
structural facts:

1. **The ideal is a BAND and the whole band scores a flat 10.** The band runs
   about 6–10% of the total range.
2. **The shoulder is scaled to that per-metric range**, which spans roughly
   ±3 population sd — so being a third of a sd off the ideal costs almost
   nothing.

## Ours, for contrast

`scoreMetric`, band direction:

```ts
const c = Math.abs(value - ideal) / d.sd;   // distance in POPULATION sd
const fracCloser = phi(m + c) - phi(m - c);
zEff = probit(1 - fracCloser);
```

The ideal is a single **point**; `c = 0` only on an exact match, so every
deviation costs immediately, and the divisor is the population sd rather than
a plausible range. On a tight metric that is severe: nasofrontal has sd 7, so
20° off is 2.9 sd and the score collapses.

## Two separate defects, not one

Reading the canthal tilt row carefully separates them:

- **Curve shape.** Cavill sits ~0.34 sd from our ideal and scores 7.3. Under a
  band-plus-shoulder curve that distance is inside or barely outside the
  plateau and should score 9.5+.
- **Ideal placement.** Our canthal tilt ideal is 4.73°; theirs is 6.0–7.7°.
  Cavill measures 6.0–6.7°, which is dead-centre ideal for them and off-ideal
  for us. Several of our ideals may simply sit in the wrong place.

Both need fixing, and they need fixing in that order — there is no point
re-placing ideals while the curve punishes small deviations so hard.

## Most of the headline gap is not geometry at all

The pillar tabs change the reading of the table at the top, and this is the
single most important thing in this document.

Their Harmony pillar is 33 ratio cards — the same kind of measurement we take.
Their other three pillars are not:

- **Angularity (9.2)** is five rows: Cheek Leanness & Ogee Curve, Cheekbone
  Prominence, Submental Definition, Jaw Definition, Chin Definition. Each is a
  vision judgement of soft tissue scored straight out of 10 against "ideal
  10.0" — no measured quantity, no distribution, no units.
- **Dimorphism (8.3)** is eleven such rows (Neck, Lips, Facial Hair, Hairline,
  Eyebrow Thickness, Nose, Eyes, Brow Ridge, Jaw, Hair Length, Face Shape).
- **Features (7.9)** is forty-one, mostly skin and ageing (acne, rosacea,
  eye bags, dark circles, hyperpigmentation, crow's feet, thinning hair) plus
  a set of asymmetries decomposed into weighted sub-measurements.

And on the Dimorphism tab, beneath those eleven, sits one more row:

> **Harmony Dimorphism — 29 facial proportions: 6.54**

That is their geometry-only read of this face. Their pillar shows 8.3; the
geometry underneath it shows 6.54, and the vision rows carry the difference.

So the honest comparison is **6.54 against our 5.3 — a gap of about 1.2**, not
3.0. The remaining 1.8 is a class of measurement we do not take at all. No
change to a scoring curve closes it, and chasing 8.3 by tuning constants would
be manufacturing the number rather than measuring the face. Tracked separately.

## What the curve change actually did

Implemented as a tolerance band whose width is each metric's own measured
repeatability, `sqrt(1 - reliability)` in population sd — our data, not theirs
(`scoring.toleranceOf`). Full pipeline re-run: rescan, `aggNorm` rebuild,
`SHRINK`/`CENTRE` re-fit.

| on the 19-face rated corpus | before | after |
|---|---|---|
| r, all faces | 0.714 | **0.778** |
| r, men | 0.698 | **0.780** |
| r, women | 0.754 | **0.807** |
| mean absolute error | 0.90 | **0.78** |
| mean score (human mean 5.09) | 5.35 | **5.27** |
| held out, all | — | 0.737 |
| held out, men | ~−0.1 | **0.696** |
| held out, women | — | 0.795 |

`SHRINK` re-fit to 1.131 against a shipped 1.13 — unchanged, which is a good
sign that the change moved agreement rather than the scale.

The men are the headline. A test used to pin them BELOW 0.6 held out, because
they correlated about −0.1 and pooling that with the women would have read as
progress where there was none. That test asked to be deleted the day they
cleared 0.6. They cleared it.

Worth stating plainly: **the headline scores did not go up.** Mean corpus score
fell slightly. This change bought ranking accuracy, not inflation, and it does
not on its own move a Cavill scan from 5.3 to anything like 8.

## Consequences for our pipeline

Changing `zEff` invalidates everything fitted downstream of it. The order, for
the next time:

1. rebuild the scoring curve in `scoreMetric`
2. rescan the 258-photo reference set (`tools/normalize.mjs`)
3. regenerate `aggNorm.ts`
4. re-fit `SHRINK` and `CENTRE` (`tools/fit-scale.ts`)
5. verify against the rated corpus (`calibration.test.ts` pins mean error
   ≤ 0.75 and span ≥ 2)

Still open, and deliberately not done here:

- **Ideal placement.** Our canthal tilt ideal is 4.73°, theirs 6.0–7.7°.
  Several of ours may sit in the wrong place. The band had to come first —
  there was no point re-placing ideals while the curve punished small
  deviations so hard — but it does not settle where the ideals belong.
- **Soft tissue.** The 1.8 above.
