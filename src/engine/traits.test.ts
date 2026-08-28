import test from "node:test";
import assert from "node:assert/strict";
import { eyeShapeFrom } from "./traits.js";
import type { ScoredMetric } from "./types.js";

// Only the fields the classifier reads: id, value, z.
function metric(id: string, value: number, z = 0): ScoredMetric {
  return { def: { id }, value, z } as unknown as ScoredMetric;
}

test("strong positive tilt with a narrow aperture classifies as hunter", () => {
  const shape = eyeShapeFrom([metric("canthalTilt", 8), metric("eyeAspectRatio", 0.3, -0.4)]);
  assert.equal(shape?.id, "hunter");
  assert.equal(shape?.label, "hunter eyes");
});

test("moderate tilt with an even aperture classifies as almond", () => {
  const shape = eyeShapeFrom([metric("canthalTilt", 3.5), metric("eyeAspectRatio", 0.3, 0)]);
  assert.equal(shape?.id, "almond");
});

test("open aperture reads round regardless of a small tilt", () => {
  const shape = eyeShapeFrom([metric("canthalTilt", 0.5), metric("eyeAspectRatio", 0.4, 1.2)]);
  assert.equal(shape?.id, "round");
});

test("negative tilt classifies as downturned", () => {
  const shape = eyeShapeFrom([metric("canthalTilt", -3)]);
  assert.equal(shape?.id, "downturned");
});

test("a missing or unmeasured tilt returns null rather than a guess", () => {
  assert.equal(eyeShapeFrom([]), null);
  assert.equal(eyeShapeFrom([metric("canthalTilt", Number.NaN)]), null);
});

test("labels are voice-ready: lower case, no figures", () => {
  for (const tilt of [8, 3.5, 0.5, -3]) {
    const shape = eyeShapeFrom([metric("canthalTilt", tilt)]);
    assert.ok(shape);
    assert.match(shape.label, /^[a-z]/);
    assert.doesNotMatch(shape.label, /\d/);
  }
});
