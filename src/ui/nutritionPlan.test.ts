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
  const html = nutritionPlanHTML(reportWith([]), { dietAdvice: false, maxAccess: true, adult: true });
  assert.match(html, /switched off at your request/);
  assert.doesNotMatch(html, /PROTEIN/);
  assert.doesNotMatch(html, /part of Max/);
});

test("without Max the method is withheld and named as paid, measurements untouched", () => {
  const html = nutritionPlanHTML(reportWith([]), { dietAdvice: true, maxAccess: false, adult: true });
  assert.match(html, /part of Max/);
  assert.doesNotMatch(html, /1\.6 g per kg/);
});

test("Max plan prints the four daily targets and the disclaimer", () => {
  const html = nutritionPlanHTML(reportWith([]), { dietAdvice: true, maxAccess: true, adult: true });
  for (const name of ["PROTEIN", "SODIUM", "ALCOHOL", "WATER"]) assert.match(html, new RegExp(name));
  assert.match(html, /not medical advice/);
  assert.match(html, /SKIN/);
});

test("signal cards fire only when the measurement sits under the reference", () => {
  const low = nutritionPlanHTML(reportWith([metric("jawCheekRatio", -0.8)]), { dietAdvice: true, maxAccess: true, adult: true });
  assert.match(low, /WATER RETENTION/);
  const fine = nutritionPlanHTML(reportWith([metric("jawCheekRatio", 1.2)]), { dietAdvice: true, maxAccess: true, adult: true });
  assert.doesNotMatch(fine, /WATER RETENTION/);
});

test("an unmeasured metric never produces a card", () => {
  const html = nutritionPlanHTML(reportWith([metric("eyeAspectRatio", -1, Number.NaN)]), { dietAdvice: true, maxAccess: true, adult: true });
  assert.doesNotMatch(html, /PERIORBITAL/);
});

test("the section speaks plainly: no em dashes anywhere in its output", () => {
  for (const opts of [
    { dietAdvice: false, maxAccess: true, adult: true },
    { dietAdvice: true, maxAccess: false, adult: true },
    { dietAdvice: true, maxAccess: true, adult: true },
  ]) {
    const html = nutritionPlanHTML(
      reportWith([metric("gonialProxy", -1), metric("jawCheekRatio", -1), metric("eyeAspectRatio", -1)]),
      opts,
    );
    assert.ok(!html.includes("—"), `em dash in output for ${JSON.stringify(opts)}`);
  }
});

// ---------------------------------------------------------------------------
// The age gate.
//
// Found in review, and it was the worst kind of miss: the macro calculator
// directly BELOW this panel runs a four-gate check with the age taken from a
// date of birth, and this panel sat above it printing a daily calorie deficit
// to anybody holding the Max tier. A careful gate beside an ungated surface
// saying the same thing is worse than neither, because the gate implies the
// surface is covered.
// ---------------------------------------------------------------------------

const composition = () => reportWith([metric("gonialProxy", -1.2)]);

test("no nutrition surface states an energy figure without the adult gate", () => {
  // The load-bearing one. Written against the numbers rather than against one
  // sentence, so a reworded deficit line cannot walk past it.
  const html = nutritionPlanHTML(composition(), { dietAdvice: true, maxAccess: true, adult: false });
  assert.doesNotMatch(html, /\bkcal\b/i, html.slice(0, 400));
  assert.doesNotMatch(html, /calorie/i);
  assert.doesNotMatch(html, /\bdeficit\b/i);
});

test("an adult on Max still gets the number", () => {
  // The other side of the same rule, so the gate cannot be tightened into
  // uselessness without this failing.
  const html = nutritionPlanHTML(composition(), { dietAdvice: true, maxAccess: true, adult: true });
  assert.match(html, /300 to 500 kcal per day/);
});

test("the gate withholds the target, never the measurement", () => {
  // The line this product draws everywhere: what is measured is yours, what is
  // prescribed has a gate. A minor still learns what the reading is, what it is
  // compared against, and what actually moves it.
  const html = nutritionPlanHTML(composition(), { dietAdvice: true, maxAccess: true, adult: false });
  assert.match(html, /BODY COMPOSITION/);
  assert.match(html, /measures/);
  assert.match(html, /average of/);
  assert.match(html, /follows total body fat/);
});

test("the age gate closes by default, like every other 18+ surface", () => {
  // adultUser defaults to false and a profile that never loads must behave like
  // a minor. Passing the flag through unchanged is what makes that hold here.
  for (const adult of [false, undefined as unknown as boolean]) {
    const html = nutritionPlanHTML(composition(), { dietAdvice: true, maxAccess: true, adult });
    assert.doesNotMatch(html, /\bkcal\b/i, `adult=${String(adult)}`);
  }
});

test("muting diet advice still outranks the age gate", () => {
  // Two different reasons to withhold, and the person's own choice is the one
  // that should be named. A minor who also muted diet advice is told about the
  // mute, not about their age.
  const html = nutritionPlanHTML(composition(), { dietAdvice: false, maxAccess: true, adult: false });
  assert.match(html, /switched off at your request/);
  assert.doesNotMatch(html, /18\+/);
});
