import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { buildGeometry } from "./geometry.js";
import { METRICS, computeRawMetrics } from "./metrics.js";
import { AGG_NORM } from "./aggNorm.js";
import { RELIABLE_MIN, reliabilityOf } from "./reliability.js";
import { extractShape, shapeZScore } from "./shape.js";
import { SIDE_METRICS, computeSideMetrics, sidePointIntegrityIssues } from "./sideMetrics.js";
import type { SidePoints } from "./sideMetrics.js";
import type {
  MetricDef,
  PillarId,
  RegionId,
  RegionScore,
  Report,
  ScoredMetric,
  Sex,
} from "./types.js";

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
  return Math.round(aggScoreUnrounded(z) * 10) / 10;
}

function aggScoreUnrounded(z: number): number {
  const raw = clamp(5 + SCORE_SCALE * z, 0.5, 9.9);
  if (raw >= KNEE) return raw;
  const span = KNEE - FLOOR;
  return KNEE - span * (1 - Math.exp(-(KNEE - raw) / span));
}

// Convert an editable headline score back to the percentile represented by
// the aggregate display curve. This must invert aggScore rather than the raw
// 5 + 1.3z scale because scores below 5 use the documented soft floor.
export function aggregateScoreToPercentile(score: number): number {
  if (score <= FLOOR) return 0;
  let lo = -8;
  let hi = 8;
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    if (aggScoreUnrounded(mid) < score) lo = mid;
    else hi = mid;
  }
  return Math.round(phi((lo + hi) / 2) * 1000) / 10;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function scoreMetric(def: MetricDef, value: number, sex: Sex): ScoredMetric {
  const d = def.dist[sex];
  const z = (value - d.mean) / d.sd;

  // Anatomically impossible readings are placement errors, not faces.
  //
  // The side view is thirteen points a person drags into position by hand, and
  // it is the only input in this engine somebody can get wrong. When a point
  // lands in the wrong place the measurement built on it does not become
  // unusual, it becomes impossible: a ramus the same length as the mandibular
  // body, a gonial angle no jaw has. Scoring that as an extreme face is the
  // engine reporting a number it should be rejecting, and it lands as "your
  // jaw is 2/10" when the truth is "the jaw corner is in the wrong place".
  //
  // So it is excluded from every aggregate (see effWeight) and the UI is told
  // which points to re-check. Bounds are far outside the reference spread and
  // are only set where anatomy or geometry gives a defensible limit.
  const implausible = def.plausible
    ? value < def.plausible[0] || value > def.plausible[1] || !Number.isFinite(value)
    : !Number.isFinite(value);

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
    ...(implausible ? { implausible: true } : {}),
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
// Continue the quantile mapping past either end at the slope of the outer
// quartile, so faces beyond the reference population keep separating from
// each other instead of piling onto one score.
function tailZ(z: number, q: number[], last: number): number {
  const hiP = 1 - 0.5 / (last + 1);
  const loP = 0.5 / (last + 1);
  const qi = Math.max(1, Math.round(last * 0.25)); // quartile anchor
  if (z >= q[last]) {
    const span = q[last] - q[last - qi] || 1e-9;
    const slope = (probit(hiP) - probit(1 - qi / last)) / span;
    return probit(hiP) + (z - q[last]) * Math.max(0.2, slope);
  }
  const span = q[qi] - q[0] || 1e-9;
  const slope = (probit(qi / last) - probit(loP)) / span;
  return probit(loP) - (q[0] - z) * Math.max(0.2, slope);
}

// ---------------------------------------------------------------------------
// Measurement-noise shrinkage: RETIRED, and this is why.
//
// It compressed every aggregate toward the median by a factor of 0.66, derived
// as the reliability ratio k = var(true)/(var(true)+var(noise)) from a measured
// single-photo noise of 0.72 sigma. The statistics were sound. The consequence
// was not, and the consequence is what shipped:
//
//   reference percentile   score it could produce
//   50th                   5.00
//   90th                   6.10
//   95th                   6.41
//   99th                   7.00
//   99.9th                 7.65
//
// The entire top one per cent of faces was squeezed into 0.65 points. Four
// photographs of visibly, increasingly good-looking men scored 4.5, 4.2, 4.3 and
// 4.3 — a 0.3-point band with the ordering wrong. A scale that cannot separate
// the people its audience most wants separated is not being conservative, it is
// being useless, and it reads to a viewer as the instrument being invented.
//
// It also silently broke the product's own arithmetic. Every piece of copy here
// describes MEASURED POSITION — "5.0 is the exact middle face", "8.0 is about 1
// in 100" — and aggregateScoreToPercentile inverts the raw 5 + 1.3z curve. The
// forward path applied the shrink; the inverse never undid it. The two
// disagreed by the shrink factor, so an 8.0 was advertised as 1 in 91 while
// actually requiring the 99.976th percentile, about 1 in 4,242. Nobody could
// reach the number the education screen promised was reachable.
//
// The honest reading of the original problem is that shrinkage was the wrong
// instrument for it. The symptom that motivated it — "a room of ordinary,
// decent-looking people all landing mid-3s to low-4s" — is a CENTRING error:
// everybody too low. Shrinking toward the median does lift the bottom, but only
// as a side effect of crushing everything, and it pays for that lift by
// destroying the top. A mean shift wants the reference re-centred, not the
// spread compressed.
//
// The measurement noise is real and is still disclosed, in the three places it
// was always disclosed and where a reader can actually see it:
//
//   - PHOTO_VARIANCE (+/-1.2) and varianceLine(), printed in the primer and
//     under the score: "one photograph is not a verdict"
//   - effWeight(), which already multiplies each metric by its measured
//     reliability, so noisy metrics move the number less
//   - the rescan delta copy, which says outright when a change is smaller than
//     the instrument can resolve
//
// Three visible admissions of noise are worth more than a fourth invisible one
// that quietly rewrites the scale. So the score is measured position again, and
// 5 + SCORE_SCALE * z means what every sentence in the product says it means.
export const SHRINK = 1;

function normalizeAgg(
  z: number,
  sex: Sex,
  key: string,
  raw: Record<string, number>,
): number {
  raw[key] = z;
  const q = AGG_NORM[sex]?.[key];
  if (!q || q.length < 3) return SHRINK * z;
  // Where does this face sit in the reference population? Interpolate its
  // position in the quantile table, then convert that percentile back to a
  // z. Deliberately NOT a mean/SD rescale: the aggregate has heavy tails, and
  // treating it as normal is what pushed top scores to 9+.
  const last = q.length - 1;
  // Outside the reference range, EXTRAPOLATE rather than clamp.
  //
  // Clamping here was a real defect: every face above the population maximum
  // collapsed onto one percentile, which mapped to exactly 7.6. Nine of the
  // twenty-seven faces in the consensus-attractive set scored 7.6 — not a
  // coincidence, the ceiling. It destroyed discrimination in precisely the
  // range this product's audience cares about, and no amount of genuine
  // structural advantage could ever show up as a higher number.
  //
  // The slope is taken from the quartile-to-max span rather than the final
  // bin. The top two quantiles of a 117-person reference sit very close
  // together, so using that bin as the scale made the extrapolation explode:
  // a face slightly past the maximum would have shot to 9.9.
  if (z >= q[last] || z <= q[0]) return SHRINK * tailZ(z, q, last);
  let pct: number;
  {
    let i = 0;
    while (i < last && z > q[i + 1]) i++;
    const span = q[i + 1] - q[i] || 1e-9;
    pct = (i + (z - q[i]) / span) / last;
  }
  return SHRINK * probit(clamp(pct, 0.001, 0.999));
}

// How much of a region's score is signal rather than noise.
//
// Weighted by the same declared weights the aggregate uses, so this answers the
// question actually being asked: of the evidence that PRODUCED this number, how
// much of it holds still between two photographs of one face.
//
// The nose is the case that forced this. All three of its metrics measure below
// 0.15 and nasalIndex is exactly 0.00 — two photographs of one person disagree
// about it as much as two different people do — and yet a nose score appeared on
// a headline card with the same weight and typography as proportions, whose
// metrics average 0.61. effWeight already keeps that out of the overall number.
// Nothing kept it away from the reader, who has no way to tell the two apart.
export function regionReliability(ms: ScoredMetric[]): number {
  let num = 0;
  let den = 0;
  for (const m of ms) {
    if (m.implausible) continue;
    const w = m.def.weight;
    num += w * reliabilityOf(m.def.id);
    den += w;
  }
  return den > 0 ? num / den : 0;
}

// Below this, a region's score is presented as indicative rather than as a
// number. Set at the product-wide RELIABLE_MIN rather than the stricter bar the
// reel uses: a card can carry a caveat right next to it and can be tapped for
// the detail underneath, which is exactly what a published video cannot do.
export const REGION_RELIABLE_MIN = RELIABLE_MIN;

// A metric only influences the score in proportion to how reproducibly it
// measures the same face across different photos (see reliability.ts).
function effWeight(m: ScoredMetric): number {
  // An impossible reading carries no weight anywhere. Zero rather than reduced:
  // there is no partial credit in "that landmark is in the wrong place", and a
  // reduced weight would still drag the aggregate toward a number nobody
  // measured.
  if (m.implausible) return 0;
  return m.def.weight * reliabilityOf(m.def.id);
}

// How much of the overall score comes from the shape descriptor vs the
// individual ratios.
//
// This was 0.6, on the reasoning that the descriptor averages ~130 landmarks
// and so reproduces far better across photos of one person than any single
// ratio does. That reasoning was about RELIABILITY and it is still true — but
// reliability is not validity. A metric can be perfectly repeatable and still
// measure nothing you care about, and that is what was happening: the majority
// of every score came from a term that barely distinguished the consensus-
// attractive top tier from the general reference population.
//
// Measured, leave-one-out (tools rebuild the axis with each face removed, then
// score that face on an axis it had no hand in defining):
//
//   shapeZ  d = 0.326 male / 0.263 female   <- in-sample it looks like .48/.70
//   ratioZ  d = 1.189 male / 0.916 female
//
// Sweeping the blend against held-out separation peaks at 0.15, and the peak
// is shallow — the descriptor adds about 4% over dropping it entirely. It
// earns a small weight, not a majority one.
const W_SHAPE = 0.15;

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
  // Recorded so the calibration harness can decompose where score variance
  // between two photos of the same face actually comes from.
  rawZ["blend:shape"] = shapeZ ?? NaN;
  rawZ["blend:ratio"] = ratioZ;
  const overallZ = normalizeAgg(blended, sex, "overall", rawZ);

  const regions = (Object.keys(REGION_NAMES) as RegionId[]).map((r) => {
    const ms = scored.filter((m) => m.def.region === r);
    const rz = normalizeAgg(aggregateZ(ms.map(eff), ms.map(effWeight), RHO_METRICS + 0.05), sex, `region:${r}`, rawZ);
    return {
      region: r,
      score: aggScore(rz),
      percentile: Math.round(phi(rz) * 1000) / 10,
      z: rz,
      metrics: ms,
      reliability: regionReliability(ms),
    };
  });

  return {
    sex,
    overall: aggScore(overallZ),
    overallPercentile: Math.round(phi(overallZ) * 1000) / 10,
    overallZ,
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
  const invalid = METRICS
    .filter((m) => m.view === "front")
    .filter((m) => !Number.isFinite(raw[m.id]))
    .map((m) => m.id);
  if (invalid.length) throw new Error(`Face scan produced invalid measurements: ${invalid.join(", ")}`);
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
  // shapeZ is passed through UNCHANGED, so potential can only move the ratio
  // share of the score — W_SHAPE of it is pinned at today's value. That is
  // deliberate, but it was not defensible while W_SHAPE was 0.6: it meant no
  // amount of realistic change could shift 60% of someone's score, and
  // potential topped out barely above actual for everyone. At 0.15 the pinned
  // share is small enough to be honest.
  //
  // It stays pinned rather than getting lifted alongside the metrics because
  // there is no measurement saying it should move. Across 229 scored faces the
  // descriptor and the ratio composite are very nearly independent —
  // r = 0.113 male, 0.019 female — so the fixable metrics carry almost no
  // information about where the descriptor sits.
  //
  // That correlation is BETWEEN people, though, and what potential needs is the
  // within-person slope: if one person's fixable metrics improve, how far does
  // their own outline follow? Different skeletons dominate the between-person
  // variance, so the two numbers are not the same and this one cannot stand in
  // for the other. Settling it needs the same faces measured before and after a
  // real change, which we do not have. Until then the conservative direction is
  // to leave it pinned — overstating what someone can reach is the failure mode
  // that makes a potential number worthless.
  report.potential = Math.max(report.overall, buildReport(scored, sex, lift, shapeZ).overall);

  return report;
}

// Side profile: same scoring pipeline, driven by the user-verified points.
export function analyzeSide(points: SidePoints, faceDir: number, sex: Sex): Report {
  const integrity = sidePointIntegrityIssues(points, undefined, undefined, faceDir);
  if (integrity.length) throw new Error(`Profile landmarks need correction: ${integrity.join("; ")}`);
  const raw = computeSideMetrics(points, faceDir);
  const invalid = SIDE_METRICS.filter((m) => !Number.isFinite(raw[m.id])).map((m) => m.id);
  if (invalid.length) throw new Error(`Profile scan produced invalid measurements: ${invalid.join(", ")}`);
  const scored = SIDE_METRICS.map((def) => scoreMetric(def, raw[def.id], sex));
  const report = buildReport(scored, sex);

  const lift = new Map<string, number>();
  for (const m of scored) {
    if (m.def.fixability > 0 && m.zEff < Z_CLAMP) lift.set(m.def.id, m.def.fixability * 0.9);
  }
  report.potential = Math.max(report.overall, buildReport(scored, sex, lift).overall);
  return report;
}

// ---------------------------------------------------------------------------
// Combining the front and side scans into one number.
//
// The obvious implementation is wrong, and it is worth saying why in full,
// because it is the kind of wrong that produces a plausible number.
//
// The obvious version pools the metric lists — buildReport([...front, ...side])
// — and lets the normal aggregation run. That breaks the scale. AGG_NORM's
// quantile tables were measured from FRONT-ONLY scans of the reference
// population (tools/normalize.mjs), and the whole reason they exist is that
// "5.0 = the 50th percentile" holds by construction rather than by assumption.
// Feed a front+side aggregate into a front-only table and that guarantee is
// gone: the combined aggregate has a different distribution, so every
// percentile printed against it is a number with no referent.
//
// Fixing it properly would mean regenerating the tables from front+side scans
// of all ~110 reference faces. We cannot: side landmarks are hand-placed by
// the user, thirteen points at a time, because a true profile cannot be
// landmarked automatically with any confidence. That is 1,430 manual
// placements, and it is not happening.
//
// So combine one level up instead. front.zScores.overall and
// side.zScores.overall have EACH already been mapped through their own
// normalisation, so both are unit-normal by construction. Combining two
// unit-normal variates with a correlation assumption is exactly what
// aggregateZ already does for pillars, and the result is still unit-normal —
// which is the property the whole scale rests on. No new reference data
// required, and nothing about the front-only path changes.
//
// Two numbers here are assumptions, not measurements, and they are the honest
// weak point of this function:
// ---------------------------------------------------------------------------

// Front carries 31 metrics plus a shape descriptor averaging ~130 landmarks,
// all placed automatically. Side carries 15 metrics derived from 13 points a
// person dragged into place by hand. The split reflects both how much is being
// measured and how reliably it was located.
const W_FRONT = 0.75;
const W_SIDE = 0.25;

// Correlation between the two views' aggregates. They describe the same skull
// from different angles, so it is clearly neither 0 nor 1. Measuring it needs
// paired front+side scans of the reference set — the same data we do not have.
// 0.5 is a deliberate midpoint: it is the value that makes the combined score
// move meaningfully when the side disagrees with the front, without letting a
// hand-placed profile swing the result. Revisit the moment paired data exists.
const RHO_VIEWS = 0.5;

export function mergeReports(front: Report, side: Report): Report {
  // The NORMALISED aggregates, not zScores.overall. zScores holds the raw
  // pre-normalisation values that AGG_NORM is derived from; those are not
  // unit-normal and combining them would be combining two different scales.
  // This distinction cost a debugging round: the raw front aggregate read
  // 0.029 where the normalised one was 0.308, so the merge was quietly
  // under-weighting the front view by an order of magnitude.
  const zf = front.overallZ;
  const zsRaw = side.overallZ;
  if (!Number.isFinite(zf) || !Number.isFinite(zsRaw)) return front;

  // Clamp the side aggregate the same way every per-metric z is clamped.
  //
  // Found by testing rather than by reasoning: feeding the flow a profile photo
  // of a different person, with the auto-placed points accepted unverified,
  // produced a side aggregate near -3.4σ and dragged the merged score from 5.4
  // to 4.1. Thirteen points placed by hand is the least reliable input in the
  // whole pipeline — it is the ONLY one a user can get wrong by mis-dragging —
  // so it is exactly the input that should not be able to swing the result
  // without limit. At ±2.2 a genuinely extreme profile still moves the score
  // hard; a mis-placed one cannot bury it.
  const zs = clamp(zsRaw, -Z_CLAMP, Z_CLAMP);

  const z = aggregateZ([zf, zs], [W_FRONT, W_SIDE], RHO_VIEWS);

  // Regions the two views share get combined the same way; regions only one
  // view measures pass through untouched.
  const byRegion = new Map<RegionId, RegionScore>();
  for (const r of front.regions) byRegion.set(r.region, r);
  for (const r of side.regions) {
    if (!r.metrics.length) continue;
    const f = byRegion.get(r.region);
    const zsr = r.z;
    const zfr = f ? f.z : NaN;
    if (!f || !Number.isFinite(zfr) || !Number.isFinite(zsr)) {
      byRegion.set(r.region, r);
      continue;
    }
    const rz = aggregateZ([zfr, clamp(zsr, -Z_CLAMP, Z_CLAMP)], [W_FRONT, W_SIDE], RHO_VIEWS);
    byRegion.set(r.region, {
      region: r.region,
      score: aggScore(rz),
      percentile: Math.round(phi(rz) * 1000) / 10,
      z: rz,
      metrics: [...f.metrics, ...r.metrics],
      reliability: regionReliability([...f.metrics, ...r.metrics]),
    });
  }

  // Potential is a score, not a z, so it cannot go through aggregateZ. Combine
  // the HEADROOM each view found instead — that is the quantity potential
  // actually reports — and add it to the merged score.
  const gap = W_FRONT * (front.potential - front.overall) + W_SIDE * (side.potential - side.overall);

  return {
    sex: front.sex,
    overall: aggScore(z),
    overallPercentile: Math.round(phi(z) * 1000) / 10,
    overallZ: z,
    // The two views as they stand on their own, so the report can show what
    // went into the merge.
    //
    // The side figure is the UNCLAMPED one, which is not the value the merge
    // arithmetic used. That is deliberate. The clamp only bites on a genuinely
    // extreme profile, and when it does, the clamped number differs from the
    // one the side-profile results screen shows for the same scan — two screens
    // disagreeing about a number with the same name is a worse problem than
    // arithmetic that does not visibly add up. It does not visibly add up
    // anyway: this is a correlated aggregation of z-scores, not an average of
    // two scores, so no pair of displayed figures would sum to the total. The
    // cap is explained in the copy beneath the cards instead.
    views: {
      front: { score: aggScore(zf), percentile: Math.round(phi(zf) * 1000) / 10 },
      side: { score: aggScore(zsRaw), percentile: Math.round(phi(zsRaw) * 1000) / 10 },
    },
    potential: Math.round(Math.max(aggScore(z), aggScore(z) + gap) * 10) / 10,
    pillars: front.pillars,
    regions: [...byRegion.values()],
    metrics: [...front.metrics, ...side.metrics],
    zScores: {
      ...front.zScores,
      overall: z,
      "view:front": zf,
      "view:side": zs,
      "view:sideRaw": zsRaw,
    },
  };
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
