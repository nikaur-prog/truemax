import { directionFor, distFor } from "./metrics.js";
import { reliabilityOf } from "./reliability.js";
import { conformance, toleranceOf } from "./scoring.js";
import { SIDE_METRICS } from "./sideMetrics.js";
import type { PillarId, RegionId, Sex } from "./types.js";

/** Offline only. A band-fit score is not an attractiveness rating or percentile. */
export const SIDE_BAND_FIT_VERSION = "side-band-fit-v1" as const;

// Preserve the existing side overall's declared weighting. No fit to the
// placement pilot, external totals, or an assumed population distribution.
const PILLAR_WEIGHTS: Record<PillarId, number> = {
  Harmony: 0.35, Angularity: 0.25, Dimorphism: 0.2, Features: 0.2,
};

export interface SideBandFitMetric {
  id: string;
  region: RegionId;
  pillar: PillarId;
  value: number | null;
  state: "measured" | "missing" | "outside-plausibility";
  conformance: number | null;
  weight: number;
  overallWeight: number;
  band: [number, number];
}

export interface SideBandFitAggregate {
  /** Only present with full coverage; do not renormalize missing evidence. */
  score: number | null;
  /** Fit of the observed subset, never a replacement for the full score. */
  observedSubsetFit: number | null;
  /** Unknown metrics can contribute anywhere in [0, 1]. Not a confidence interval. */
  possibleScoreRange: [number, number];
  coverage: number;
  measuredCount: number;
  expectedCount: number;
}

export interface SideBandFit {
  version: typeof SIDE_BAND_FIT_VERSION;
  status: "offline-candidate";
  meaning: "fit-to-current-reference-bands-not-attractiveness";
  referenceGroup: Sex;
  populationPercentile: null;
  overall: SideBandFitAggregate;
  regions: Partial<Record<RegionId, SideBandFitAggregate>>;
  pillars: Record<PillarId, SideBandFitAggregate>;
  metrics: SideBandFitMetric[];
}

function aggregate(metrics: SideBandFitMetric[], overall = false): SideBandFitAggregate {
  const weightOf = (m: SideBandFitMetric) => overall ? m.overallWeight : m.weight;
  const expected = metrics.filter((m) => weightOf(m) > 0);
  const measured = expected.filter((m) => m.conformance !== null);
  const totalWeight = expected.reduce((sum, m) => sum + weightOf(m), 0);
  const measuredWeight = measured.reduce((sum, m) => sum + weightOf(m), 0);
  const fitWeight = measured.reduce((sum, m) => sum + weightOf(m) * m.conformance!, 0);
  if (!totalWeight) return {
    score: null, observedSubsetFit: null, possibleScoreRange: [0, 10],
    coverage: 0, measuredCount: 0, expectedCount: 0,
  };
  const complete = measured.length === expected.length;
  const lower = Math.min(10, Math.max(0, 10 * fitWeight / totalWeight));
  const upper = complete ? lower : Math.min(10, lower + 10 * (totalWeight - measuredWeight) / totalWeight);
  return {
    score: complete ? lower : null,
    observedSubsetFit: measuredWeight > 0 ? Math.min(10, 10 * fitWeight / measuredWeight) : null,
    possibleScoreRange: [lower, upper],
    coverage: complete ? 1 : measuredWeight / totalWeight,
    measuredCount: measured.length,
    expectedCount: expected.length,
  };
}

/**
 * An interpretable full-range candidate: ten times the weighted mean of the
 * scorer's existing conformance values. Ten means every supported metric lies
 * in its declared band, not an ideal person, a rare face, or a 10/10 rating.
 * The public Report type is deliberately not used: there is no valid z-score
 * or percentile to feed mergeReports. The app does not call this function.
 */
export function evaluateSideBandFit(raw: Readonly<Record<string, unknown>>, sex: Sex): SideBandFit {
  if (sex !== "male" && sex !== "female") throw new Error("An explicit reference group is required.");
  const metrics: SideBandFitMetric[] = SIDE_METRICS.map((def) => {
    if (directionFor(def, sex) !== "band") throw new Error(`Review ${SIDE_BAND_FIT_VERSION} for non-band metric ${def.id}.`);
    const value = raw[def.id];
    const finite = typeof value === "number" && Number.isFinite(value);
    const outside = finite && def.plausible != null && (value < def.plausible[0] || value > def.plausible[1]);
    const d = distFor(def, sex);
    const ideal = d.ideal ?? d.mean;
    const tolerance = toleranceOf(def) * d.sd;
    const weight = def.weight * reliabilityOf(def.id);
    return {
      id: def.id, region: def.region, pillar: def.pillar,
      value: finite ? value : null,
      state: !finite ? "missing" : outside ? "outside-plausibility" : "measured",
      conformance: finite && !outside ? conformance(def, value, sex) : null,
      weight, overallWeight: weight * PILLAR_WEIGHTS[def.pillar],
      band: [ideal - tolerance, ideal + tolerance],
    };
  });
  return {
    version: SIDE_BAND_FIT_VERSION,
    status: "offline-candidate",
    meaning: "fit-to-current-reference-bands-not-attractiveness",
    referenceGroup: sex,
    populationPercentile: null,
    overall: aggregate(metrics, true),
    regions: Object.fromEntries([...new Set(metrics.map((m) => m.region))]
      .map((region) => [region, aggregate(metrics.filter((m) => m.region === region))])),
    pillars: Object.fromEntries((Object.keys(PILLAR_WEIGHTS) as PillarId[])
      .map((pillar) => [pillar, aggregate(metrics.filter((m) => m.pillar === pillar))])) as Record<PillarId, SideBandFitAggregate>,
    metrics,
  };
}
