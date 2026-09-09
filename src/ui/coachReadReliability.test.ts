import test from "node:test";
import assert from "node:assert/strict";
import { coachRead, overviewCaveat, regionSummary } from "./templates.js";
import { METRICS } from "../engine/metrics.js";
import type { Report, ScoredMetric } from "../engine/types.js";

function metric(id: string, extra: Partial<ScoredMetric> = {}): ScoredMetric {
  const def = METRICS.find((x) => x.id === id)!;
  return { def, value: def.dist.male.mean, z: 0, zEff: -1, score: 4, percentile: 30, markerPct: 30, conformance: 0.5, idealRange: [0, 1], ...extra };
}

test("overview does not praise a low-reliability nose or prescribe work from a missing measure", () => {
  const nose = metric("nasalIndex");
  const missing = metric("jawCheekRatio", { value: Number.NaN, implausible: true });
  const report = { sex: "male", metrics: [nose, missing], regions: [{ region: "nose", percentile: 95, score: 8, reliability: 0.09, metrics: [nose] }] } as Report;
  const copy = coachRead(report, null);
  assert.match(copy.good, /isn't enough reliable detail/);
  assert.equal(copy.work, "");
  assert.doesNotMatch(Object.values(copy).join(" "), /born with|holding you back|standout|don't go changing/);
});

test("preferred-band readings do not trigger a recommendation", () => {
  const report = { sex: "male", metrics: [metric("jawCheekRatio", { conformance: 1 })], regions: [] } as unknown as Report;
  assert.equal(coachRead(report, null).work, "");
});

test("overview names the reference model and capture limits without claiming measured bone", () => {
  assert.match(overviewCaveat(), /reference model/);
  assert.match(overviewCaveat(), /point placement/);
  assert.doesNotMatch(overviewCaveat(), /scored on bone|0.9 points/);
});

test("each region explains its numbers without repeating praise or a coaching greeting", () => {
  const m = metric("jawCheekRatio");
  const text = regionSummary({ region: "jaw", percentile: 30, score: 4, z: -1, reliability: 0.47, metrics: [m] }, "male", { name: "Jane" });
  assert.match(text, /reference mean/);
  assert.match(text, /TrueMax's model/);
  assert.doesNotMatch(text, /Jane|down to business|carrying this|heavy lifting|standing in the way|one to go at/);
});
