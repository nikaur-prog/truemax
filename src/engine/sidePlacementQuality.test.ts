import assert from "node:assert/strict";
import test from "node:test";
import { classifySidePlacement, type PlausibilityReading } from "./sidePlacementQuality.js";

function reading(value: number, plausible: [number, number]): PlausibilityReading {
  return { value, implausible: true, def: { plausible } };
}

test("a single tiny boundary miss is marginal rather than a failed placement", () => {
  const result = classifySidePlacement([reading(-16.1, [-15, 40])]);
  assert.equal(result.hard.length, 0);
  assert.equal(result.marginal.length, 1);
});

test("a material miss still stops the placement", () => {
  const result = classifySidePlacement([reading(-18, [-15, 40])]);
  assert.equal(result.hard.length, 1);
  assert.equal(result.marginal.length, 0);
});

test("two small misses indicate a bad placement rather than two exceptions", () => {
  const result = classifySidePlacement([
    reading(-16, [-15, 40]),
    reading(93, [95, 170]),
  ]);
  assert.equal(result.hard.length, 2);
  assert.equal(result.marginal.length, 0);
});

test("a non-finite reading can never pass as marginal", () => {
  const result = classifySidePlacement([reading(Number.NaN, [-15, 40])]);
  assert.equal(result.hard.length, 1);
});
