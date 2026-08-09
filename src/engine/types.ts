export type Sex = "male" | "female";
export type View = "front" | "side";

export type RegionId =
  | "eyes"
  | "midface"
  | "jaw"
  | "chin"
  | "nose"
  | "lips"
  | "proportions"
  | "symmetry";

export type PillarId = "Harmony" | "Angularity" | "Dimorphism" | "Features";

// How a metric's raw value maps to "better":
//  - "band": there is an ideal value; distance from it (in SDs) is penalized
//  - "lower": smaller is strictly better (asymmetry, deviation metrics)
//  - "higher": larger is strictly better
export type Direction = "band" | "lower" | "higher";

export interface SexDist {
  mean: number;
  sd: number;
  // Target value for "band" metrics. Defaults to mean when omitted.
  ideal?: number;
}

export interface MetricDef {
  id: string;
  name: string;
  unit: string; // "°", "×", "%", "" (pure ratio)
  decimals: number;
  view: View;
  region: RegionId;
  pillar: PillarId;
  weight: number; // relative weight inside its pillar
  direction: Direction;
  // 0..1 — how much of the gap non-surgical change can realistically close
  // (body fat, debloat, grooming, posture). Drives current → potential.
  fixability: number;
  dist: { male: SexDist; female: SexDist };
}

export interface ScoredMetric {
  def: MetricDef;
  value: number;
  z: number; // raw z against the population mean
  zEff: number; // "goodness" z after direction/band transform
  percentile: number; // Φ(zEff) · 100 — "better than X% of population"
  markerPct: number; // Φ(z) · 100 — position of the raw value in the population, for range bars
  score: number; // 0–10, 5.0 = population median
  idealRange: [number, number]; // display range for UI bars
}

export interface RegionScore {
  region: RegionId;
  score: number;
  percentile: number;
  metrics: ScoredMetric[];
}

export interface Report {
  sex: Sex;
  overall: number;
  overallPercentile: number;
  potential: number;
  pillars: Record<PillarId, number>;
  regions: RegionScore[];
  metrics: ScoredMetric[]; // flat, every scored metric
  // Unrounded aggregate z per key ("overall", "pillar:X", "region:Y").
  // The calibration pipeline reads these to derive AGG_NORM.
  zScores: Record<string, number>;
}
