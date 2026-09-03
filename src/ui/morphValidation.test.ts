import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { MorphMetricTarget } from "../engine/morphPlan.js";
import type { Report } from "../engine/types.js";
import { identityLandmarkDistance, targetsMoveAsSpecified } from "./morphValidation.js";

const points = Array.from({ length: 478 }, (_, index) => ({
  x: 0.2 + (index % 19) * 0.02,
  y: 0.2 + (index % 23) * 0.015,
  z: 0,
  visibility: 1,
})) as NormalizedLandmark[];
points[33] = { x: 0.35, y: 0.4, z: 0, visibility: 1 };
points[263] = { x: 0.65, y: 0.4, z: 0, visibility: 1 };

test("identity distance is invariant to translation and scale", () => {
  const moved = points.map((point) => ({ x: point.x * 0.8 + 0.1, y: point.y * 0.8 + 0.05, z: 0 })) as NormalizedLandmark[];
  const distance = identityLandmarkDistance(points, moved);
  assert.ok(distance);
  assert.ok(distance.median < 1e-8);
  assert.ok(distance.p90 < 1e-8);
});

const target: MorphMetricTarget = {
  id: "midfaceRatio",
  name: "Midface ratio",
  view: "front",
  current: 1,
  target: 0.9,
  decimals: 2,
  unit: "",
  completionDelta: 0.05,
  goalIds: ["debloat"],
};

function report(value: number): Report {
  return {
    sex: "male",
    overall: 5,
    overallPercentile: 50,
    overallZ: 0,
    potential: 5,
    pillars: { Harmony: 5, Angularity: 5, Dimorphism: 5, Features: 5 },
    regions: [],
    metrics: [{
      def: {
        id: "midfaceRatio", name: "Midface ratio", unit: "", decimals: 2, view: "front",
        region: "midface", pillar: "Harmony", weight: 1, direction: "band", fixability: 0.5,
        dist: { male: { mean: 1, sd: 0.1 }, female: { mean: 1, sd: 0.1 } },
      },
      value, z: 0, zEff: 0, percentile: 50, markerPct: 50, score: 5, conformance: 0.5, idealRange: [0.9, 1.1],
    }],
    zScores: {},
  };
}

test("target validation accepts bounded progress and rejects reversal or overshoot", () => {
  assert.equal(targetsMoveAsSpecified([target], report(0.95)), true);
  assert.equal(targetsMoveAsSpecified([target], report(1.02)), false);
  assert.equal(targetsMoveAsSpecified([target], report(0.8)), false);
});
