import test from "node:test";
import assert from "node:assert/strict";
import corpus from "./calibration/corpus.json" with { type: "json" };
import { METRICS, directionFor } from "./metrics.js";
import { scoreFrontMeasurements } from "./scoring.js";
import type { Direction, Sex } from "./types.js";

// ---------------------------------------------------------------------------
// Does the engine agree with a human about which face is better looking?
//
// Until this file existed that question had no answer, only opinions, because
// the only way to get a score was to open a browser and photograph somebody.
// The answer at the time turned out to be "no": across ten rated men the
// overall score correlated −0.07 with the human judgement. A coin flip does
// about as well, and no amount of rescaling a number with no signal in it was
// ever going to help.
//
// corpus.json is nineteen faces — nine men, ten women — each one rated by eye
// first and scanned afterward, with the full measurement set kept. It is small,
// it is AI-generated portraits rather than a random draw of humanity, and both
// of those are stated here rather than buried, because they bound what any of
// these numbers are allowed to claim.
//
// What this file guards is the property the product is sold on: a higher score
// means a better looking face. Everything else in the engine — the percentile
// curve, the rarity ladder, the region cards, the plan — is downstream of that
// one claim being true, and it was not true for most of this engine's life.
// ---------------------------------------------------------------------------

interface Face { id: string; sex: Sex; rating: number; measurements: Record<string, number> }
const FACES = (corpus as { faces: Face[] }).faces;
const FRONT = METRICS.filter((m) => m.view === "front");

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const corr = (a: number[], b: number[]): number => {
  const ma = mean(a), mb = mean(b);
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? n / Math.sqrt(da * db) : 0;
};
const ranks = (a: number[]) => {
  const order = a.map((v, i) => [v, i] as const).sort((x, y) => x[0] - y[0]);
  const r = new Array<number>(a.length);
  order.forEach(([, i], k) => (r[i] = k + 1));
  return r;
};
const spearman = (a: number[], b: number[]) => corr(ranks(a), ranks(b));

const scoreAll = (faces: Face[]) => faces.map((f) => scoreFrontMeasurements(f.measurements, f.sex).overall);

// Metrics added to the engine AFTER these nineteen faces were captured.
//
// The corpus is a record of what was measured on a given day, so it cannot
// contain a measurement that did not exist yet, and a new metric must not be
// able to fail this file just by being new. What it must also not do is go
// unnoticed: an entry here is a metric with NO rated evidence behind it, so its
// direction and its distribution are a prior and nothing more.
//
// Remove a name from this list by re-scanning the corpus, not by deleting it.
const MEASURED_AFTER_CORPUS = new Set(["cheekFullness", "foreheadRatio"]);

test("the corpus is intact and every face carries every front measurement", () => {
  assert.equal(FACES.length, 19);
  assert.equal(FACES.filter((f) => f.sex === "male").length, 9);
  assert.equal(FACES.filter((f) => f.sex === "female").length, 10);
  for (const f of FACES) {
    assert.ok(f.rating >= 1 && f.rating <= 10, `${f.id} has no usable rating`);
    for (const def of FRONT) {
      if (MEASURED_AFTER_CORPUS.has(def.id)) continue;
      assert.equal(typeof f.measurements[def.id], "number", `${f.id} is missing ${def.id}`);
    }
  }
});

test("a metric the corpus predates cannot poison a score", () => {
  // The bug this pair of tests found. A measurement missing from the input used
  // to arrive as NaN, get correctly excluded with weight zero, and then poison
  // every aggregate anyway through 0 × NaN — so the overall score, both
  // percentiles and the whole region grid came back NaN because one metric was
  // unavailable. Every pixel-derived measurement can legitimately be
  // unavailable, so this has to hold rather than be avoided.
  const face = FACES[0];
  const report = scoreFrontMeasurements(face.measurements, face.sex);
  assert.ok(Number.isFinite(report.overall), "overall went non-finite");
  assert.ok(Number.isFinite(report.overallPercentile), "percentile went non-finite");
  for (const r of report.regions) {
    assert.ok(Number.isFinite(r.score), `${r.region} score went non-finite`);
  }
  // And it is genuinely absent, not quietly defaulted to something.
  const missing = report.metrics.find((m) => MEASURED_AFTER_CORPUS.has(m.def.id));
  assert.ok(missing, "expected at least one metric the corpus predates");
  assert.equal(missing!.implausible, true, "an unmeasurable metric must be excluded, not scored");
});

