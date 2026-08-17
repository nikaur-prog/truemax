import test from "node:test";
import assert from "node:assert/strict";
import { AGG_NORM } from "./aggNorm.js";

// ---------------------------------------------------------------------------
// The relationship between the metrics and the headline number.
//
// Four real scans on 2026-08-17 showed the overall sitting anywhere from 1.0
// BELOW to 2.5 ABOVE the mean of its own metrics — and two faces whose metric
// means were 0.19 apart came out 2.1 points apart. tools/transfer.mjs
// reproduces the whole curve; these pin the two properties that must hold once
// it is fixed.
//
// The two failing ones are `todo` rather than deleted: they are the definition
// of correct, they do not pass today, and a green suite that simply omits them
// is how this shipped in the first place.
// ---------------------------------------------------------------------------

const PILLARS = ["Harmony", "Angularity", "Dimorphism", "Features"] as const;

const phi = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));
function erf(x: number): number {
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}
function probit(p: number): number {
  let lo = -8, hi = 8;
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (phi(m) < p) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
function tailZ(z: number, q: number[]): number {
  const last = q.length - 1;
  const hiP = 1 - 0.5 / (last + 1), loP = 0.5 / (last + 1);
  const qi = Math.max(1, Math.round(last * 0.25));
  if (z >= q[last]) {
    const span = q[last] - q[last - qi] || 1e-9;
    return probit(hiP) + (z - q[last]) * Math.max(0.2, (probit(hiP) - probit(1 - qi / last)) / span);
  }
  const span = q[qi] - q[0] || 1e-9;
  return probit(loP) - (q[0] - z) * Math.max(0.2, (probit(qi / last) - probit(loP)) / span);
}
function normalizeAgg(z: number, q: number[]): number {
  const last = q.length - 1;
  if (z >= q[last] || z <= q[0]) return tailZ(z, q);
  let i = 0;
  while (i < last && z > q[i + 1]) i++;
  const span = q[i + 1] - q[i] || 1e-9;
  return probit(Math.min(Math.max((i + (z - q[i]) / span) / last, 0.001), 0.999));
}
// Plain weighted mean, mirroring scoring.ts.
const aggregateZ = (zs: number[]) => zs.reduce((a, z) => a + z, 0) / zs.length;

/** Overall percentile for a face whose every metric sits at the same z. */
function overallPctAt(metricZ: number, sex: "male" | "female" = "male"): number {
  const t = AGG_NORM[sex];
  const pz = PILLARS.map((p) =>
    normalizeAgg(aggregateZ(Array(8).fill(metricZ)), t[`pillar:${p}`]));
  return phi(normalizeAgg(aggregateZ(pz), t.overall)) * 100;
}

test("the quantile tables the score depends on are present for both sexes", () => {
  for (const sex of ["male", "female"] as const) {
    assert.ok(AGG_NORM[sex].overall?.length >= 3, `${sex} overall table missing`);
    for (const p of PILLARS) {
      assert.ok(AGG_NORM[sex][`pillar:${p}`]?.length >= 3, `${sex} pillar:${p} missing`);
    }
  }
});

test("the transfer function is at least monotonic", () => {
  let prev = -Infinity;
  for (const z of [-0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75]) {
    const pct = overallPctAt(z);
    assert.ok(pct >= prev, `not monotonic at metric z=${z}`);
    prev = pct;
  }
});

// The regression this actually guards: the shipped quantile table must
// describe what the shipped code produces. Before the aggregation fix the
// table's male median was +0.107 while a fresh measurement of the same 117
// portraits gave -0.561 — two thirds of a sigma of drift, which is what put an
// average face at the 56th percentile and let mildly-above-average faces reach
// the 98th. Any future change to aggregateZ without regenerating AGG_NORM
// reintroduces exactly that, so pin the property that catches it: the table's
// own median must map to the middle.
test("the population median maps to the middle of the scale", () => {
  for (const sex of ["male", "female"] as const) {
    const q = AGG_NORM[sex].overall;
    const median = q[(q.length / 2) | 0];
    const pct = phi(normalizeAgg(median, q)) * 100;
    assert.ok(Math.abs(pct - 50) < 6, `${sex}: median maps to ${pct.toFixed(1)}th`);
  }
});

// NOT YET TESTABLE HERE, and left explicit rather than forgotten.
//
// The property that actually matters is stability: one face photographed twice
// should not move two points. On the shipped build it did — Marlon scored 8.0,
// 7.5, 7.4 and 5.4 across four photographs, and between two of them a 0.37
// shift in mean metric z produced a 2.1 shift in overall.
//
// It cannot be asserted from a unit test, because it needs the same person
// through the real pipeline twice, and a synthetic face cannot stand in: this
// file's helper holds every metric at one value, which does not survive the
// two-stage normalisation the way a real face does. tools/transfer.mjs has the
// same limitation and its numbers should be read as a shape, not a prediction.
//
// The data to do it properly exists — multi-photo scans per person from the
// reliability work — and wiring that into an acceptance test is the honest
// next step.
test("one face photographed twice scores within half a point", { todo: true }, () => {
  assert.fail("needs multi-photo fixtures through the real pipeline");
});
