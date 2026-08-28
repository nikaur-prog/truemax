import { test } from "node:test";
import assert from "node:assert/strict";
import { nutritionPlanHTML } from "./nutritionPlan.js";
import type { Report, ScoredMetric } from "../engine/types.js";
import { METRICS } from "../engine/metrics.js";

// A minimal report carrying only what the nutrition section reads: sex and
// the metrics list. Values are set near each metric's female mean so zEff
// decides whether a card fires, exactly as it does in the plan.
function metric(id: string, zEff: number, value = 1): ScoredMetric {
  const def = METRICS.find((m) => m.id === id);
  assert.ok(def, `metric ${id} exists`);
  return { def, value, zEff, score: 5, percentile: 50, conformance: 0.5, idealRange: [0, 1] } as ScoredMetric;
}

function reportWith(metrics: ScoredMetric[]): Report {
  return { sex: "male", overall: 5, overallPercentile: 50, overallZ: 0, potential: 6, pillars: {}, regions: [], metrics, zScores: {} } as unknown as Report;
}

test("muted diet channel gets the acknowledgement and no protocol", () => {
  const html = nutritionPlanHTML(reportWith([]), { dietAdvice: false, maxAccess: true });
  assert.match(html, /switched off at your request/);
  assert.doesNotMatch(html, /PROTEIN/);
  assert.doesNotMatch(html, /part of Max/);
});

test("without Max the method is withheld and named as paid, measurements untouched", () => {
  const html = nutritionPlanHTML(reportWith([]), { dietAdvice: true, maxAccess: false });
  assert.match(html, /part of Max/);
  assert.doesNotMatch(html, /1\.6 g per kg/);
});

test("Max plan prints the four daily targets and the disclaimer", () => {
  const html = nutritionPlanHTML(reportWith([]), { dietAdvice: true, maxAccess: true });
  for (const name of ["PROTEIN", "SODIUM", "ALCOHOL", "WATER"]) assert.match(html, new RegExp(name));
  assert.match(html, /not medical advice/);
  assert.match(html, /SKIN/);
});

test("signal cards fire only when the measurement sits under the reference", () => {
  const low = nutritionPlanHTML(reportWith([metric("jawCheekRatio", -0.8)]), { dietAdvice: true, maxAccess: true });
  assert.match(low, /WATER RETENTION/);
  const fine = nutritionPlanHTML(reportWith([metric("jawCheekRatio", 1.2)]), { dietAdvice: true, maxAccess: true });
  assert.doesNotMatch(fine, /WATER RETENTION/);
});

test("an unmeasured metric never produces a card", () => {
  const html = nutritionPlanHTML(reportWith([metric("eyeAspectRatio", -1, Number.NaN)]), { dietAdvice: true, maxAccess: true });
  assert.doesNotMatch(html, /PERIORBITAL/);
});

test("the section speaks plainly: no em dashes anywhere in its output", () => {
  for (const opts of [
    { dietAdvice: false, maxAccess: true },
    { dietAdvice: true, maxAccess: false },
    { dietAdvice: true, maxAccess: true },
  ]) {
    const html = nutritionPlanHTML(
      reportWith([metric("gonialProxy", -1), metric("jawCheekRatio", -1), metric("eyeAspectRatio", -1)]),
      opts,
    );
    assert.ok(!html.includes("—"), `em dash in output for ${JSON.stringify(opts)}`);
  }
});
