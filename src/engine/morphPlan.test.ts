import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_PROFILE, type Profile } from "./goals.js";
import { METRICS } from "./metrics.js";
import { buildMorphBlueprint, MORPH_GOAL_RULES } from "./morphPlan.js";
import type { Report, ScoredMetric } from "./types.js";

function metric(id: string, value: number, conformance = 0.2): ScoredMetric {
  const def = METRICS.find((candidate) => candidate.id === id);
  assert.ok(def);
  return {
    def,
    value,
    z: -1,
    zEff: -1,
    percentile: 15.9,
    markerPct: 15.9,
    score: 3.8,
    conformance,
    idealRange: [value + 1, value + 2],
  };
}

function report(metrics: ScoredMetric[]): Report {
  return {
    sex: "male",
    overall: 5,
    overallPercentile: 50,
    overallZ: 0,
    potential: 6,
    pillars: { Harmony: 5, Angularity: 5, Dimorphism: 5, Features: 5 },
    regions: [],
    metrics,
    zScores: {},
  };
}

function profile(goals: string[], quiet: Profile["quiet"] = []): Profile {
  return { ...EMPTY_PROFILE, goals, quiet, advice: { ...EMPTY_PROFILE.advice } };
}

test("selected previews contain only goals the member selected", () => {
  const plan = buildMorphBlueprint(report([metric("jawCheekRatio", 0.5)]), profile(["bodyfat"]), "selected", true);
  assert.deepEqual(plan.goals.map((goal) => goal.id), ["bodyfat"]);
  assert.ok(plan.effects.facialFullness < 0);
  assert.ok(plan.effects.jawDefinition > 0);
});

test("targets close only the declared non-surgical share of a gap", () => {
  const reading = metric("jawCheekRatio", 0.5);
  const plan = buildMorphBlueprint(report([reading]), profile(["bodyfat"]), "selected", true);
  const target = plan.targets.find((candidate) => candidate.id === reading.def.id);
  assert.ok(target);
  assert.ok(target.target > reading.value);
  assert.ok(target.target < reading.idealRange[0]);
  assert.ok(target.completionDelta > 0);
});

test("bone and noisy readings never become completion targets", () => {
  const plan = buildMorphBlueprint(
    report([metric("jawFrontalAngle", 100), metric("fwhr", 1.6)]),
    profile(["jaw", "bodyfat"]),
    "selected",
    true,
  );
  assert.deepEqual(plan.targets, []);
});

test("the full vision suggests measured gaps and respects quiet regions", () => {
  const r = report([metric("jawCheekRatio", 0.5)]);
  const open = buildMorphBlueprint(r, profile([]), "max_vision", true);
  assert.ok(open.goals.some((goal) => goal.id === "bodyfat"));
  const quiet = buildMorphBlueprint(r, profile([], ["jaw", "midface", "chin"]), "max_vision", true);
  assert.equal(quiet.goals.some((goal) => goal.id === "bodyfat"), false);
});

test("profile effects are withheld when no side photo exists", () => {
  const plan = buildMorphBlueprint(report([]), profile(["grooming"]), "selected", false);
  assert.deepEqual(plan.goals[0]?.views, ["front"]);
  assert.equal(plan.hasSide, false);
});

test("goal rules cannot ask a renderer to redesign identity or bone", () => {
  const forbidden = /bone|noseSize|eyeSize|lipSize|skinTone|age/i;
  for (const rule of Object.values(MORPH_GOAL_RULES)) {
    assert.doesNotMatch(Object.keys(rule.effects).join(" "), forbidden, rule.id);
    assert.ok(rule.effortPoints >= 0 && rule.effortPoints <= 100, rule.id);
    assert.doesNotMatch(`${rule.timeframe} ${rule.visualSummary}`, /—/, rule.id);
  }
});

