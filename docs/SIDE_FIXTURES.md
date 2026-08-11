# Side-profile ground truth

> **`TEMPLATE` is now fitted from sets E and F only.** Sets A–D below carry the
> `.vpoint` rightward bias described immediately underneath and are kept as a
> record of the bug, not as ground truth. They are no longer part of any fit.

## Sets A–D — biased, retained for the record

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

Re-run the outlier check whenever `TEMPLATE`, `ANCHORS`, `placeBackPoints`, or
either seed path changes. The behaviour to preserve:

- **A clean seed is corrected zero times.** Every point in it is plausible, so a
  sanity pass that touches any of them is too aggressive and is now fighting
  good seeds instead of catching bad ones. A point wrong by 0.06 head-widths —
  a nostril — must also survive untouched.
- **A point thrown to the frame edge is always pulled back.** Test it on
  `labialeInferius` and `cervicale` at minimum: those are the two that really
  happened (a lip point 2.27 head-widths behind the ear, a neck point off the
  bottom of the picture).

The fit is Theil-Sen (median of pairwise slopes) rather than least squares
precisely because outliers are the thing being defended against: least squares
is dragged by the very point it is meant to catch.

## Set E — the first clean one

Collected after the `.vpoint` fix, so it carries none of the rightward bias
above. It is the first set that is ground truth in the strict sense.

```json
{"trichion":[0.3486,0.3469],"glabella":[0.3406,0.4212],"nasion":[0.3405,0.4594],
 "pronasale":[0.2995,0.5484],"subnasale":[0.3254,0.562],"labialeSuperius":[0.3094,0.5857],
 "labialeInferius":[0.3139,0.6352],"pogonion":[0.341,0.6926],"menton":[0.3517,0.7045],
 "gonion":[0.5836,0.6551],"condylion":[0.6216,0.477],"cervicale":[0.477,0.7036],
 "tragion":[0.6159,0.5222]}
```

Against the current template it differs by a mean of 0.115 head-widths and
0.064 head-heights — comfortably inside the 0.5 / 0.25 thresholds
`sanitizeSeed` acts on, so the template still does its job on it and moves
nothing. The differences are not random, though, and they point the way the
bias predicts:

- The lower face sits further BACK than the template says (`menton` +0.31,
  `cervicale` +0.27, `gonion` +0.20, `pogonion` +0.16), which is exactly the
  direction a forward-shifted template would be wrong in.
- The ear region sits LOWER (`condylion`, `tragion`, `gonion` all about +0.20
  head-heights).

**The template was deliberately not refitted from this alone.** One clean set
cannot separate "the template is biased" from "this photograph is reclined" —
the subject is lying back in it, which tilts the whole ear-to-jaw relationship,
and that alone could produce the vertical offsets above. Set F settled it.

## Set F — clean, and the first with its automatic seed recorded

The valuable part of this one is not the corrected points, it is that the seed
the app produced for the *same photograph* was captured alongside them. That
turns a fixture into a measurement of the seeder's error.

Auto-seeded:

```json
{"trichion":[0.3402,0.3227],"glabella":[0.3158,0.3906],"nasion":[0.3174,0.4215],
 "pronasale":[0.2487,0.5087],"subnasale":[0.277,0.5293],"labialeSuperius":[0.2669,0.5599],
 "labialeInferius":[0.2718,0.6066],"pogonion":[0.2844,0.6737],"menton":[0.2945,0.6887],
 "gonion":[0.5025,0.6483],"condylion":[0.4651,0.3868],"cervicale":[0.4274,0.6503],
 "tragion":[0.47,0.4237]}
```

Corrected by hand:

```json
{"trichion":[0.3392,0.3217],"glabella":[0.2958,0.3916],"nasion":[0.3047,0.433],
 "pronasale":[0.2456,0.4889],"subnasale":[0.277,0.5293],"labialeSuperius":[0.2606,0.5579],
 "labialeInferius":[0.2599,0.6124],"pogonion":[0.2733,0.6683],"menton":[0.3454,0.697],
 "gonion":[0.5482,0.6357],"condylion":[0.5641,0.4633],"cervicale":[0.4728,0.6983],
 "tragion":[0.5833,0.5178]}
```

### What the difference says

In head-widths and head-heights, the error is not spread across the thirteen —
it is entirely in the five points behind the face:

| point | error (head-widths) | error (head-heights) |
|---|---|---|
| the eight front points | −0.03 to +0.06 | −0.05 to +0.03 |
| menton | −0.151 | +0.022 |
| gonion | −0.135 | −0.034 |
| cervicale | −0.134 | +0.128 |
| condylion | −0.293 | +0.204 |
| tragion | **−0.336** | **+0.251** |

That is the mesh seed path naming the wrong anatomy. MediaPipe's 234/454 is the
widest point of the face oval — the sideburn, at roughly eye level — and 127/356
is higher still on the temple; neither is an ear. The seeded ear landed at
**0.664** of the way from the nose tip to the true ear canal, and because that is
a ratio of two depths it survives the yaw compression that scales both.

### The refit

`TEMPLATE` is now the mean of E and F. Its back points are no longer only a
sanity check — `placeBackPoints()` in `src/ui/sideVerify.ts` *places* gonion,
condylion, cervicale, tragion and menton's x from it, on both seed paths, since
neither path can see them. Head width comes from dividing the mesh's oval point
by 0.664 (mesh path) or from the back of the skull on the silhouette (fallback).

Leave-one-out is the honest number: fit on E alone and predict F, or the
reverse, and the worst back-point error is **0.13 head-widths** (menton x)
against **0.42** for the old seed. In-sample on F it is 0.06.

Two poses of one person is a centre of gravity, not a population. The next clean
set should be someone else.

## Collecting more

Open the app with `?dev=1`, capture or upload a profile, drag all thirteen
points until they are right — *including any that landed off-frame* — then press
**Copy points** and paste the JSON here as a new lettered set. More sets make
the template better; profiles that differ from the ones above (different faces,
turn angles, framings, hair covering the ear) are worth more than more of the
same.
