# TrueMax analysis integrity status

Updated 12 August 2026.

## What was corrected

- Re-orthogonalized the pose-correction frame. Undoing MediaPipe's z scaling
  had previously converted a rigid coordinate system into a shear.
- Rebuilt canthal tilt from the visible inner/outer canthi with explicit image
  roll correction. On the first 40 real reference faces, median left/right
  disagreement fell from 22.5° to 1.0°; the average-tilt range remained
  -1.8° to +6.6°.
- Replaced the face-oval 234/454 pair falsely labelled “bizygomatic” with the
  116/345 approximate malar-prominence pair. This remains a mesh proxy, not a
  clinical measurement of the zygomatic bone.
- Rescanned 115 celebrity-reference and 153 population-reference photos.
  Regenerated 31 front distributions, 108 comparison entries, the male/female
  shape models, and aggregate quantile tables.
- Added fail-closed checks for all 478 front landmarks, image dimensions,
  finite metric outputs, all 13 profile landmarks, point bounds, vertical
  anatomy order and front/back direction.
- Raised side capture from a permissive 35–42° three-quarter view to 55° when
  the frontal detector still sees the face; a true profile also passes when the
  detector disappears after recording the turn.
- Fixed the drawn vertices for facial convexity, total facial convexity and the
  nasofrontal angle.
- Removed five profile constructions from user scoring: submental-cervical,
  mandibular-plane, chin-projection, forehead-slope and the invented
  tragion-to-pronasale “midface depth” ratio. Their research computers remain
  available, but no percentile is shown until a matching definition,
  multi-person reference distribution and repeatability test exist.

## What the score is—and is not

TrueMax has raw measurements and reference distributions for every scored
front feature. It does **not** have authoritative per-feature “PSL scores.” PSL
is community terminology, not a standardized clinical or psychometric scale,
and this repository contains no licensed human-rated PSL dataset.

The current headline score is therefore experimental. It is useful for testing
the product flow and comparing measurements made by the same engine, but it is
not yet evidence-backed enough to promise a precise attractiveness rating.
That requires independent human labels, train/validation separation,
demographic fairness checks and repeated-photo reliability testing.

## Required validity gate before a paid precision claim

1. License an appropriate human-rated dataset or commission a consented,
   demographically balanced rating study.
2. Lock a holdout set before fitting any feature weights or ideals.
3. Report prediction error, rank correlation, calibration and subgroup results.
4. Test two or more standardized photos of the same people and publish the
   expected repeatability band.
5. Keep photos on-device unless a participant has explicitly consented to a
   separate research upload and retention policy.
