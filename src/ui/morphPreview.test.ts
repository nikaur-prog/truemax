import assert from "node:assert/strict";
import test from "node:test";
import { buildMorphBlueprint } from "../engine/morphPlan.js";
import { EMPTY_PROFILE } from "../engine/goals.js";
import { morphPreviewHTML } from "./morphPreview.js";
import type { Report } from "../engine/types.js";

const report: Report = {
  sex: "female",
  overall: 5,
  overallPercentile: 50,
  overallZ: 0,
  potential: 6,
  pillars: { Harmony: 5, Angularity: 5, Dimorphism: 5, Features: 5 },
  regions: [],
  metrics: [],
  zScores: {},
};

test("the plan preview distinguishes selected goals from Max's full view", () => {
  const profile = { ...EMPTY_PROFILE, goals: ["skin", "photos"] };
  const html = morphPreviewHTML({
    selected: buildMorphBlueprint(report, profile, "selected", true),
    maxVision: buildMorphBlueprint(report, profile, "max_vision", true),
    renderEnabled: false,
  });
  assert.match(html, /My goals/);
  assert.match(html, /Max's full view/);
  assert.match(html, />Front</);
  assert.match(html, />Profile</);
  assert.match(html, /Identity and bone structure stay fixed/);
  assert.doesNotMatch(html, /Create my visual target/);
  assert.doesNotMatch(html, /—/);
});

test("the render action appears only behind its rollout gate", () => {
  const profile = { ...EMPTY_PROFILE, goals: ["skin"] };
  const selected = buildMorphBlueprint(report, profile, "selected", false);
  const maxVision = buildMorphBlueprint(report, profile, "max_vision", false);
  assert.match(morphPreviewHTML({ selected, maxVision, renderEnabled: true }), /Create my visual target/);
  assert.doesNotMatch(morphPreviewHTML({ selected, maxVision, renderEnabled: true }), />Profile</);
});
