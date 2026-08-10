import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { buildGeometry } from "./geometry.ts";
import { METRICS, computeRawMetrics } from "./metrics.ts";
import { AGG_NORM } from "./aggNorm.ts";
import { reliabilityOf } from "./reliability.ts";
import { extractShape, shapeZScore } from "./shape.ts";
import { SIDE_METRICS, computeSideMetrics } from "./sideMetrics.ts";
import type { SidePoints } from "./sideMetrics.ts";
import type {
  MetricDef,
  PillarId,
  RegionId,
  Report,
  ScoredMetric,
  Sex,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Percentile-anchored scoring. 5.0 = 50th percentile, and the score scale is
// σ-based (score = 5 + SCALE·z), so 6.5+ is genuinely rare:
//   6.5 → z ≈ +1.15 → top ~12%      9.0 → z ≈ +3.1 → ~1 in 1000
// ---------------------------------------------------------------------------

const SCORE_SCALE = 1.3; // score points per σ
const Z_CLAMP = 2.2; // per-metric influence clamp (noisy landmark guard)
// Assumed inter-metric correlation when re-standardizing aggregates. Facial
// metrics correlate (a lean, structured face moves many at once); without
// this, averaging ~30 z-scores would crush everyone toward 5.0.
const RHO_METRICS = 0.3;
const RHO_PILLARS = 0.55;

const PILLAR_WEIGHTS: Record<PillarId, number> = {
  Harmony: 0.35,
  Angularity: 0.25,
  Dimorphism: 0.2,
  Features: 0.2,
};

export const REGION_NAMES: Record<RegionId, string> = {
  eyes: "Eyes",
  midface: "Midface",
  jaw: "Jaw",
  chin: "Chin",
  nose: "Nose",
  lips: "Lips",
  proportions: "Proportions",
  symmetry: "Symmetry",
};

// Standard normal CDF via Abramowitz–Stegun erf approximation — deterministic
export function phi(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    (0.254829592 * t -
      0.284496736 * t ** 2 +
      1.421413741 * t ** 3 -
      1.453152027 * t ** 4 +
      1.061405429 * t ** 5) *
      Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

// Inverse standard normal CDF (Acklam's approximation) — deterministic
export function probit(p: number): number {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const dd = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((dd[0] * q + dd[1]) * q + dd[2]) * q + dd[3]) * q + 1);
  }
  if (p <= 1 - pl) {
    const q = p - 0.5;
    const r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((dd[0] * q + dd[1]) * q + dd[2]) * q + dd[3]) * q + 1);
}

