import type { CelebEntry } from "../engine/celebs.js";
import { METRICS } from "../engine/metrics.js";
import { reliabilityOf } from "../engine/reliability.js";
import { regionIsScored, scoreFrontMeasurements } from "../engine/scoring.js";
import type { RegionId } from "../engine/types.js";

export interface CelebrityReferenceEstimate {
  score: number | null;
  regions: Partial<Record<RegionId, number>>;
}

/**
 * Run only the stored measurement vector through the current canonical scorer.
 * This is not a new scan of the displayed portrait: the reference entries do
 * not include a mesh/outline descriptor or any side-profile measurements.
 * Never add a celebrity-specific override or a score for missing evidence.
 */
export function celebrityReferenceEstimate(celebrity: CelebEntry): CelebrityReferenceEstimate {
  const raw = Object.fromEntries(METRICS
    .filter(def => def.view === "front" && Number.isFinite(celebrity.metrics[def.id]))
    .map(def => [def.id, celebrity.metrics[def.id]]));
  const report = scoreFrontMeasurements(raw, celebrity.sex);
  const hasEvidence = report.metrics.some(metric =>
    !metric.implausible && Number.isFinite(metric.value) &&
    metric.def.weight > 0 && reliabilityOf(metric.def.id) > 0);
  if (!hasEvidence || !Number.isFinite(report.overall)) return { score: null, regions: {} };
  return {
    score: report.overall,
    regions: Object.fromEntries(report.regions
      .filter(region => regionIsScored(region) && Number.isFinite(region.score))
      .map(region => [region.region, region.score])),
  };
}
