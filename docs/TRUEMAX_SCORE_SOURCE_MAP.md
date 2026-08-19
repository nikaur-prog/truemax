# TrueMax score source map

Audit date: 19 August 2026

Current stored score version: `2`

## Canonical score object

`src/engine/scoring.ts` is the source of truth. `analyze()` produces a `Report` from front landmarks; `analyzeSide()` produces the same shape for verified side points; `mergeReports()` combines front and side without creating a second display scale.

A `Report` keeps these concepts separate:

- `overall`: canonical 0–10 display score;
- `overallPercentile`: reference-population position, 0–100;
- raw metric value, metric score, region score and z-score;
- `potential`: a separate modeled scenario, never the current score.

The overall score and percentile share the report's aggregate z value but are stored and labeled independently. Basic no longer turns a 0–10 score into a `95/100` presentation or averages percentiles as scores.

## Consumer map

| Surface | Display source | Percentile source | Notes |
|---|---|---|---|
| Quick result | `Report.overall` from `analyze()` | `Report.overallPercentile` | Front-only; uses the same engine as standard scan |
| Basic | `basicScores(report)` in `analysisMode.ts`; Overall is `report.overall` | Each row's explicit percentile field | All displayed score values are canonical 0–10 |
| Full results | `renderResults()` receives the same `Report` | Same report | Front/side merged once in `main.ts` |
| Score strip | `report.overall` | `report.overallPercentile` | Labels are `/10` and population position respectively |
| Share card | `renderShareCard(report, photo)` | Same report | No score recomputation |
| Quick score card | `renderScoreCard(..., report)` | Same report | Before/after deltas use report values |
| Rundown/MP4 | `reelScript.ts` and frame/export code receive a `Report` | Same report | Quick's explicit producer score edit creates a new 0–10 value and recomputes its percentile; this is an operator override, not engine output |
| Device history/dashboard | `compareAndStore(report, scan_id)` | Not persisted in the current history row | Stores score version, overall and region scores |
| Max prompt context | `buildMaxContext()` from the active `Report` | Same report, rounded separately | No direct landmark/photo payload is sent to Max |
| Verdict and rarity copy | percentile-specific helpers | `overallPercentile` | Copy never treats percentile as a score |

## End-to-end source path

```text
landmarks / verified side points
  -> scoring.ts metric results
  -> region and aggregate report
  -> Report { overall 0–10, overallPercentile 0–100, ... }
  -> Basic / Full / Quick / cards / MP4 / history / Max
```

## Version and integrity rules

- History trends compare only rows whose `scoreVersion` equals `CURRENT_SCORE_VERSION`.
- Legacy score versions remain visible but are excluded from current deltas.
- The reference population is an explicit male/female choice; it is not inferred from facial shape.
- Tone changes verdict wording only, never the measurement.
- Unmeasurable metrics are omitted rather than converted to zero.
- Front-only and front+side reports are labeled as different capture depth even though they share the same score object.

## Known scoring gates still open

- The repeat-photo pipeline test remains a TODO because the repository lacks a consented multi-photo fixture set.
- Calibration is too small, especially for the male holdout, to satisfy the Stage 4 release gate.
- Confidence/uncertainty is not yet a first-class field on every displayed metric.
- Quick's producer override needs an explicit “edited” watermark/metadata before creator exports can be treated as measured outputs.

The system is independent TrueMax work. This map contains no FaceIQ code, hidden API behavior, dataset, weight, or formula.
