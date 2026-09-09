import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSide } from "./scoring.js";
import { computeSideMetrics, sidePointIntegrityIssues, type SidePoints } from "./sideMetrics.js";
import { metricScoreLabel } from "../ui/metricDetail.js";
import { regionSummary } from "../ui/templates.js";

const PROFILE: SidePoints = {
  trichion: { x: 300, y: 100 }, glabella: { x: 330, y: 190 },
  nasion: { x: 325, y: 210 }, pronasale: { x: 395, y: 265 },
  subnasale: { x: 355, y: 295 }, labialeSuperius: { x: 360, y: 320 },
  labialeInferius: { x: 358, y: 345 }, pogonion: { x: 350, y: 390 },
  menton: { x: 335, y: 410 }, gonion: { x: 215, y: 360 },
  condylion: { x: 205, y: 250 }, cervicale: { x: 240, y: 430 },
  tragion: { x: 200, y: 240 },
};

function withAngle(degrees: number): SidePoints {
  const jaw = PROFILE.gonion;
  const chin = PROFILE.menton;
  const bearing = Math.atan2(chin.y - jaw.y, chin.x - jaw.x) - degrees * Math.PI / 180;
  return { ...PROFILE, condylion: { x: jaw.x + 110 * Math.cos(bearing), y: jaw.y + 110 * Math.sin(bearing) } };
}

function transformed(points: SidePoints, scale: number, direction: number): SidePoints {
  return Object.fromEntries(Object.entries(points).map(([id, point]) => [id, {
    x: scale * (direction === 1 ? point.x : 800 - point.x), y: scale * point.y,
  }])) as SidePoints;
}

test("known 117 and 127 degree constructions retain their angles under mirroring and resizing", () => {
  for (const angle of [117, 127]) for (const direction of [-1, 1]) for (const scale of [0.1, 1, 10]) {
    const points = transformed(withAngle(angle), scale, direction);
    assert.deepEqual(sidePointIntegrityIssues(points), []);
    assert.ok(Math.abs(computeSideMetrics(points, direction).gonialAngle - angle) < 1e-9);
  }
});

test("coincident and near-coincident jaw rays cannot become plausible scored angles", () => {
  for (const ray of ["menton", "condylion"] as const) for (const offset of [0, 1e-8]) {
    const jaw = PROFILE.gonion;
    const faceHeight = Math.hypot(PROFILE.nasion.x - PROFILE.menton.x, PROFILE.nasion.y - PROFILE.menton.y);
    const points = { ...PROFILE, [ray]: { x: jaw.x + faceHeight * offset, y: jaw.y - faceHeight * offset } };
    for (const direction of [-1, 1]) for (const scale of [0.1, 1, 10]) {
      const resized = transformed(points, scale, direction);
      assert.ok(sidePointIntegrityIssues(resized).some((issue) => /Jaw corner and .* overlap/.test(issue)));
      assert.throws(() => analyzeSide(resized, direction, "male"), /Profile landmarks need correction/);
    }
  }
  assert.throws(() => analyzeSide({ ...PROFILE, gonion: PROFILE.menton }, 1, "male"), /Jaw corner and chin bottom overlap/);
});

test("missing and non-finite jaw points remain unavailable instead of receiving a score", () => {
  for (const value of [undefined, { x: Number.NaN, y: 360 }, { x: 215, y: Infinity }]) {
    assert.throws(() => analyzeSide({ ...PROFILE, gonion: value } as SidePoints, 1, "male"), /Jaw corner is missing/);
  }
});

test("the existing scale calls 117 and 127 degrees balanced and does not mistake 117 for a jaw weakness", () => {
  // These are regression observations of the current mapping, not validation
  // of its population reference or a target fitted to another product.
  for (const sex of ["male", "female"] as const) for (const angle of [117, 127]) {
    const report = analyzeSide(withAngle(angle), 1, sex);
    const metric = report.metrics.find((item) => item.def.id === "gonialAngle")!;
    assert.equal(metricScoreLabel(metric.score, metric.def.name), "Balanced gonial angle");
    if (angle === 117) {
      assert.ok(metric.conformance >= 0.999);
      assert.ok(metric.zEff > 0);
      const summary = regionSummary(report.regions.find((region) => region.region === "jaw")!, sex);
      assert.doesNotMatch(summary, /The one to go at is your gonial angle/);
    }
  }
});
