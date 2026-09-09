import test from "node:test";
import assert from "node:assert/strict";
import { buildMaxContext } from "./maxContext.js";
import { METRICS } from "./metrics.js";
import { SIDE_METRICS } from "./sideMetrics.js";
import type { Report, ScoredMetric } from "./types.js";
import { sanitiseContext, buildSystemPrompt } from "../../api/_maxPersona.js";

function metric(id: string, extra: Partial<ScoredMetric> = {}): ScoredMetric {
  const def = [...METRICS, ...SIDE_METRICS].find((x) => x.id === id)!;
  return { def, value: def.dist.male.mean, z: 0, zEff: -1, score: 4, percentile: 30, markerPct: 30, conformance: 0.5, idealRange: [0, 1], ...extra };
}

function report(metrics: ScoredMetric[]): Report {
  return { sex: "male", overall: 5, overallPercentile: 50, overallZ: 0, potential: 6, metrics, regions: [], pillars: { Harmony: 5, Features: 5, Angularity: 5, Dimorphism: 5 }, zScores: {} };
}

test("Coach never selects missing or indicative measurements as priorities or strengths", () => {
  const result = buildMaxContext({ report: report([
    metric("foreheadRatio", { value: Number.NaN, implausible: true, zEff: -10 }),
    metric("nasalIndex", { zEff: 20 }),
    metric("browTilt"),
  ]), tone: "blunt", scans: 1 });
  assert.deepEqual(result.measurements.map((m) => m.label), ["Brow tilt"]);
  assert.ok(result.focus.every((f) => !/forehead|nasal/i.test(f)));
});

test("directional display bands are not sent as personal targets", () => {
  const result = buildMaxContext({ report: report([metric("canthalTilt")]), tone: "blunt", scans: 1 });
  assert.equal(result.measurements[0].target, undefined);
  assert.match(result.measurements[0].caveat!, /no personal target is established/);
});

test("a gonial caution travels from the report through to the server prompt", () => {
  const result = buildMaxContext({ report: report([metric("gonialAngle")]), tone: "blunt", scans: 1 });
  const server = sanitiseContext(result, 25)!;
  const prompt = buildSystemPrompt(server);
  assert.match(prompt, /not validated for these points/);
  assert.match(prompt, /do not call the jaw good or bad from this number/);
  assert.equal(result.focus.length, 0);
});

test("a preferred-band measurement does not become an improvement task", () => {
  const result = buildMaxContext({ report: report([metric("jawCheekRatio", { conformance: 1 })]), tone: "blunt", scans: 1 });
  assert.equal(result.focus.length, 0);
});