function zToScore(z: number): number {
  return Math.round(clamp(5 + SCORE_SCALE * z, 0.5, 9.9) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Soft floor on the DISPLAYED aggregate scores.
//
// Run across 110 population portraits the raw scale bottomed out at 1.8, with
// five people under 3.0 — and those are ordinary, accomplished adults. Handing
// a real person a 1.8 out of 10 for their face is the numerical version of the
// thing this product refuses to say in words, and the scale is not precise
// down there anyway: below about the 10th percentile the reference sample is
// thin and a tenth of a point means nothing.
//
// So the bottom is compressed toward an asymptote rather than truncated. The
// mapping is smooth, strictly increasing and identity at or above the knee, so
// nothing about the ORDERING changes — a worse face still scores worse. Only
// the distance between bad and very bad shrinks, which is honest, because that
// distance was never measured well.
//
// Percentiles are untouched: someone in the bottom 8% is still told they are in
// the bottom 8%. And this applies only to the aggregate headline numbers —
// individual metric rows keep their raw score, because those are the evidence
// the plan ranks from and evidence should stay sharp.
const FLOOR = 3.2;
const KNEE = 5.0;

function aggScore(z: number): number {
  const raw = clamp(5 + SCORE_SCALE * z, 0.5, 9.9);
  if (raw >= KNEE) return Math.round(raw * 10) / 10;
  const span = KNEE - FLOOR;
  return Math.round((KNEE - span * (1 - Math.exp(-(KNEE - raw) / span))) * 10) / 10;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function scoreMetric(def: MetricDef, value: number, sex: Sex): ScoredMetric {
  const d = def.dist[sex];
  const z = (value - d.mean) / d.sd;

  let zEff: number;
  switch (def.direction) {
    case "higher":
      zEff = z;
      break;
    case "lower":
      zEff = -z;
      break;
    case "band": {
      // Percentile of closeness-to-ideal: the fraction of the population
      // sitting FARTHER from the ideal than this value, converted back to a
      // standard-normal z. This makes zEff exactly N(0,1) across the
      // population — no inflation by construction.
      const ideal = d.ideal ?? d.mean;
      const m = (ideal - d.mean) / d.sd; // ideal's offset from the mean
      const c = Math.abs(value - ideal) / d.sd; // this face's distance
      const fracCloser = phi(m + c) - phi(m - c);
      zEff = probit(clamp(1 - fracCloser, 0.0005, 0.9995));
      break;
    }
  }
  zEff = clamp(zEff, -Z_CLAMP, Z_CLAMP);

  const ideal = d.ideal ?? d.mean;
  const idealRange: [number, number] =
    def.direction === "lower"
      ? [Math.max(0, d.mean - 1.5 * d.sd), d.mean - 0.3 * d.sd]
      : def.direction === "higher"
        ? [d.mean + 0.3 * d.sd, d.mean + 1.5 * d.sd]
        : [ideal - 0.6 * d.sd, ideal + 0.6 * d.sd];

  return {
    def,
    value,
    z,
    zEff,
    percentile: Math.round(phi(zEff) * 1000) / 10,
    markerPct: Math.round(phi(z) * 1000) / 10,
    score: zToScore(zEff),
    idealRange,
  };
}

// Weighted mean of correlated z-scores, re-standardized so the aggregate is
// itself ~N(0,1) across the population (see RHO_* above).
function aggregateZ(zs: number[], weights: number[], rho: number): number {
  const wSum = weights.reduce((a, b) => a + b, 0);
  if (!wSum) return 0;
  const mean = zs.reduce((a, z, i) => a + z * weights[i], 0) / wSum;
  const w2 = weights.reduce((a, b) => a + b * b, 0);
  const varOfMean = rho + (1 - rho) * (w2 / (wSum * wSum));
  return mean / Math.sqrt(varOfMean);
}

// Empirical standardization of the aggregate. Per-metric effective z's are
// only approximately N(0,1) — real measurements are skewed and heavy-tailed,
// and 31 of them compound that error, which would push the population median
// off 5.0 and exaggerate the spread. AGG_NORM is measured directly from the
// population reference set (tools/normalize.mjs), so "5.0 = 50th percentile"
// holds by construction rather than by assumption.
function normalizeAgg(
  z: number,
  sex: Sex,
  key: string,
  raw: Record<string, number>,
): number {
  raw[key] = z;
  const q = AGG_NORM[sex]?.[key];
  if (!q || q.length < 3) return z;
  // Where does this face sit in the reference population? Interpolate its
  // position in the quantile table, then convert that percentile back to a
  // z. Deliberately NOT a mean/SD rescale: the aggregate has heavy tails, and
  // treating it as normal is what pushed top scores to 9+.
  const last = q.length - 1;
  let pct: number;
  if (z <= q[0]) pct = 0.5 / (last + 1);
  else if (z >= q[last]) pct = 1 - 0.5 / (last + 1);
  else {
    let i = 0;
    while (i < last && z > q[i + 1]) i++;
    const span = q[i + 1] - q[i] || 1e-9;
    pct = (i + (z - q[i]) / span) / last;
  }
  return probit(clamp(pct, 0.001, 0.999));
}

// A metric only influences the score in proportion to how reproducibly it
// measures the same face across different photos (see reliability.ts).
function effWeight(m: ScoredMetric): number {
  return m.def.weight * reliabilityOf(m.def.id);
}

// How much of the overall score comes from the shape descriptor vs the
// individual ratios. Ratios are legible but noisy; the descriptor averages
// ~130 landmarks and reproduces far better, so it carries the majority.
const W_SHAPE = 0.6;

function buildReport(scored: ScoredMetric[], sex: Sex, zShift?: Map<string, number>, shapeZ?: number | null): Report {
  const rawZ: Record<string, number> = {};
  const eff = (m: ScoredMetric) =>
    clamp(m.zEff + (zShift?.get(m.def.id) ?? 0), -Z_CLAMP, Z_CLAMP);

  const pillars = {} as Record<PillarId, number>;
  const pillarZ = {} as Record<PillarId, number>;
  for (const p of Object.keys(PILLAR_WEIGHTS) as PillarId[]) {
    const ms = scored.filter((m) => m.def.pillar === p);
    pillarZ[p] = normalizeAgg(aggregateZ(ms.map(eff), ms.map(effWeight), RHO_METRICS), sex, `pillar:${p}`, rawZ);
    pillars[p] = aggScore(pillarZ[p]);
  }

  const pillarIds = Object.keys(PILLAR_WEIGHTS) as PillarId[];
  const ratioZ = aggregateZ(pillarIds.map((p) => pillarZ[p]), pillarIds.map((p) => PILLAR_WEIGHTS[p]), RHO_PILLARS);
  const blended = shapeZ == null ? ratioZ : W_SHAPE * shapeZ + (1 - W_SHAPE) * ratioZ;
  const overallZ = normalizeAgg(blended, sex, "overall", rawZ);

  const regions = (Object.keys(REGION_NAMES) as RegionId[]).map((r) => {
    const ms = scored.filter((m) => m.def.region === r);
    const rz = normalizeAgg(aggregateZ(ms.map(eff), ms.map(effWeight), RHO_METRICS + 0.05), sex, `region:${r}`, rawZ);
    return {
      region: r,
      score: aggScore(rz),
      percentile: Math.round(phi(rz) * 1000) / 10,
      metrics: ms,
    };
  });

  return {
    sex,
    overall: aggScore(overallZ),
    overallPercentile: Math.round(phi(overallZ) * 1000) / 10,
    potential: 0, // filled by analyze()
    pillars,
    regions,
    metrics: scored,
    zScores: rawZ,
  };
}

export function analyze(
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
  sex: Sex,
): Report {
  const g = buildGeometry(landmarks, width, height);
  const raw = computeRawMetrics(g);
  const shapeZ = shapeZScore(extractShape(g), sex);

  const scored = METRICS.filter((m) => m.view === "front").map((def) =>
    scoreMetric(def, raw[def.id], sex),
  );

  const report = buildReport(scored, sex, undefined, shapeZ);

  // Potential: re-run aggregation with each fixable metric's effective z
  // lifted in proportion to its fixability — capped, so potential stays
  // honest (habits and composition, not a new skeleton).
  const lift = new Map<string, number>();
  for (const m of scored) {
    if (m.def.fixability > 0 && m.zEff < Z_CLAMP) {
      lift.set(m.def.id, m.def.fixability * 0.9);
    }
  }
  report.potential = Math.max(report.overall, buildReport(scored, sex, lift, shapeZ).overall);

  return report;
}

// Side profile: same scoring pipeline, driven by the user-verified points.
export function analyzeSide(points: SidePoints, faceDir: number, sex: Sex): Report {
  const raw = computeSideMetrics(points, faceDir);
  const scored = SIDE_METRICS.map((def) => scoreMetric(def, raw[def.id], sex));
  const report = buildReport(scored, sex);

  const lift = new Map<string, number>();
  for (const m of scored) {
    if (m.def.fixability > 0 && m.zEff < Z_CLAMP) lift.set(m.def.id, m.def.fixability * 0.9);
  }
  report.potential = Math.max(report.overall, buildReport(scored, sex, lift).overall);
  return report;
}

// Max change in overall per 1σ change of a single metric — the brief requires
// ≤ ~0.3 so one noisy landmark can't swing the result. Exercised in tests.
export function maxMetricInfluence(): number {
  let worst = 0;
  for (const p of Object.keys(PILLAR_WEIGHTS) as PillarId[]) {
    const ms = METRICS.filter((m) => m.view === "front" && m.pillar === p);
    const wSum = ms.reduce((a, m) => a + m.weight, 0);
    const w2 = ms.reduce((a, m) => a + m.weight * m.weight, 0);
    const restd = 1 / Math.sqrt(RHO_METRICS + (1 - RHO_METRICS) * (w2 / (wSum * wSum)));
    const pillarShare = PILLAR_WEIGHTS[p];
    const pillarRestd =
      1 / Math.sqrt(RHO_PILLARS + (1 - RHO_PILLARS) * 0.265); // Σw² of pillar weights
    for (const m of ms) {
      const sens =
        SCORE_SCALE * (m.weight / wSum) * restd * pillarShare * pillarRestd;
      worst = Math.max(worst, sens);
    }
  }
  return worst;
}
