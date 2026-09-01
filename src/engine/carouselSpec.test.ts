import assert from "node:assert/strict";
import test from "node:test";
import {
  CAROUSEL_THEMES,
  carouselLevelLabel,
  carouselOverlayCopy,
  carouselProviderPrompt,
  parseCarouselGeneration,
} from "./carouselSpec.js";

test("carousel themes have five unique levels and honest notes", () => {
  assert.equal(new Set(CAROUSEL_THEMES.map((theme) => theme.id)).size, CAROUSEL_THEMES.length);
  for (const theme of CAROUSEL_THEMES) {
    assert.equal(theme.levels.length, 5);
    assert.equal(new Set(theme.levels).size, 5);
    assert.ok(theme.note.length > 10);
  }
});

test("overlay copy is deterministic and rejects invalid positions", () => {
  assert.deepEqual(carouselOverlayCopy("puffiness", 4, 2, 5), {
    position: "2 / 5",
    themeTitle: "FACIAL PUFFINESS",
    levelLabel: "LEAN",
    note: "A VISIBLE PRESENTATION SCALE, NOT A DIAGNOSIS.",
    brand: "TRUEMAX.APP",
  });
  assert.equal(carouselOverlayCopy("puffiness", 0, 1, 5), null);
  assert.equal(carouselOverlayCopy("puffiness", 2, 6, 5), null);
  assert.equal(carouselOverlayCopy("unknown", 2, 1, 5), null);
});

test("testosterone concept never becomes a hormone reading", () => {
  const prompt = carouselProviderPrompt({
    theme: "testosterone-concept",
    position: 5,
    level: 5,
    total: 5,
    sourceMode: "synthetic",
    description: "Adult man with short dark hair",
  });
  assert.match(prompt, /visual concept/i);
  assert.match(prompt, /not infer.*hormones/i);
  assert.doesNotMatch(carouselLevelLabel("testosterone-concept", 5), /testosterone/i);
});

test("morph prompt preserves identity and includes only the requested direction", () => {
  const prompt = carouselProviderPrompt({
    theme: "puffiness",
    position: 2,
    level: 2,
    total: 5,
    sourceMode: "morph",
    description: "this description must not re-describe the source",
    instruction: "Slightly reduce the cheek puffiness",
  });
  assert.match(prompt, /Preserve the person's recognisable identity/);
  assert.match(prompt, /Slightly reduce the cheek puffiness/);
  assert.doesNotMatch(prompt, /this description must not re-describe/);
});

test("request parser rejects coercion, oversized runs and missing morph photos", () => {
  for (const level of ["2", null, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = parseCarouselGeneration({
      theme: "puffiness", position: 2, level, total: 5, sourceMode: "synthetic", description: "Adult subject",
    });
    assert.equal(result.ok, false);
  }
  assert.equal(parseCarouselGeneration({
    theme: "puffiness", position: 2, level: 2, total: 8, sourceMode: "synthetic", description: "Adult subject",
  }).ok, false);
  assert.equal(parseCarouselGeneration({
    theme: "puffiness", position: 2, level: 2, total: 5, sourceMode: "morph", description: "",
  }).ok, false);
  assert.equal(parseCarouselGeneration({
    theme: "puffiness", position: 6, level: 2, total: 5, sourceMode: "synthetic", description: "Adult subject",
  }).ok, false);
});

test("control characters are removed before prompt construction", () => {
  const result = parseCarouselGeneration({
    theme: "skin-quality",
    position: 3,
    level: 3,
    total: 5,
    sourceMode: "synthetic",
    description: "Adult\u0000subject\nwith calm expression",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.spec.description, "Adult subject with calm expression");
});

test("slide position and visual band remain independent", () => {
  const result = parseCarouselGeneration({
    theme: "jaw-width",
    position: 2,
    level: 5,
    total: 2,
    sourceMode: "synthetic",
    description: "Fictional adult subject",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const prompt = carouselProviderPrompt(result.value.spec);
  assert.match(prompt, /slide 2 of 2/);
  assert.match(prompt, /Requested visual band: VERY WIDE/);
});
