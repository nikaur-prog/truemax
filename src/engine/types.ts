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
  // One direction, or one per sex.
  //
  // Sexual dimorphism is not a nuance here, it is the point: a wide, short
  // upper face (fWHR) is the textbook masculine signal, and the nineteen-face
  // corpus reads it +0.55 with attractiveness in men and −0.51 in women. One
  // shared direction cannot express that, and forcing one means being wrong
  // about half the population on the metrics that carry the most dimorphic
  // information. Read it through directionFor(), never directly.
  direction: Direction | { male: Direction; female: Direction };
  // 0..1 — how much of the gap non-surgical change can realistically close
  // (body fat, debloat, grooming, posture). Drives current → potential.
  fixability: number;
  dist: { male: SexDist; female: SexDist };
  // Hard anatomical bounds, outside which the number is not a face — it is a
  // misplaced landmark. Only set where geometry or anatomy gives a defensible
  // limit; deliberately far wider than the reference spread, so this catches
  // impossible values and never an unusual one. See scoreMetric.
  plausible?: [number, number];
  /**
   * TOLERANCE: how far either side of the ideal still counts as ideal, in
   * population sd. Band metrics only.
   *
   * Scoring used to treat the ideal as a POINT — `|value − ideal| / sd`, zero
   * only on an exact match — so every deviation cost immediately and a face
   * had to hit 31 exact numbers to score well. Nobody does, which is why good
   * faces converged on mediocre: a benchmark scan of one well-regarded face
   * put it 3.0 points below a competing product, and the measurements agreed
   * to two decimals while the scores did not (docs/BENCHMARK_CAVILL.md).
   *
   * A tolerance band is the standard shape for scoring against a spec, and it
   * is also the honest one: this engine cannot resolve differences smaller
   * than its own measurement noise, so it must not pretend to rank them.
   * Inside the band a metric is simply ideal.
   */
  tolerance?: number;
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
  /**
   * How close to ideal this measurement is, 0 to 1, where 1 means "inside the
   * tolerance band — nothing to fix here". See scoring.conformance.
   *
   * Deliberately NOT the same quantity as `score`. `score` is a rank: 5.0 is
   * the population median and 7.3 means "closer to ideal than 73% of people".
   * `conformance` is a spec reading: is this feature holding the face back at
   * all. A face can be dead-on ideal and still only out-rank 73% of the
   * population, because being near ideal is common — both numbers are true and
   * they answer different questions. Reporting the rank alone is what made a
   * measurement that agreed with an external benchmark to within 0.7 of a
   * degree read as a 7.3 against their 10.0 (docs/BENCHMARK_CAVILL.md).
   *
   * Use conformance to decide what to WORK ON, score to say where someone
   * STANDS.
   */
  conformance: number;
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
  /**
   * How much of this region's score is signal rather than photo-to-photo noise:
   * the weighted mean of its metrics' measured reliabilities, 0 to 1.
   *
   * It exists because some regions are built almost entirely from measurements
   * the repo has already established are noise. Every nose metric scores under
   * 0.15 — nasalIndex is 0.00, meaning two photographs of one person disagree
   * about it as much as two different people do — yet the nose still printed a
   * confident score on a headline card. effWeight already stops that reaching
   * the OVERALL number; nothing stopped it reaching the reader.
   */
  reliability: number;
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
