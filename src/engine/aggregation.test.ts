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

const RHO_METRICS = 0.3;
const RHO_PILLARS = 0.55;
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
const aggregateZ = (zs: number[], rho: number) =>
  (zs.reduce((a, z) => a + z, 0) / zs.length) / Math.sqrt(rho + (1 - rho) / zs.length);

/** Overall percentile for a face whose every metric sits at the same z. */
function overallPctAt(metricZ: number, sex: "male" | "female" = "male"): number {
  const t = AGG_NORM[sex];
  const pz = PILLARS.map((p) =>
    normalizeAgg(aggregateZ(Array(8).fill(metricZ), RHO_METRICS), t[`pillar:${p}`]));
  return phi(normalizeAgg(aggregateZ(pz, RHO_PILLARS), t.overall)) * 100;
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

test("a face at the population mean lands at the population median", { todo: true }, () => {
  // Currently 56.0%. Every metric average by definition means an average face,
  // and an average face is the 50th percentile — that is what the number means.
  const pct = overallPctAt(0);
  assert.ok(Math.abs(pct - 50) < 3, `expected ~50th percentile, got ${pct.toFixed(1)}`);
});

test("a modestly above-average face is not top-of-population", { todo: true }, () => {
  // Currently 94.0% at +0.25 sigma and 98.9% at +0.5 sigma. A quarter of a
  // sigma on every metric is a slightly better than average face, not a one in
  // twenty face — and at +0.5 the raw aggregate exceeds the entire reference
  // population's maximum, which no real face should be able to do by being
  // half a sigma up on everything.
  assert.ok(overallPctAt(0.25) < 80, `+0.25σ gave ${overallPctAt(0.25).toFixed(1)}%`);
  assert.ok(overallPctAt(0.5) < 93, `+0.5σ gave ${overallPctAt(0.5).toFixed(1)}%`);
});
