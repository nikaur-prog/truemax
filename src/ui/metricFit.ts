import { directionFor } from "../engine/metrics.js";
import { RELIABLE_MIN, reliabilityOf } from "../engine/reliability.js";
import type { ScoredMetric, Sex } from "../engine/types.js";

export type MetricFitState = "within" | "outside" | "indicative" | "excluded" | "unavailable";
export interface MetricFit {
  state: MetricFitState;
  label: string;
  shortLabel: string;
}

/** Reference fit is not the separately computed input to the overall score. */
export function metricFit(metric: ScoredMetric, sex: Sex): MetricFit {
  if (!Number.isFinite(metric.value)) return { state: "unavailable", label: "Not measured", shortLabel: "Not measured" };
  if (metric.implausible) return { state: "excluded", label: "Review this measurement", shortLabel: "Review points" };
  if (reliabilityOf(metric.def.id) < RELIABLE_MIN) return { state: "indicative", label: "Indicative measurement", shortLabel: "Indicative only" };
  if (!Number.isFinite(metric.conformance)) return { state: "unavailable", label: "Reference fit unavailable", shortLabel: "Fit unavailable" };

  // Read the engine's open-ended threshold decision. The cosmetic far edge
  // of idealRange is not a limit for a lower/higher metric.
  const within = metric.conformance === 1;
  const state = within ? "within" : "outside";
  const direction = directionFor(metric.def, sex);
  if (direction === "band") return {
    state,
    label: within ? "Within model reference range" : "Outside model reference range",
    shortLabel: within ? "Within range" : "Outside range",
  };
  return {
    state,
    label: within ? "Meets model threshold" : direction === "higher" ? "Below model threshold" : "Above model threshold",
    shortLabel: within ? "Meets threshold" : direction === "higher" ? "Below threshold" : "Above threshold",
  };
}

export function metricFitHTML(metric: ScoredMetric, sex: Sex): string {
  const fit = metricFit(metric, sex);
  return `<span class="metric-fit" data-fit="${fit.state}" aria-label="${fit.label}">${fit.shortLabel}</span>`;
}

export function metricModelScoreLabel(metric: ScoredMetric): string {
  if (!Number.isFinite(metric.value) || !Number.isFinite(metric.score) || metric.implausible || reliabilityOf(metric.def.id) < RELIABLE_MIN) return "Not scored";
  return `Model score ${metric.score.toFixed(1)} / 10`;
}
