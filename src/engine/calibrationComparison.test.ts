import test from "node:test";
import assert from "node:assert/strict";
import { calibrationCaptureScores, calibrationScoreComparison, calibrationScoreViewLabel } from "./calibrationComparison.js";
import { analyzeSide, mergeReports, scoreFrontMeasurements } from "./scoring.js";
import { METRICS, distFor } from "./metrics.js";
import type { SidePoints } from "./sideMetrics.js";
import { corpusJSON, calibrationDiagnosticsJSON, splitByProvenance } from "./calibrationSet.js";
import type { RatedFace } from "./calibrationSet.js";
import type { Sex } from "./types.js";

const face = (overrides: Partial<RatedFace> = {}): RatedFace => ({
  id: "m1", sex: "male", rating: 6.2, ratedBy: "self", scored: 6.7,
  ratingTarget: "combined", captureScores: { front: 6.7, side: 4.2, combined: 6.0 },
  measurements: { fwhr: 2.1, gonialAngle: 125.8 }, ...overrides,
});

test("paired comparison uses the combined number without overwriting legacy front score", () => {
  const saved = face();
  const comparison = calibrationScoreComparison(saved);
  assert.equal(comparison.score, 6);
  assert.equal(comparison.view, "combined");
  assert.ok(Math.abs(comparison.difference! + 0.2) < 1e-9);
  assert.equal(saved.scored, 6.7);
});

test("external overall is compared as context, not presented as a matched geometry target", () => {
  const comparison = calibrationScoreComparison(face({ ratedBy: "external", ratingTarget: "external-overall" }));
  assert.equal(comparison.view, "combined");
  assert.equal(comparison.score, 6);
  assert.equal(comparison.sameScope, false);
});

test("front and side ratings select only their matching view, including a zero", () => {
  for (const [target, score] of [["front", 6.7], ["side", 4.2]] as const) {
    const comparison = calibrationScoreComparison(face({ ratingTarget: target }));
    assert.equal(comparison.view, target);
    assert.equal(comparison.score, score);
    assert.equal(comparison.sameScope, true);
  }
  assert.equal(calibrationScoreComparison(face({ ratingTarget: "side", captureScores: { side: 0 } })).score, 0);
});

test("legacy scope is never guessed from measurements or a score that looks like the front", () => {
  const saved = face({ ratingTarget: undefined, captureScores: undefined });
  const comparison = calibrationScoreComparison(saved);
  assert.equal(comparison.view, "legacy-primary");
  assert.equal(comparison.score, 6.7);
  assert.equal(comparison.difference, null);
  assert.equal(comparison.sameScope, false);
  assert.match(calibrationScoreViewLabel(comparison.view), /legacy/);
  assert.deepEqual(splitByProvenance([saved]).own, []);
});

test("a missing matching view never substitutes another view or invents a difference", () => {
  const comparison = calibrationScoreComparison(face({ ratingTarget: "side", captureScores: { front: 6.7 } }));
  assert.equal(comparison.view, "unavailable");
  assert.equal(comparison.score, null);
  assert.equal(comparison.difference, null);
});

test("unrated captures keep view scores but never have a comparison gap", () => {
  assert.equal(calibrationScoreComparison(face({ rating: null })).difference, null);
});

test("front fitter excludes combined, side, external totals and unknown scopes", () => {
  const captures = ["combined", "side", "external-overall", undefined].map((ratingTarget, index) =>
    face({ id: `m${index + 1}`, ratingTarget: ratingTarget as RatedFace["ratingTarget"] }));
  assert.deepEqual(JSON.parse(corpusJSON(captures)).faces, []);
  assert.equal(JSON.parse(calibrationDiagnosticsJSON(captures)).faces.length, 4);
  const front = face({ id: "m5", ratingTarget: "front" });
  assert.deepEqual(JSON.parse(corpusJSON([...captures, front])).faces.map((row: { id: string }) => row.id), ["m5"]);
  assert.deepEqual(JSON.parse(corpusJSON([face({ ratingTarget: "front", measurements: { gonialAngle: 120 } })])).faces, []);
});

test("full-precision capture snapshots agree with diagnostics merge and preserve both views", () => {
  const profile: SidePoints = {
    trichion: { x: 300, y: 100 }, glabella: { x: 330, y: 190 }, nasion: { x: 325, y: 210 },
    pronasale: { x: 395, y: 265 }, subnasale: { x: 355, y: 295 }, labialeSuperius: { x: 360, y: 320 },
    labialeInferius: { x: 358, y: 345 }, pogonion: { x: 350, y: 390 }, menton: { x: 335, y: 410 },
    gonion: { x: 215, y: 360 }, condylion: { x: 205, y: 250 }, cervicale: { x: 240, y: 430 }, tragion: { x: 200, y: 240 },
  };
  for (const sex of ["male", "female"] as Sex[]) {
    const front = scoreFrontMeasurements(Object.fromEntries(METRICS.map((metric) => [metric.id, distFor(metric, sex).mean])), sex);
    const side = analyzeSide(profile, 1, sex);
    assert.deepEqual(calibrationCaptureScores(front, side), { front: front.overall, side: side.overall, combined: mergeReports(front, side).overall });
    assert.deepEqual(calibrationCaptureScores(front, null), { front: front.overall });
    assert.deepEqual(calibrationCaptureScores(null, side), { side: side.overall });
  }
});
