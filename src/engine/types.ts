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
  // Hard anatomical bounds, outside which the number is not a face — it is a
  // misplaced landmark. Only set where geometry or anatomy gives a defensible
  // limit; deliberately far wider than the reference spread, so this catches
  // impossible values and never an unusual one. See scoreMetric.
  plausible?: [number, number];
  // The landmarks this measurement is built from, so an implausible value can
  // name what to re-check rather than saying "something is wrong".
  points?: string[];
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
  // The value fell outside anatomical possibility, so it is a placement error
  // rather than a face. Excluded from every aggregate and shown as needing a
  // re-check instead of as a bad number.
  implausible?: boolean;
}

export interface RegionScore {
  region: RegionId;
  score: number;
  percentile: number;
  // Normalised region aggregate, same distinction as Report.overallZ.
  z: number;
  metrics: ScoredMetric[];
}

export interface ViewScore {
  score: number;
  percentile: number;
}

export interface Report {
  sex: Sex;
  overall: number;
  overallPercentile: number;
  // The overall aggregate AFTER quantile normalisation — unit-normal across
  // the reference population by construction. Distinct from zScores.overall,
  // which is the RAW pre-normalisation aggregate that AGG_NORM is built from.
  // Merging two views requires the normalised value; using the raw one silently
  // combines quantities that are not on a common scale.
  overallZ: number;
  potential: number;
  // Each view's own standing, kept alongside the merged number so the report
  // can show what combined into what. Absent on a single-view report — its
  // score IS the front view, and restating it twice says nothing.
  views?: { front: ViewScore; side: ViewScore };
  pillars: Record<PillarId, number>;
  regions: RegionScore[];
  metrics: ScoredMetric[]; // flat, every scored metric
  // Unrounded aggregate z per key ("overall", "pillar:X", "region:Y").
  // The calibration pipeline reads these to derive AGG_NORM.
  zScores: Record<string, number>;
}
