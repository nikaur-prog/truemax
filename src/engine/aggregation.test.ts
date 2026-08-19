import test from "node:test";
import assert from "node:assert/strict";
import { AGG_NORM } from "./aggNorm.js";
import { tableZ, TAIL_Z_MAX, phi, probit } from "./scoring.js";

// ---------------------------------------------------------------------------
// The relationship between the metrics and the headline number.
//
// Four real scans on 2026-08-17 showed the overall sitting anywhere from 1.0
// BELOW to 2.5 ABOVE the mean of its own metrics — and two faces whose metric
// means were 0.19 apart came out 2.1 points apart. tools/transfer.mjs
// reproduces the whole curve; these pin the properties that must hold once it
// is fixed.
//
// These tests import tableZ from scoring.ts rather than mirroring it. The
// old mirror kept passing after the real mapping changed — a test of nothing.
//
// The failing one is `todo` rather than deleted: it is the definition of
// correct, it does not pass today, and a green suite that simply omits it is
// how this shipped in the first place.
// ---------------------------------------------------------------------------

const PILLARS = ["Harmony", "Angularity", "Dimorphism", "Features"] as const;

// Plain weighted mean, mirroring scoring.ts.
const aggregateZ = (zs: number[]) => zs.reduce((a, z) => a + z, 0) / zs.length;

/** Overall percentile for a face whose every metric sits at the same z. */
function overallPctAt(metricZ: number, sex: "male" | "female" = "male"): number {
  const t = AGG_NORM[sex];
  const pz = PILLARS.map((p) =>
    tableZ(aggregateZ(Array(8).fill(metricZ)), t[`pillar:${p}`]));
  return phi(tableZ(aggregateZ(pz), t.overall)) * 100;
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
    const pct = phi(tableZ(median, q)) * 100;
    assert.ok(Math.abs(pct - 50) < 6, `${sex}: median maps to ${pct.toFixed(1)}th`);
  }
});

// ---------------------------------------------------------------------------
// The cliff at the edge of the reference set — the 9.9 bug.
//
// The male overall table tops out at aggregate z +0.338, and real attractive
// faces measure past that: a corpus face humans rate 7.0 sits at +0.604. The
// old extrapolation continued at the outer-quartile slope (~4.9 sigma per
// unit) with no ceiling, so +0.80 of aggregate — attractive, not
// otherworldly — was reported as +4.2 sigma and displayed as 9.9/10.
//
// Separately, the in-table mapping sent a face just INSIDE the top bin to
// probit(0.999) = +3.09 while a face AT the table maximum took the tail's
// +1.98 — a non-monotonic step, masked only by the tail slope being steep
// enough to leap back over it.
//
// These four properties together make both defects impossible to
// reintroduce silently.
// ---------------------------------------------------------------------------

test("tableZ is monotonic through the table edges, not just inside them", () => {
  for (const sex of ["male", "female"] as const) {
    for (const key of ["overall", "pillar:Harmony", "region:jaw"]) {
      const q = AGG_NORM[sex][key];
      const lo = q[0] - 1.5;
      const hi = q[q.length - 1] + 1.5;
      let prev = -Infinity;
      for (let i = 0; i <= 600; i++) {
        const z = lo + ((hi - lo) * i) / 600;
        const v = tableZ(z, q);
        assert.ok(
          v >= prev - 1e-12,
          `${sex} ${key}: tableZ decreases at z=${z.toFixed(4)} (${prev} -> ${v})`,
        );
        prev = v;
      }
    }
  }
});

test("no aggregate can extrapolate past what the sample supports", () => {
  for (const sex of ["male", "female"] as const) {
    for (const key of Object.keys(AGG_NORM[sex])) {
      const q = AGG_NORM[sex][key];
      assert.ok(tableZ(50, q) <= TAIL_Z_MAX + 1e-9, `${sex} ${key}: top unbounded`);
      assert.ok(tableZ(-50, q) >= -TAIL_Z_MAX - 1e-9, `${sex} ${key}: bottom unbounded`);
    }
  }
});

test("the mapping is continuous where the table hands over to the tail", () => {
  const eps = 1e-6;
  for (const sex of ["male", "female"] as const) {
    const q = AGG_NORM[sex].overall;
    const last = q.length - 1;
    for (const edge of [q[0], q[last]]) {
      const inside = tableZ(edge - (edge === q[0] ? -eps : eps), q);
      const at = tableZ(edge, q);
      assert.ok(
        Math.abs(inside - at) < 0.01,
        `${sex}: jump of ${(inside - at).toFixed(4)} sigma at edge ${edge}`,
      );
    }
  }
});

test("a face at the sample maximum claims the sample-max percentile, not the 99.9th", () => {
  for (const sex of ["male", "female"] as const) {
    const q = AGG_NORM[sex].overall;
    const k = q.length; // quantile points
    const honest = probit(1 - 0.5 / k);
    assert.ok(
      tableZ(q[q.length - 1], q) <= honest + 1e-6,
      `${sex}: table max overclaims (${tableZ(q[q.length - 1], q).toFixed(3)} > ${honest.toFixed(3)})`,
    );
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