test("a higher score means a better looking face", () => {
  const scores = scoreAll(FACES);
  const ratings = FACES.map((f) => f.rating);
  const rho = spearman(ratings, scores);
  // Was 0.35 before this calibration and −0.07 before the two direction fixes
  // that preceded it. The bar is set well under what the corpus currently
  // gives, because the point is catching a return to noise, not defending a
  // decimal place that nineteen faces cannot justify to begin with.
  assert.ok(rho >= 0.55, `overall score ranks faces at ρ=${rho.toFixed(2)} against a human — expected ≥0.55`);

  const women = FACES.filter((f) => f.sex === "female");
  const rW = corr(women.map((f) => f.rating), scoreAll(women));
  assert.ok(rW >= 0.6, `women: r=${rW.toFixed(2)}, expected ≥0.6`);
});

test("the absolute scale is conservative on the rated corpus", () => {
  const scores = scoreAll(FACES);
  const ratings = FACES.map((f) => f.rating);
  const meanError = mean(scores.map((s, i) => s - ratings[i]));
  // Before score calibration the engine averaged 6.6 on faces human reviewers
  // averaged 5.1: a +1.5 point inflation hidden by a rank-only test suite.
  assert.ok(Math.abs(meanError) <= 0.75, `engine is biased by ${meanError.toFixed(2)} points on rated faces`);

  // Conservatism must not collapse the useful ordering into one narrow band.
  const span = Math.max(...scores) - Math.min(...scores);
  assert.ok(span >= 2, `nineteen faces span only ${span.toFixed(1)} points`);
});

test("per-metric scores are not pinned against the influence clamp", () => {
  // The mechanism behind the compression, and the thing that will show first if
  // a distribution drifts away from what the mesh reads. A metric jammed at the
  // clamp carries no information about the face — it says only "far away", and
  // it said that about everybody.
  const zs = FACES.flatMap((f) =>
    scoreFrontMeasurements(f.measurements, f.sex).metrics.map((m) => m.zEff),
  );
  const pegged = zs.filter((z) => Math.abs(z) >= 2.19).length / zs.length;
  assert.ok(pegged < 0.08, `${(pegged * 100).toFixed(0)}% of metric scores are pinned at the clamp`);
});

// ---------------------------------------------------------------------------
// The honest number.
//
// The directions in metrics.ts were chosen by looking at this corpus, so the
// agreement measured on this corpus is partly the engine recognising faces it
// was built from. Leave-one-out removes that: for each face, re-derive every
// direction from the other eighteen, then score the one the model has not seen.
//
// It costs the flattering figure and it is the only one worth quoting.
// ---------------------------------------------------------------------------
const DIRECTION_THRESHOLD = 0.4;

function leaveOneOut(): { id: string; sex: Sex; rating: number; overall: number }[] {
  const shipped = new Map(FRONT.map((d) => [d.id, d.direction]));
  const out: { id: string; sex: Sex; rating: number; overall: number }[] = [];
  try {
    for (const held of FACES) {
      const train = FACES.filter((f) => f.id !== held.id);
      for (const def of FRONT) {
        if (def.region === "symmetry") { def.direction = "lower"; continue; }
        const per = {} as Record<Sex, Direction>;
        for (const sex of ["male", "female"] as const) {
          const g = train.filter((f) => f.sex === sex);
          const r = corr(g.map((f) => f.measurements[def.id]), g.map((f) => f.rating));
          per[sex] = Math.abs(r) >= DIRECTION_THRESHOLD ? (r > 0 ? "higher" : "lower") : "band";
        }
        def.direction = per.male === per.female ? per.male : per;
      }
      out.push({ id: held.id, sex: held.sex, rating: held.rating, overall: scoreFrontMeasurements(held.measurements, held.sex).overall });
    }
  } finally {
    for (const def of FRONT) def.direction = shipped.get(def.id)!;
  }
  return out;
}

test("agreement survives on faces the directions were not fitted to", () => {
  const held = leaveOneOut();

  // Both sexes are asserted here, which they have not always been.
  //
  // A separate test used to sit below this one pinning the men BELOW 0.6, on
  // the reasoning that nine men whose ratings bunch between 4.5 and 6.1 cannot
  // support thirty-one fitted directions — held out they correlated about
  // −0.1, and averaging that into a pooled figure would have read as progress
  // where there was none. That test asked to be deleted the day the men
  // cleared 0.6, and the tolerance band cleared it: 0.70 held out, from a
  // standing start of roughly zero.
  //
  // Why a scoring curve moved the men and not the women is not mysterious. The
  // old curve scored distance from a point ideal in population sd, so on a
  // narrow male distribution every ordinary face was several sd from ideal on
  // something and the ranking came out of noise. Giving each metric a band as
  // wide as its own measurement error stops the engine ranking differences it
  // cannot reproduce, and what is left is signal. See scoring.toleranceOf.
  //
  // The thresholds sit below the measured values on purpose. At n=9 a single
  // face moves r by more than the margin, so these are a floor against
  // regression, not a claim about the population.
  const women = held.filter((h) => h.sex === "female");
  const rW = corr(women.map((h) => h.rating), women.map((h) => h.overall));
  assert.ok(rW >= 0.65, `women, held out: r=${rW.toFixed(2)}, expected ≥0.65`);

  const men = held.filter((h) => h.sex === "male");
  const rM = corr(men.map((h) => h.rating), men.map((h) => h.overall));
  assert.ok(rM >= 0.5, `men, held out: r=${rM.toFixed(2)}, expected ≥0.5`);

  const rAll = corr(held.map((h) => h.rating), held.map((h) => h.overall));
  assert.ok(rAll >= 0.6, `all faces, held out: r=${rAll.toFixed(2)}, expected ≥0.6`);
});

