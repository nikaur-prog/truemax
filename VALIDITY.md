# Does the score measure anything?

This is the record of trying to answer that, because it is the only question
that matters and the answer is currently **no, not demonstrably**.

Everything below is reproducible from `tools/` plus Wikimedia Commons. No
private data, no hand-picked photographs.

---

## 1. One face, many photographs

Every shippable-licence Commons photograph of each person, scored with the
current engine. Group shots excluded by face-width; nothing else filtered.

| person | photos | mean | SD | range |
|---|---|---|---|---|
| Chris Hemsworth | 13 | 6.18 | 1.39 | 4.4 – 8.3 |
| Zendaya | 18 | 6.03 | 1.16 | 4.2 – 7.6 |
| Henry Cavill | 30 | 5.99 | 0.94 | 4.0 – 7.8 |
| Gal Gadot | 18 | 5.74 | 1.12 | 3.6 – 8.3 |
| Sydney Sweeney | 18 | 5.47 | 1.27 | 3.7 – 8.2 |
| Margot Robbie | 18 | 4.65 | 1.13 | 3.6 – 7.8 |

**A single photograph moves the score by about ±1.2 points on a face that did
not change.** Two photographs of one person differ by more, on average, than
two different people do. That alone means no single reading ranks an
individual.

Capture quality does not explain it. Within-person correlation between score
and smile is −0.15, and between score and |yaw| is −0.26; together they account
for a few percent of the variance. Selecting each person's *best-captured*
photograph — neutral mouth, square to the lens, face filling the frame, the
exact standard the app asks its own users for — produced Margot Robbie 3.6, the
**lowest** of her twenty, and Idris Elba 3.5, the lowest of his eighteen.

Re-encoding a single photograph (rotate 90°, re-save as JPEG, rotate back)
moves the score 0.20 points on its own.

## 2. Does it separate the group it is supposed to separate?

Both sides pulled from Commons by identical code, identical licence filters,
identical quality handling — so photo genre cannot explain the result.

| group | people | photos | mean | per-person SD |
|---|---|---|---|---|
| celebrities | 13 | 212 | 5.38 | 0.56 |
| reference (notable for their work) | 12 | 131 | 5.42 | 0.64 |

**Cohen's d on person-level means: −0.200.**

A randomly chosen celebrity outscores a randomly chosen reference-population
person **44% of the time**. Fifty percent is no signal at all.

The combined ranking is led by Emmanuel Macron (6.47) and Pete Buttigieg
(6.19), above Chris Hemsworth (6.18). Margot Robbie places 12th of 13
celebrities.

## 3. This contradicts the number the scoring is built on

`W_SHAPE = 0.15` was chosen from a leave-one-out measurement reporting the
ratio metrics separate a consensus-attractive tier from the reference
population at **d = 1.19**. That was measured on *one curated photograph per
person*. Measured across many candid photographs per person, the comparable
figure is **d ≈ 0**.

Given §1 — that which photograph you pick moves a face four points — a d of
1.19 obtained from one photograph each is most plausibly an artifact of photo
selection rather than a property of the faces.

Note the shape descriptor was already measured, leave-one-out, at d = 0.33.
Two of the three validity numbers this engine has ever produced are near zero,
and the third does not reproduce.

## 4. Honest limits of the above

- The reference set is people notable for their work, chosen as a proxy for
  ordinary appearance. It is not one: heads of government and senior
  scientists are well-groomed, professionally photographed public figures.
  A reference set that skews attractive would shrink a real difference toward
  zero. This is a genuine confound and it is not quantified.
- 13 versus 12 people is enough to rule out a large effect, not enough to
  distinguish "no effect" from "small effect".
- Fame is not attractiveness, and no one claims it is. But the ordering inside
  the celebrity group is not a subtle miss.

None of these limits rescue the result. They mean the true effect may be small
rather than exactly zero. Nothing here supports a number presented to a user as
a rating.

## 5. What would settle it

The pipeline has never been fit or checked against human attractiveness
ratings. Every threshold, weight and "ideal" traces back either to looksmaxxing
folklore or to a top-tier celebrity set used as its own ground truth.

Settling it needs labelled data — a public set of faces with human ratings
attached (SCUT-FBP5500 is the usual one: 5,500 faces, 60 raters each, academic
licence). With it you can answer the question directly: does any combination of
these 31 measurements predict how people actually rate a face, and how well?
That answer might be "reasonably", in which case the metric set needs
reweighting against real labels. It might be "barely", in which case the honest
product is not a score.

Either way it is knowable, and until it is known the number on the screen has
no established meaning.
