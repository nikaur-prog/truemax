import test from "node:test";
import assert from "node:assert/strict";
import { buildPassPlan } from "./measurePass.js";
import { hasOverlay } from "./measureOverlay.js";
import { RELIABLE_MIN, reliabilityOf } from "../engine/reliability.js";
import { REGION_RELIABLE_MIN } from "../engine/scoring.js";
import { METRICS } from "../engine/metrics.js";
import { SIDE_METRICS } from "../engine/sideMetrics.js";
import type { RegionId, Report, ScoredMetric } from "../engine/types.js";

// A metric carrying a real MetricDef, so reliabilityOf and hasOverlay are
// answering about a measurement that actually exists rather than about a
// string invented by the test.
function metric(id: string): ScoredMetric {
  const def = [...METRICS, ...SIDE_METRICS].find((m) => m.id === id);
  assert.ok(def, `no such metric: ${id}`);
  return {
    def,
    value: 1.23,
    z: 0,
    zEff: 0,
    percentile: 50,
    markerPct: 50,
    score: 5,
    conformance: 0.5,
    idealRange: [0, 2],
  };
}

function region(id: RegionId, ids: string[], reliability = 0.6) {
  return { region: id, score: 5, percentile: 50, z: 0, reliability, metrics: ids.map(metric) };
}

function report(regions: ReturnType<typeof region>[]): Report {
  return {
    sex: "male",
    overall: 5,
    overallPercentile: 50,
    overallZ: 0,
    potential: 6,
    pillars: { Harmony: 5, Angularity: 5, Dimorphism: 5, Features: 5 },
    regions,
    metrics: regions.flatMap((r) => r.metrics),
    zScores: {},
  };
}

test("the plan walks the face top to bottom, not in report order", () => {
  const plan = buildPassPlan(
    report([
      region("jaw", ["jawCheekRatio"]),
      region("eyes", ["browTilt"]),
      region("lips", ["lipRatio"]),
    ]),
    null,
  );
  assert.deepEqual(plan.map((s) => s.region), ["eyes", "lips", "jaw"]);
});

test("a region the report refuses to score is never featured", () => {
  // The nose, exactly as it fails in production: every metric under
  // RELIABLE_MIN, so the region's weighted reliability lands under the bar.
  const unscored = region("nose", ["nasalIndex", "noseMouthRatio"], REGION_RELIABLE_MIN - 0.01);
  const plan = buildPassPlan(report([region("eyes", ["browTilt"]), unscored]), null);
  assert.deepEqual(plan.map((s) => s.region), ["eyes"]);
});

test("no beat is ever built on a measurement below RELIABLE_MIN", () => {
  // This is the load-bearing one. A scored region can still CONTAIN noise
  // metrics, and drawing a beautifully animated construction for a measurement
  // whose reliability is 0.00 is the most convincing lie the app could tell.
  // fwhr is 0.00 and jawCheekRatio is 0.47, both in the jaw region.
  const plan = buildPassPlan(report([region("jaw", ["fwhr", "jawCheekRatio"])]), null);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].metric.def.id, "jawCheekRatio");
});

test("a region whose only drawable metrics are noise is skipped entirely", () => {
  // Not "falls back to something" — skipped. There is nothing honest to show.
  const plan = buildPassPlan(report([region("jaw", ["fwhr"]), region("lips", ["lipRatio"])]), null);
  assert.deepEqual(plan.map((s) => s.region), ["lips"]);
});

test("the region's speaker is the metric carrying the most of its score", () => {
  // Effective weight, i.e. weight x reliability — the same quantity scoring.ts
  // uses to decide how much a metric counts. Asserted as a property rather than
  // as a hard-coded id, so re-weighting a metric does not break the test for
  // the wrong reason.
  const ids = ["browTilt", "canthalTilt", "browPosition", "eyeAspectRatio"];
  const plan = buildPassPlan(report([region("eyes", ids)]), null);
  const eff = (id: string) => METRICS.find((m) => m.id === id)!.weight * reliabilityOf(id);
  const best = ids
    .filter((id) => hasOverlay(id) && reliabilityOf(id) >= RELIABLE_MIN)
    .sort((a, b) => eff(b) - eff(a))[0];
  assert.equal(plan[0].metric.def.id, best);
});

test("an implausible reading is never featured", () => {
  const r = region("jaw", ["jawCheekRatio", "gonialProxy"]);
  r.metrics[0].implausible = true;
  const plan = buildPassPlan(report([r]), null);
  assert.equal(plan.length, 1);
  assert.notEqual(plan[0].metric.def.id, "jawCheekRatio");
});

test("the cap trims front beats and keeps the profile represented", () => {
  const front = report([
    region("eyes", ["browTilt"]),
    region("midface", ["midfaceRatio"]),
    region("lips", ["lipRatio"]),
    region("jaw", ["jawCheekRatio"]),
    region("proportions", ["facialIndex"]),
  ]);
  const side = report([region("jaw", ["gonialAngle"]), region("nose", ["nasolabialAngle"])]);
  const plan = buildPassPlan(front, side, { maxSteps: 4 });
  assert.equal(plan.length, 4);
  // Whatever else went, the side is still in the running order.
  assert.ok(plan.some((s) => s.view === "side"), "the profile must survive the cap");
  // And the front beats kept are the EARLY ones, not an arbitrary subset.
  const frontRegions = plan.filter((s) => s.view === "front").map((s) => s.region);
  assert.deepEqual(frontRegions, ["eyes", "midface"].slice(0, frontRegions.length));
});

test("a front-only scan plans a front-only pass", () => {
  const plan = buildPassPlan(report([region("eyes", ["browTilt"])]), null);
  assert.ok(plan.every((s) => s.view === "front"));
});

test("the pass walks EVERY honest measurement in a region, not one speaker", () => {
  // The old plan featured one metric per region and the whole show was over in
  // eight beats — three lines of front analysis, then the profile. The scan
  // has to show all of its work; the honesty filters still apply to each one.
  const ids = ["browTilt", "canthalTilt", "browPosition", "eyeAspectRatio"];
  const plan = buildPassPlan(report([region("eyes", ids)]), null);
  const expected = ids.filter((id) => hasOverlay(id) && reliabilityOf(id) >= RELIABLE_MIN);
  assert.equal(plan.length, expected.length);
  assert.deepEqual(new Set(plan.map((s) => s.metric.def.id)), new Set(expected));
});