test("a metric inside its tolerance band is reported as ideal, not merely ranked", () => {
  // The defect the band exists to fix, stated as an invariant.
  //
  // A face measured within its own repeatability of the ideal used to be told
  // it out-ranked some fraction of the population and nothing else — which is
  // true, and which reads as a mark against a feature that has nothing wrong
  // with it. An external benchmark made the size of that visible: a canthal
  // tilt agreeing with a competing product to within 0.7 of a degree scored
  // 7.3 against their 10.0 (docs/BENCHMARK_CAVILL.md).
  //
  // Conformance answers the other question. Both numbers stay, because they
  // are both true and they are not the same question.
  const scored = FACES.flatMap((f) =>
    scoreFrontMeasurements(f.measurements, f.sex).metrics.map((m) => ({ m, sex: f.sex })),
  ).map(({ m, sex }) => Object.assign(m, { sex }));

  // In band is conformance EXACTLY 1, not approximately. The plateau is flat by
  // construction — every value inside the band is the same distance from it,
  // namely none — so a 0.9999 is a value sitting just OUTSIDE the band, and
  // treating the two as the same thing is what a tolerance band exists to stop.
  const inBand = scored.filter((m) => m.conformance === 1);
  assert.ok(inBand.length > 0, "no measurement in the corpus lands inside its band");
  assert.ok(
    inBand.length < scored.length,
    "every measurement is in band — the bands are too wide to distinguish anything",
  );

  // Outside the band conformance is strictly below 1 and never negative, and
  // the falloff reaches near zero only at the edge of anatomical plausibility.
  for (const m of scored) {
    assert.ok(
      m.conformance >= 0 && m.conformance <= 1,
      `${m.def.id} conformance ${m.conformance} out of range`,
    );
  }

  // The band is what the UI draws, so a reader inside the green stripe must
  // never be told they lost points for it.
  //
  // Only "band" metrics are checked both ways. For "lower" and "higher" the
  // band is open-ended on the good side while the drawn range is a readable
  // window capped at 1.5 sd, so a value can legitimately sit past the far edge
  // of the stripe — that is being further into the good direction, not a
  // disagreement. What must hold for those is the near edge: in band means at
  // or beyond where the stripe starts.
  for (const m of inBand) {
    const [lo, hi] = m.idealRange;
    const d = directionFor(m.def, m.sex);
    if (d === "band") {
      assert.ok(
        m.value >= lo - 1e-9 && m.value <= hi + 1e-9,
        `${m.def.id} scores as in band (${m.value}) but draws its range as ${lo}–${hi}`,
      );
    } else if (d === "higher") {
      assert.ok(m.value >= lo - 1e-9, `${m.def.id} in band at ${m.value} but stripe starts at ${lo}`);
    } else if (d === "lower") {
      assert.ok(m.value <= hi + 1e-9, `${m.def.id} in band at ${m.value} but stripe ends at ${hi}`);
    }
  }
});

test("the band reading and the rank reading never contradict each other", () => {
  // The rundown paints its colour grammar from `conformance` (inside the
  // tolerance band?) rather than from `zEff` (out-ranks half the population?).
  // That is only a safe swap because the two never disagree in SIGN: switching
  // must resolve the old neutral middle and nothing else, never turn a
  // measurement that read positive into one that reads negative.
  //
  // Measured across the whole rated corpus when the change was made: 0 metrics
  // in band yet ranked weak, 0 out of band yet ranked strong, out of 627. If a
  // future ideal or tolerance moves far enough to break that, the video would
  // start contradicting the report, and this is where it surfaces.
  const metrics = FACES.flatMap((f) => scoreFrontMeasurements(f.measurements, f.sex).metrics);
  assert.ok(metrics.length > 300, "corpus too small for this to mean anything");

  const inBandButWeak = metrics.filter((m) => m.conformance >= 1 && m.zEff <= -0.5);
  const outOfBandButStrong = metrics.filter((m) => m.conformance < 1 && m.zEff >= 0.5);

  assert.equal(
    inBandButWeak.length,
    0,
    `in band but ranked weak: ${inBandButWeak.map((m) => m.def.id).join(", ")}`,
  );
  assert.equal(
    outOfBandButStrong.length,
    0,
    `out of band but ranked strong: ${outOfBandButStrong.map((m) => m.def.id).join(", ")}`,
  );
});
