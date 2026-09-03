import test from "node:test";
import assert from "node:assert/strict";
import { bodyEntryToMetric } from "./bodyProfileDialog.js";

test("metric body entry keeps canonical centimetres and kilograms", () => {
  assert.deepEqual(bodyEntryToMetric({ unit: "metric", heightCm: 181.2, weightKg: 83.4 }), {
    heightCm: 181.2,
    weightKg: 83.4,
  });
});

test("imperial body entry converts to canonical centimetres and kilograms", () => {
  assert.deepEqual(bodyEntryToMetric({ unit: "imperial", feet: 6, inches: 1, pounds: 180 }), {
    heightCm: 185.4,
    weightKg: 81.6,
  });
});

test("body entry rejects non-finite values before storage", () => {
  assert.equal(bodyEntryToMetric({ unit: "imperial", feet: Number.NaN, inches: 2, pounds: 180 }), null);
});
