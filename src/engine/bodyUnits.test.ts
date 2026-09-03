import test from "node:test";
import assert from "node:assert/strict";
import { BODY_BOUNDS, bodyMetricUsable, boundsSentence, toImperial, toMetric } from "./bodyUnits.js";
import { bodyInputIsUsable } from "./macros.js";

test("metric and imperial entries of the same body agree to a tenth", () => {
  const metric = toMetric({ unit: "metric", heightCm: 180.3, weightKg: 77.1 });
  const imperial = toMetric({ unit: "imperial", feet: 5, inches: 11, pounds: 170 });
  assert.ok(metric && imperial);
  assert.ok(Math.abs(metric!.heightCm - imperial!.heightCm) < 0.2, `${metric!.heightCm} vs ${imperial!.heightCm}`);
  assert.ok(Math.abs(metric!.weightKg - imperial!.weightKg) < 0.2, `${metric!.weightKg} vs ${imperial!.weightKg}`);
  // Round trip through display units lands on the same canonical value.
  const back = toMetric({ unit: "imperial", ...toImperial(metric!) });
  assert.ok(Math.abs(back!.heightCm - metric!.heightCm) < 0.15);
  assert.ok(Math.abs(back!.weightKg - metric!.weightKg) < 0.15);
});

test("a missing or non-numeric field is null, never a guess", () => {
  assert.equal(toMetric({ unit: "metric", heightCm: Number.NaN, weightKg: 70 }), null);
  assert.equal(toMetric({ unit: "imperial", feet: undefined, pounds: 150 }), null);
  assert.equal(toMetric({ unit: "metric" }), null);
});

test("the bounds are the calculator's bounds and the database's bounds", () => {
  assert.equal(BODY_BOUNDS.heightCm.min, 120);
  assert.equal(BODY_BOUNDS.heightCm.max, 230);
  assert.equal(BODY_BOUNDS.weightKg.min, 35);
  assert.equal(BODY_BOUNDS.weightKg.max, 300);
  for (const [h, w, ok] of [[175, 70, true], [119.9, 70, false], [230, 300, true], [230.1, 70, false], [175, 34.9, false], [175, 300.1, false]] as const) {
    assert.equal(bodyMetricUsable({ heightCm: h, weightKg: w }), ok, `${h} ${w}`);
    assert.equal(bodyInputIsUsable({ age: 30, sex: "male", heightCm: h, weightKg: w, activity: "moderate", goal: "hold" }), ok, `calculator ${h} ${w}`);
  }
  assert.equal(bodyMetricUsable(null), false);
});

test("the bounds sentence names the units on screen and carries no em dash", () => {
  assert.match(boundsSentence("metric"), /120 to 230 cm/);
  assert.match(boundsSentence("imperial"), /3 ft 11 in to 7 ft 7 in/);
  assert.match(boundsSentence("imperial"), /77 to 661 lb/);
  for (const u of ["metric", "imperial"] as const) assert.doesNotMatch(boundsSentence(u), /—/);
});
