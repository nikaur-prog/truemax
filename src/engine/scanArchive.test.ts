import test from "node:test";
import assert from "node:assert/strict";
import { rehydrateReport } from "./scanArchive.js";
import { METRICS } from "./metrics.js";
import type { Report, ScoredMetric } from "./types.js";

// The archive stores metrics with their defs stripped to an id, so what comes
// back must be rebuilt against the LIVE def tables — same rendering data as a
// fresh scan, no frozen weights or ideal bands from the day it was taken.

function storedMetric(id: string): ScoredMetric {
  // The on-disk shape: def is nothing but an id. Cast because that is exactly
  // what rehydration exists to repair.
  return {
    def: { id } as ScoredMetric["def"],
    value: 1.1,
    z: 0.2,
    zEff: 0.3,
    percentile: 60,
    markerPct: 55,
    score: 6,
    conformance: 0.8,
    idealRange: [0, 2],
  };
}

function storedReport(ids: string[]): Report {
  const metrics = ids.map(storedMetric);
  return {
    sex: "male",
    overall: 5.5,
    overallPercentile: 55,
    overallZ: 0.1,
    potential: 6,
    pillars: { Harmony: 5, Angularity: 5, Dimorphism: 5, Features: 5 },
    regions: [
      { region: "eyes", score: 5, percentile: 50, z: 0, reliability: 0.6, metrics },
    ],
    metrics,
    zScores: {},
  };
}

test("rehydration reattaches the live def and keeps every scored field", () => {
  const r = rehydrateReport(storedReport(["canthalTilt"]));
  assert.equal(r.metrics.length, 1);
  const m = r.metrics[0];
  assert.equal(m.def, METRICS.find((d) => d.id === "canthalTilt"));
  assert.equal(m.value, 1.1);
  assert.equal(m.score, 6);
});

test("a metric the engine no longer defines is dropped, not resurrected", () => {
  const r = rehydrateReport(storedReport(["canthalTilt", "metric-that-was-removed"]));
  assert.deepEqual(r.metrics.map((m) => m.def.id), ["canthalTilt"]);
  assert.deepEqual(r.regions[0].metrics.map((m) => m.def.id), ["canthalTilt"]);
});

test("region metrics are the SAME objects as the flat list", () => {
  const r = rehydrateReport(storedReport(["canthalTilt", "browTilt"]));
  for (const m of r.regions[0].metrics) {
    assert.ok(r.metrics.includes(m), `${m.def.id} is a divergent copy`);
  }
});
