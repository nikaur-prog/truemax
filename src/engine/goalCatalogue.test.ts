import test from "node:test";
import assert from "node:assert/strict";
import { GOALS } from "./goals.js";
import { canShowProgress } from "./goalEvidence.js";
import {
  ADULT_ONLY_LAYERS,
  CONSISTENCY_POINTS_PER_WEEK,
  EVIDENCE_WORDING,
  GOAL_CATALOGUE,
  GOAL_CATALOGUE_VERSION,
  RENDER_LAYERS,
  VERIFIED_PROGRESS_POINTS,
  allowedLayers,
  catalogueCoversGoals,
  goalEffect,
  specAllowed,
} from "./goalCatalogue.js";

test("every goal has one entry and every entry is a goal", () => {
  assert.ok(catalogueCoversGoals());
  assert.equal(new Set(GOAL_CATALOGUE.map((g) => g.id)).size, GOALS.length);
  assert.match(GOAL_CATALOGUE_VERSION, /^catalogue-\d+$/);
});

test("a goal never promises a measurement that cannot show progress", () => {
  for (const g of GOAL_CATALOGUE) {
    for (const id of g.measures) assert.ok(canShowProgress(id), `${g.id} promises ${id}`);
  }
  // The goals the scan does not measure say so and carry no measurement.
  for (const id of ["hair", "skin", "teeth", "muscle"]) {
    const g = goalEffect(id)!;
    assert.equal(g.measures.length, 0, id);
    assert.equal(g.movement.high, 0, id);
    assert.equal(g.completion.minDeltaSd, 0, id);
  }
});

test("every layer named is a render layer, and body composition is adult only", () => {
  for (const g of GOAL_CATALOGUE) {
    for (const layer of [...g.layers, ...g.minors.layers]) assert.ok(RENDER_LAYERS.includes(layer), `${g.id}: ${layer}`);
    for (const layer of g.minors.layers) assert.ok(g.layers.includes(layer), `${g.id}: a minor may not render what an adult may not`);
    for (const layer of ADULT_ONLY_LAYERS) assert.ok(!g.minors.layers.includes(layer), `${g.id}: ${layer} rendered for a minor`);
  }
  assert.equal(goalEffect("bodyfat")!.minors.offered, false);
  assert.deepEqual(allowedLayers(["bodyfat", "debloat"], false), []);
  assert.ok(allowedLayers(["bodyfat"], true).includes("leanerPresentation"));
});

test("ranges are ranges, conservative, and the weeks are ordered", () => {
  for (const g of GOAL_CATALOGUE) {
    assert.ok(g.movement.low <= g.movement.high && g.movement.high <= 0.6, g.id);
    assert.ok(g.weeks.low >= 1 && g.weeks.low <= g.weeks.high, g.id);
    assert.ok(g.completion.holdOf3 <= 3, g.id);
    assert.ok([1, 2, 3].includes(g.points.effort), g.id);
    assert.ok(g.note.length > 20 && !g.note.includes("—"), `${g.id} note`);
    for (const word of ["attractive", "handsome", "beautiful", "will look"]) assert.ok(!g.note.toLowerCase().includes(word), `${g.id}: ${word}`);
  }
});

test("points pay for showing up and for verified movement, never for the size of a change", () => {
  assert.ok(CONSISTENCY_POINTS_PER_WEEK[3] > CONSISTENCY_POINTS_PER_WEEK[1]);
  assert.ok(CONSISTENCY_POINTS_PER_WEEK[3] <= 2 * CONSISTENCY_POINTS_PER_WEEK[1], "mild scaling only");
  assert.equal(typeof VERIFIED_PROGRESS_POINTS, "number");
  // No entry carries its own progress award: the award is flat by construction.
  for (const g of GOAL_CATALOGUE) assert.ok(!("progressPoints" in g.points));
});

test("a spec is allowed only when the catalogue permits every part of it", () => {
  const version = GOAL_CATALOGUE_VERSION;
  assert.deepEqual(specAllowed({ goalIds: ["grooming", "eyes"], layers: ["brows", "hair"], catalogueVersion: version }, true), { ok: true });
  assert.equal(specAllowed({ goalIds: ["grooming"], layers: ["leanerPresentation"], catalogueVersion: version }, true).ok, false);
  assert.equal(specAllowed({ goalIds: ["bodyfat"], layers: ["leanerPresentation"], catalogueVersion: version }, false).ok, false, "not offered under 18");
  assert.equal(specAllowed({ goalIds: ["bodyfat"], layers: ["leanerPresentation"], catalogueVersion: version }, true).ok, true);
  assert.equal(specAllowed({ goalIds: ["nosejob"], layers: [], catalogueVersion: version }, true).ok, false);
  assert.equal(specAllowed({ goalIds: [], layers: [], catalogueVersion: version }, true).ok, false);
  assert.equal(specAllowed({ goalIds: ["grooming"], layers: [], catalogueVersion: "catalogue-0" }, true).ok, false);
});

test("the wording an evidence grade permits is a hedge, never a promise", () => {
  for (const w of Object.values(EVIDENCE_WORDING)) assert.ok(!/will|guarantee/i.test(w), w);
});
