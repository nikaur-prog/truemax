import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { METRICS, distFor } from "../engine/metrics.js";
import { conformance } from "../engine/scoring.js";
import { SIDE_METRICS } from "../engine/sideMetrics.js";
import type { MetricDef, ScoredMetric, Sex } from "../engine/types.js";
import { metricFit, metricFitHTML, metricModelScoreLabel } from "./metricFit.js";
import { overviewHTML } from "./metricDetail.js";

function reading(def: MetricDef, value: number, sex: Sex = "male", score = 5): ScoredMetric {
  return { def, value, score, conformance: conformance(def, value, sex), idealRange: [89.3, 100.7] } as ScoredMetric;
}

test("an in-range nasolabial reading stays in-range despite its midpoint model score", () => {
  const def = SIDE_METRICS.find(metric => metric.id === "nasolabialAngle")!;
  const metric = reading(def, 99.3);
  assert.equal(metric.conformance, 1);
  assert.deepEqual(metricFit(metric, "male"), { state: "within", label: "Within model reference range", shortLabel: "Within range" });
  assert.equal(metricModelScoreLabel(metric), "Model score 5.0 / 10");
  assert.doesNotMatch(metricFitHTML(metric, "male"), /5\.0|10\/10|Mid-range/);
  const snapshot = JSON.stringify(metric);
  metricFit(metric, "male"); metricFitHTML(metric, "male"); metricModelScoreLabel(metric);
  assert.equal(JSON.stringify(metric), snapshot, "presentation never changes scores or measurements");
});

test("fit follows the selected reference and never the numeric model score", () => {
  const def = SIDE_METRICS.find(metric => metric.id === "nasolabialAngle")!;
  assert.equal(metricFit(reading(def, 99.3, "male", 2), "male").state, "within");
  assert.equal(metricFit(reading(def, 120, "male", 8), "male").state, "outside");
  assert.equal(metricFit(reading(def, 106, "female"), "female").state, "within");
  assert.equal(metricFit(reading(def, 106, "male"), "male").state, "outside");
});

test("one-sided thresholds do not invent a penalty beyond the cosmetic display edge", () => {
  const higher = METRICS.find(metric => metric.id === "canthalTilt")!;
  const higherDist = distFor(higher, "male");
  const inside = { ...reading(higher, higherDist.mean + higherDist.sd * 2), idealRange: [0, 1] as [number, number] };
  assert.equal(metricFit(inside, "male").label, "Meets model threshold");
  assert.equal(metricFit(reading(higher, higherDist.mean), "male").label, "Below model threshold");
  const lower = METRICS.find(metric => metric.id === "midlineDeviation")!;
  assert.equal(metricFit(reading(lower, 0), "male").label, "Meets model threshold");
  const lowerDist = distFor(lower, "male");
  assert.equal(metricFit(reading(lower, lowerDist.mean + lowerDist.sd), "male").label, "Above model threshold");
});

test("unavailable, excluded and low-repeatability readings never earn a fit badge or score", () => {
  const def = SIDE_METRICS.find(metric => metric.id === "nasolabialAngle")!;
  const excluded = { ...reading(def, 99.3), implausible: true };
  assert.equal(metricFit(excluded, "male").state, "excluded");
  assert.equal(metricModelScoreLabel(excluded), "Not scored");
  const missing = reading(def, Number.NaN);
  assert.equal(metricFit(missing, "male").label, "Not measured");
  assert.equal(metricModelScoreLabel(missing), "Not scored");
  const indicative = reading(METRICS.find(metric => metric.id === "fwhr")!, 2.2);
  assert.equal(metricFit(indicative, "male").state, "indicative");
  assert.equal(metricModelScoreLabel(indicative), "Not scored");
  assert.equal(metricFit({ ...reading(def, 99.3), conformance: Number.NaN }, "male").state, "unavailable");
});

test("detail and measurement rows share fit-first wording without changing aggregate scoring", () => {
  const detail = readFileSync(new URL("./metricDetail.ts", import.meta.url), "utf8");
  assert.match(detail, /fitChip\.textContent = fit\.label/);
  assert.match(detail, /score\.textContent = metricModelScoreLabel\(m\)/);
  assert.match(detail, /not a percentage of reference fit or a validated population rank/);
  assert.match(detail, /This profile reference is provisional/);
  assert.doesNotMatch(detail, /scoreTone\(m.score\)|metricScoreLabel\(m.score/);
  assert.doesNotMatch(detail, /statedPct|Modelled standing: above|reference distribution on this measurement/);
  const results = readFileSync(new URL("./results.ts", import.meta.url), "utf8");
  assert.ok((results.match(/metricFitHTML\(m,/g) ?? []).length >= 4);
});

test("inside and outside references explain fit without inventing population rank", () => {
  const def = SIDE_METRICS.find(metric => metric.id === "nasolabialAngle")!;
  for (const [value, state] of [[99.3, "Within"], [120, "Outside"]] as const) {
    const metric = { ...reading(def, value), percentile: 90, z: 0, zEff: 0 };
    const html = overviewHTML(metric, "male");
    assert.match(html, new RegExp(`${state} model reference range`));
    assert.match(html, /current reference, not overall attractiveness/);
    assert.match(html, /This profile reference is provisional/);
    assert.doesNotMatch(html, /above <b>|90%|population rank|Modelled standing/);
  }
});
