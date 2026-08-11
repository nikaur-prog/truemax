# Side-profile ground truth

> **These four sets carry a known rightward bias and should be re-collected.**
> They were exported while `.vpoint` rendered its dot at the left edge of a
> flex box containing the point's (invisible but still laid-out) label, so the
> visible dot sat roughly 28 screen pixels LEFT of the coordinate it stored.
> Everyone aiming the dot at their chin therefore stored a point to the right of
> their chin. At the capture sizes used that is about 0.057 of image width, or
> **0.13–0.20 head-widths**, and it varied per point because it depended on the
> label's length.
>
> The template below is still fit for the job it does — `sanitizeSeed` only acts
> on points more than 0.5 head-widths out, well past the bias — but the numbers
> are not clean ground truth and should not be treated as such. Re-collect after
> the fix and refit.

Four profiles, thirteen points each, dragged into place by hand in the verifier
and exported with the `?dev=1` "Copy points" button. Coordinates are normalised
0..1 against the photo's own width and height. **No photographs are stored** —
this file is numbers, which is the whole reason the export exists.

These are what `TEMPLATE` in `src/ui/sideVerify.ts` was derived from, and what
any future change to the seeder should be checked against.

## The frame

Each set is converted to a shape frame the seeder can always rebuild:

- `fx` — distance from the nose tip toward the back of the head, in head widths
  (head width = nose tip to ear canal). 0 at the nose, −1 at the ear.
- `fy` — distance from the hairline down, in head heights (hairline to chin
  bottom). 0 at the hairline, 1 at the chin.

Working in these two per-axis units matters: the export divides x by width and
y by height, so raw normalised coordinates are not isotropic and cannot be
compared across photos of different aspect ratios. Per-axis fractions can.

## Agreement across the four

| point | fx (A / B / C / D) | fy (A / B / C / D) |
|---|---|---|
| trichion | −0.05 / −0.08 / −0.03 / −0.05 | 0.00 / 0.00 / 0.00 / 0.00 |
| glabella | 0.00 / −0.08 / −0.07 / 0.03 | 0.24 / 0.21 / 0.23 / 0.27 |
| nasion | −0.04 / −0.17 / −0.16 / −0.02 | 0.30 / 0.32 / 0.30 / 0.37 |
| pronasale | 0.00 / 0.00 / 0.00 / 0.00 | 0.57 / 0.53 / 0.55 / 0.59 |
| subnasale | −0.09 / −0.17 / −0.19 / −0.07 | 0.62 / 0.60 / 0.60 / 0.63 |
| labialeSuperius | −0.10 / −0.12 / −0.14 / −0.08 | 0.73 / 0.71 / 0.73 / 0.74 |
| labialeInferius | −0.15 / −0.18 / −0.23 / **−2.27** | 0.85 / 0.82 / 0.83 / **0.39** |
| pogonion | −0.25 / −0.30 / −0.36 / −0.26 | 0.98 / 0.96 / 0.95 / 0.96 |
| menton | −0.43 / −0.48 / −0.58 / −0.41 | 1.00 / 1.00 / 1.00 / 1.00 |
| gonion | −1.02 / −1.04 / −1.18 / −1.09 | 0.64 / 0.75 / 0.64 / 0.68 |
| condylion | −1.00 / −1.00 / −1.00 / −1.00 | 0.20 / 0.26 / 0.09 / 0.15 |
| cervicale | −0.72 / −0.54 / −0.89 / −0.87 | 0.91 / **1.83** / 0.89 / 0.90 |
| tragion | −0.99 / −1.05 / −1.08 / −0.97 | 0.29 / 0.37 / 0.19 / 0.27 |

The agreement is tight enough to build a template from: `pogonion` lands within
0.03 of head height across four different faces and framings.

**The two bold cells are the bug this data was collected to find.** They are not
disagreements about anatomy, they are seeds that went somewhere impossible and
were not corrected before export:

- **D `labialeInferius`** at −2.27 head widths — 2.27 head-widths *behind the
  ear*, sitting on the far left edge of the frame.
- **B `cervicale`** at 1.83 head heights — most of a head below the chin, off
  the bottom of the picture.

A single dot at the frame edge is easy to miss in the verifier, and it then
feeds a real measurement. That is what `sanitizeSeed()` now catches.

## Checking a change to the seeder

Refit and re-run the outlier check whenever `TEMPLATE`, `ANCHORS`, or either
seed path changes. The behaviour to preserve:

- **A and C are corrected zero times.** Every point in them is plausible, so a
  sanity pass that touches any of them is too aggressive and is now fighting
  good seeds instead of catching bad ones.
- **B is corrected exactly once** (`cervicale`, to ≈0.60, 0.67).
- **D is corrected exactly once** (`labialeInferius`, to ≈0.61, 0.62 — between
  the upper lip and the chin, where a lower lip belongs).

The fit is Theil-Sen (median of pairwise slopes) rather than least squares
precisely because outliers are the thing being defended against: least squares
is dragged by the very point it is meant to catch.

## Collecting more

Open the app with `?dev=1`, capture or upload a profile, drag all thirteen
points until they are right — *including any that landed off-frame* — then press
**Copy points** and paste the JSON here as a new lettered set. More sets make
the template better; profiles that differ from the ones above (different faces,
turn angles, framings, hair covering the ear) are worth more than more of the
same.
