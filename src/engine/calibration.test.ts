import test from "node:test";
import assert from "node:assert/strict";
import corpus from "./calibration/corpus.json" with { type: "json" };
import { METRICS } from "./metrics.js";
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

test("the corpus is intact and every face carries every front measurement", () => {
  assert.equal(FACES.length, 19);
  assert.equal(FACES.filter((f) => f.sex === "male").length, 9);
  assert.equal(FACES.filter((f) => f.sex === "female").length, 10);
  for (const f of FACES) {
    assert.ok(f.rating >= 1 && f.rating <= 10, `${f.id} has no usable rating`);
    for (const def of FRONT) {
      assert.equal(typeof f.measurements[def.id], "number", `${f.id} is missing ${def.id}`);
    }
  }
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

test("the scale still uses its range on real faces", () => {
  // The failure that made every one of these faces look the same. Nineteen
  // people from "well below average" to "professional model" used to come back
  // inside 3.5–5.5, because a shared centring error in the measurements
  // dominated everything that actually distinguished them.
  const scores = scoreAll(FACES);
  const span = Math.max(...scores) - Math.min(...scores);
  assert.ok(span >= 3.5, `nineteen faces span only ${span.toFixed(1)} points`);
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
  const women = held.filter((h) => h.sex === "female");
  const rW = corr(women.map((h) => h.rating), women.map((h) => h.overall));
  assert.ok(rW >= 0.6, `women, held out: r=${rW.toFixed(2)}, expected ≥0.6`);

  const rAll = corr(held.map((h) => h.rating), held.map((h) => h.overall));
  assert.ok(rAll >= 0.35, `all faces, held out: r=${rAll.toFixed(2)}, expected ≥0.35`);
});

test("the male half of the corpus is still too thin to have fixed", () => {
  // Not a passing grade dressed up as one. Held out, the men correlate about
  // −0.1 — the calibration did essentially nothing for them, and this test
  // exists so that stays visible instead of being averaged into a pooled figure
  // that looks like progress.
  //
  // The cause is countable: nine men, whose ratings bunch between 4.5 and 6.1,
  // against thirty-one directions to choose. There is no fit that survives
  // that, and none should be claimed. What it needs is more male faces spread
  // across the range, not more tuning.
  //
  // Flip this assertion the day the men clear 0.6 — deleting it then is the
  // point of it being here.
  const men = leaveOneOut().filter((h) => h.sex === "male");
  const r = corr(men.map((h) => h.rating), men.map((h) => h.overall));
  assert.ok(
    r < 0.6,
    `men now hold up out of sample (r=${r.toFixed(2)}) — fold them into the main assertion and delete this test`,
  );
});
