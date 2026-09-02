import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MEASUREMENT_LANDMARKS } from "./quickVideoExport.js";

test("the breakdown scan uses a sparse, stable set of semantic anchors", () => {
  assert.ok(MEASUREMENT_LANDMARKS.length >= 30);
  assert.ok(MEASUREMENT_LANDMARKS.length <= 40);
  assert.equal(new Set(MEASUREMENT_LANDMARKS).size, MEASUREMENT_LANDMARKS.length);

  // Forehead, pupils, nasal base, lip corners, cheek width and chin are all
  // represented. These are the anchors a viewer can recognise as deliberate.
  for (const index of [10, 468, 473, 98, 327, 61, 291, 234, 454, 152]) {
    assert.ok(MEASUREMENT_LANDMARKS.includes(index as (typeof MEASUREMENT_LANDMARKS)[number]), String(index));
  }
});

test("the old every-other-vertex white-dot cloud cannot return", () => {
  const source = readFileSync(new URL("./quickVideoExport.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /for \(let i = 0; i < landmarks\.length; i \+= 2\)/);
  assert.doesNotMatch(source, /rgba\(255,255,255,0\.62\)/);
  assert.match(source, /for \(const index of MEASUREMENT_LANDMARKS\)/);
});
