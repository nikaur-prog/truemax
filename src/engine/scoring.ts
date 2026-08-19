import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { buildGeometry } from "./geometry.js";
import { METRICS, computeRawMetrics, directionFor, distFor } from "./metrics.js";
import { AGG_NORM } from "./aggNorm.js";
import { RELIABLE_MIN, reliabilityOf } from "./reliability.js";
import { extractShape, shapeZScore } from "./shape.js";
import { findHairline } from "./hairline.js";
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

// Metrics that come from the image rather than from landmark coordinates, and
// may therefore legitimately be absent. Kept as a list rather than a flag on
// MetricDef because it is a fact about how the value ARRIVES, not about the
// measurement — the same forehead number is a pixel metric from a live scan and
// a plain stored value when a saved scan is replayed.
const PIXEL_METRICS = new Set(["foreheadRatio"]);

export const SCORE_SCALE = 1.3; // score points per σ
const Z_CLAMP = 2.2; // per-metric influence clamp (noisy landmark guard)
// Assumed inter-metric correlation when re-standardizing aggregates. Facial
// metrics correlate (a lean, structured face moves many at once); without
// this, averaging ~30 z-scores would crush everyone toward 5.0.

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
  const d = distFor(def, sex);
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

  const direction = directionFor(def, sex);
  let zEff: number;
  switch (direction) {
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
  // A measurement that could not be taken has no position on the scale. It is
  // already excluded by effWeight; pinning zEff to zero as well keeps it from
  // travelling as NaN through anything that reads it before the weighting.
  zEff = Number.isFinite(zEff) ? clamp(zEff, -Z_CLAMP, Z_CLAMP) : 0;

  const ideal = d.ideal ?? d.mean;
  const idealRange: [number, number] =
    direction === "lower"
      ? [Math.max(0, d.mean - 1.5 * d.sd), d.mean - 0.3 * d.sd]
      : direction === "higher"
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
function aggregateZ(zs: number[], weights: number[]): number {
  // Zero-weight entries are dropped rather than multiplied by zero.
  //
  // Not a micro-optimisation — a latent poisoning bug. An excluded metric has
  // weight 0 and, when it was excluded BECAUSE its value is not a number, a
  // z of NaN. 0 × NaN is NaN, so a single unmeasurable metric turned the
  // pillar, the region, the overall score and every percentile built on them
  // into NaN, and the exclusion machinery that was supposed to contain it did
  // nothing. It stayed hidden while every metric was a landmark ratio and
  // therefore always computable; it surfaced the moment one of them was
  // allowed to say "I could not measure this face".
  const kept = zs.map((z, i) => [z, weights[i]] as const).filter(([, w]) => w > 0);
  const wSum = kept.reduce((a, [, w]) => a + w, 0);
  if (!wSum) return 0;
  return kept.reduce((a, [z, w]) => a + z * w, 0) / wSum;
}

// Why this is a plain weighted mean and not the standard error of one.
//
// It used to return mean / sqrt(rho + (1 - rho) * Sw2/wSum^2) — the z of the
// sample MEAN. That is the correct statistic for "how confident am I that this
// face is above average", and the wrong one for "where does this face rank",
// which is the only question the score asks. Averaging thirty-one measurements
// does make the estimate more precise, but precision is not extremity, and
// dividing by it turned the one into the other.
//
// It was applied twice — once across metrics inside a pillar, once across the
// pillars — so roughly twice the true deviation reached the quantile table. The
// table could not absorb it: faces ran past the reference maximum and tailZ's
// linear extrapolation took over, which is how a face whose metrics averaged
// 5.33 out of 10 was reported at the 98.4th percentile. Measured on the shipped
// build, one sigma of movement on every metric moved the aggregate by 3.1,
// against a total spread of 2.83 across the whole 52-man reference population.
//
// The evidence is in tools/transfer.mjs, and the invariants it has to satisfy
// are in aggregation.test.ts.
//
// Note that the aggregate is deliberately insensitive to SPREAD: a face with
// every metric at 5.3 aggregates identically to one with half at 2.8 and half
// at 7.9. That is what a mean does. Whether a lopsided face should be scored
// differently from an even one is a real question, but it is a question about
// what to measure, not about how to add measurements up.

// Empirical standardization of the aggregate. Per-metric effective z's are
// only approximately N(0,1) — real measurements are skewed and heavy-tailed,
// and 31 of them compound that error, which would push the population median
// off 5.0 and exaggerate the spread. AGG_NORM is measured directly from the
// population reference set (tools/normalize.mjs), so "5.0 = 50th percentile"
// holds by construction rather than by assumption.
// Continue the quantile mapping past either end, but with a bounded claim.
//
// The old extrapolation continued at the slope of the outer quartile with no
// ceiling. On a reference set whose top quantiles sit close together that
// slope reached ~4.9 sigma per unit of aggregate z (male overall), so a face
// 0.4 past the table maximum — attractive, not otherworldly — was reported at
// +4 sigma. That is where the 9.9/10 came from: not a measurement of the
// face, a cliff at the edge of the reference set.
//
// A quantile table built from tens of faces per sex cannot support any
// percentile claim past roughly 1 - 1/(2n). Everything beyond the table now
// approaches that bound smoothly instead of shooting through it: strictly
// increasing (ordering is preserved), continuous at the table edge, and the
// entry slope is the table-wide average rate rather than the outer bin's,
// because the outer bin of a small sample is the noisiest thing in it.
// Faces past the edge still separate — just by tenths of a point, which is
// all the evidence supports until the reference set itself reaches higher.
export const TAIL_Z_MAX = 2.6; // ≈ probit(1 - 1/(2n)) at the ~110-per-sex reference target
function tailZ(z: number, q: number[], last: number): number {
  const hiZ = probit(1 - 0.5 / (last + 1));
  const loZ = probit(0.5 / (last + 1));
  const slope = Math.max(0.2, (hiZ - loZ) / (q[last] - q[0] || 1e-9));
  if (z >= q[last]) {
    const room = TAIL_Z_MAX - hiZ;
    return hiZ + room * (1 - Math.exp((-slope * (z - q[last])) / room));
  }
  const room = TAIL_Z_MAX + loZ; // loZ is negative: headroom from loZ down to -TAIL_Z_MAX
  return loZ - room * (1 - Math.exp((-slope * (q[0] - z)) / room));
}

// ---------------------------------------------------------------------------
// Calibrate structural position to the product's 0-10 human rating scale.
//
// The rated validation corpus currently averages 5.1 by blinded human review
// but 6.6 through the raw empirical-percentile transform. A raw percentile is
// useful evidence; presenting its z-score directly as attractiveness was the
// source of the inflation users saw (including ordinary faces in the 90s).
// Pulling aggregate z toward the median preserves ordering and the
// 5.0 centre while making the displayed score conservative. Keep this named
// and tested: it must be re-estimated when the rated corpus grows.
//
// This factor applies ONCE to each final aggregate. Individual metric evidence
// stays uncompressed, so Full mode still explains what moved the result. The
// inverse used by editing and rarity copy operates on the already-calibrated
// aggregate z; forward and inverse must never silently disagree again.
export const SHRINK = 1.13;

// Where 5.0 sits, in reference-population sigmas.
//
// The reference set is people notable for their WORK, and that is the right
// choice for the distribution's SHAPE and the wrong one for its CENTRE: they
// are mostly middle-aged, and this engine's metrics read youthful structure as
// better. Measured on the rated corpus, faces blinded human reviewers score
// 5.09/10 sit 0.87 sigma above the reference median — so "5.0 = the median of
// our reference photographs" and "5.0 = what a person calls average" are two
// different claims, and only the second is the one the product makes.
//
// Rebuilding the reference set did NOT move this. The female table was the
// prime suspect — the sample was small and a smile gate had once biased it —
// but going from a handful of women to 76 left the corpus women sitting in the
// same place, which kills the sampling-error explanation and leaves the
// population-composition one.
//
// So the two sources are used for what each is actually good for: the
// reference photographs give the shape of the distribution (the quantile
// table), and the rated corpus gives where 5.0 falls and how wide a point is.
// Both constants are fitted by tools/fit-scale.ts and BOTH must be re-fitted
// together whenever the corpus or the reference set changes — a scale without
// its centre collapses the range, which is exactly the failure calibration.test
// catches with its paired span and mean-error assertions.
//
// n = 19. That is thin, and it is also the same nineteen faces the shipped
// SHRINK was already fitted to; using them for the centre as well is not a new
// leap of faith, it is the same evidence used correctly.
export const CENTRE = 0.87;

function normalizeAgg(
  z: number,
  sex: Sex,
  key: string,
  raw: Record<string, number>,
): number {
  raw[key] = z;
  const q = AGG_NORM[sex]?.[key];
  // Centre first, then scale — the offset is in reference sigmas, which is the
  // space tableZ returns, so it has to be subtracted before SHRINK converts
  // that space into displayed points.
  if (!q || q.length < 3) return SHRINK * (z - CENTRE);
  return SHRINK * (tableZ(z, q) - CENTRE);
}

// Where does this face sit in the reference population? Interpolate its
// position in the quantile table, then convert that percentile back to a
// z. Deliberately NOT a mean/SD rescale: the aggregate has heavy tails, and
// treating it as normal is what pushed top scores to 9+.
//
// Exported so the tests exercise THIS function rather than a hand-kept
// mirror of it — the mirror in aggregation.test.ts kept passing after the
// real mapping changed, which is a test testing nothing.
export function tableZ(z: number, q: number[]): number {
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
  // The extrapolation itself is bounded — see tailZ. Separation past the
  // table edge is real but small, because that is all the sample supports.
  if (z >= q[last] || z <= q[0]) return tailZ(z, q, last);
  let pct: number;
  {
    let i = 0;
    while (i < last && z > q[i + 1]) i++;
    const span = q[i + 1] - q[i] || 1e-9;
    pct = (i + (z - q[i]) / span) / last;
  }
  // Plotting-position correction. The table's endpoints are the sample
  // extremes, and a sample extreme is evidence for roughly the
  // 1 - 0.5/(k+1) percentile of the population, not the 99.9th. Mapping raw
  // table position straight through probit (with a 0.999 clamp) sent a face
  // just INSIDE the top bin to +3.1 sigma while a face AT the maximum took
  // the tail's edge value of +2.0 — a non-monotonic step, hidden only
  // because the old tail slope was steep enough to leap back over it, and
  // sitting exactly in the range this product's audience cares about.
  // Rescaling position into [0.5/(k+1), 1 - 0.5/(k+1)] makes the mapping
  // continuous with the tail and honest about what k quantile points from a
  // small sample can claim.
  return probit((0.5 + pct * last) / (last + 1));
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
    pillarZ[p] = normalizeAgg(aggregateZ(ms.map(eff), ms.map(effWeight)), sex, `pillar:${p}`, rawZ);
    pillars[p] = aggScore(pillarZ[p]);
  }

  // The overall is built from the RAW metric z's in ONE aggregation, not by
  // averaging the pillar scores.
  //
  // Averaging the pillars normalises twice. Each pillarZ is already that
  // pillar's position in the population, so a face above the median on all four
  // gets four high numbers whose mean stays high — while the reference
  // population's mean-of-pillars is tight, because real faces are strong at some
  // pillars and weak at others and those positions cancel. A face that is
  // genuinely good everywhere does not cancel, lands far outside the range of a
  // statistic built from faces that do, and tailZ extrapolates it off the top.
  // That is how two faces whose metrics averaged 5.69 and 5.37 both came out at
  // the 100th percentile, 9.9 and 9.7.
  //
  // So: every front metric, weighted by its own effective weight times its
  // pillar's share, averaged once, normalised once. Pillars keep their own
  // normalisation because a pillar CARD is a rank and should read as one — it
  // just no longer feeds the overall.
  const ratioZ = aggregateZ(
    scored.map(eff),
    scored.map((m) => effWeight(m) * PILLAR_WEIGHTS[m.def.pillar]),
  );
  const blended = shapeZ == null ? ratioZ : W_SHAPE * shapeZ + (1 - W_SHAPE) * ratioZ;
  // Recorded so the calibration harness can decompose where score variance
  // between two photos of the same face actually comes from.
  rawZ["blend:shape"] = shapeZ ?? NaN;
  rawZ["blend:ratio"] = ratioZ;
  const overallZ = normalizeAgg(blended, sex, "overall", rawZ);

  const regions = (Object.keys(REGION_NAMES) as RegionId[]).map((r) => {
    const ms = scored.filter((m) => m.def.region === r);
    const rz = normalizeAgg(aggregateZ(ms.map(eff), ms.map(effWeight)), sex, `region:${r}`, rawZ);
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

/**
 * The front pipeline from measurements onward, with the camera taken out.
 *
 * `analyze` needs landmarks, landmarks need MediaPipe, and MediaPipe needs a
 * browser — which meant that until now the only way to find out what the engine
 * would say about a face was to open a page and photograph one. That is a fine
 * way to check one face and a hopeless way to check twenty, so the whole
 * question of whether the scoring agrees with a human stayed an opinion.
 *
 * Splitting it here makes the corpus in ./calibration/corpus.json runnable:
 * measurements in, report out, no DOM. calibration.test.ts uses it to assert
 * agreement with human ratings as an actual pass/fail rather than a claim in a
 * commit message.
 *
 * `shapeZ` is optional because the corpus stores measurements, not meshes, and
 * the outline descriptor cannot be recovered from ratios. Passing null drops
 * W_SHAPE of the blend, so harness overalls sit a little away from what the
 * same face shows in the app. Fine for ranking, which is what calibration is
 * about; not to be quoted as the score somebody would see.
 */
export function scoreFrontMeasurements(
  raw: Record<string, number>,
  sex: Sex,
  shapeZ: number | null = null,
): Report {
  const scored = METRICS.filter((m) => m.view === "front").map((def) =>
    scoreMetric(def, raw[def.id], sex),
  );
  const report = buildReport(scored, sex, undefined, shapeZ);
  const lift = new Map<string, number>();
  for (const m of scored) {
    if (m.def.fixability > 0 && m.zEff < Z_CLAMP) lift.set(m.def.id, m.def.fixability * 0.9);
  }
  report.potential = Math.max(report.overall, buildReport(scored, sex, lift, shapeZ).overall);
  return report;
}

export function analyze(
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
  sex: Sex,
  /**
   * The photograph, when the caller has it.
   *
   * Everything else in this engine is computed from landmark coordinates, which
   * is why it could never see a hairline: the mesh does not have one. Passing
   * the pixels lets the measurements that need image evidence take it. Optional
   * because several callers legitimately have only landmarks — a stored scan, a
   * replay — and those simply go without, which the scoring already handles as
   * "not measured" rather than as zero.
   */
  source?: CanvasImageSource,
): Report {
  const g = buildGeometry(landmarks, width, height);
  const raw = computeRawMetrics(g);
  if (source) {
    const hair = findHairline(source, landmarks, width, height);
    if (hair) raw.foreheadRatio = hair.foreheadRatio;
  }
  // Pixel-derived measurements are allowed to be missing; landmark ones are
  // not. A landmark metric that cannot be computed means the mesh itself is
  // broken and nothing downstream is trustworthy, whereas a refused hairline
  // means exactly what it says.
  const invalid = METRICS
    .filter((m) => m.view === "front" && !PIXEL_METRICS.has(m.id))
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

  const z = aggregateZ([zf, zs], [W_FRONT, W_SIDE]);

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
    const rz = aggregateZ([zfr, clamp(zsr, -Z_CLAMP, Z_CLAMP)], [W_FRONT, W_SIDE]);
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
    const pillarShare = PILLAR_WEIGHTS[p];
    for (const m of ms) {
      // A weighted mean of weighted means: a metric's share of its pillar times
      // that pillar's share of the whole. No re-standardising step, because
      // aggregateZ no longer has one.
      worst = Math.max(worst, SCORE_SCALE * (m.weight / wSum) * pillarShare);
    }
  }
  return worst;
}
