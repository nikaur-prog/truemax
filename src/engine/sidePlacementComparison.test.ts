import test from "node:test";
import assert from "node:assert/strict";
import { compareSidePlacement } from "./sidePlacementComparison.js";
import { analyzeSide } from "./scoring.js";
import { SIDE_POINTS } from "./sideMetrics.js";
import type { SidePoints } from "./sideMetrics.js";

const points = (): SidePoints => ({
  trichion: { x: 250, y: 40 }, glabella: { x: 290, y: 105 }, nasion: { x: 285, y: 125 },
  pronasale: { x: 330, y: 180 }, subnasale: { x: 295, y: 200 },
  labialeSuperius: { x: 303, y: 218 }, labialeInferius: { x: 304, y: 238 },
  pogonion: { x: 300, y: 280 }, menton: { x: 285, y: 302 },
  cervicale: { x: 210, y: 310 }, gonion: { x: 160, y: 260 },
  condylion: { x: 133, y: 162 }, tragion: { x: 120, y: 160 },
});

test("review evidence retains separate automatic/report values and all thirteen correction distances", () => {
  const automaticPoints = points();
  const finalPoints = points();
  finalPoints.gonion.x += 25;
  const report = analyzeSide(finalPoints, 1, "female");
  const comparison = compareSidePlacement({ automaticPoints, finalPoints, report, width: 600, height: 800 });
  assert.equal(comparison.pointChanges.length, SIDE_POINTS.length);
  assert.equal(comparison.pointChanges.find((point) => point.id === "gonion")!.distancePx, 25);
  assert.equal(comparison.pointChanges.find((point) => point.id === "gonion")!.imageDiagonalFraction, 0.025);
  const gonial = comparison.metricChanges.find((metric) => metric.id === "gonialAngle")!;
  assert.notEqual(gonial.automaticValue, gonial.reviewedValue);
  assert.equal(gonial.delta, gonial.reviewedValue! - gonial.automaticValue!);
  assert.equal(comparison.automaticReport!.sex, "female");
  assert.equal(comparison.comparisonKind, "automatic-versus-operator");
  assert.deepEqual(automaticPoints, points());
  assert.equal(report.metrics.find((metric) => metric.def.id === "gonialAngle")!.value, gonial.reviewedValue);
});

test("an invalid automatic jaw cannot prevent saving corrected evidence or fabricate an initial score", () => {
  const automaticPoints = points();
  automaticPoints.gonion = { ...automaticPoints.condylion };
  const finalPoints = points();
  const comparison = compareSidePlacement({ automaticPoints, finalPoints, report: analyzeSide(finalPoints, 1, "male"), width: 600, height: 800 });
  assert.equal(comparison.automaticReport, null);
  assert.match(comparison.automaticUnscoredReason!, /overlap/);
  assert.equal(comparison.metricChanges.find((metric) => metric.id === "gonialAngle")!.automaticScore, null);
  assert.equal(comparison.pointChanges.find((point) => point.id === "gonion")!.distancePx > 0, true);
});

test("mirrored auto points use their own direction, not the reviewed facing toggle", () => {
  const right = points();
  const left = structuredClone(right);
  for (const point of Object.values(left)) point.x = 600 - point.x;
  const report = analyzeSide(right, 1, "male");
  const a = compareSidePlacement({ automaticPoints: right, finalPoints: right, report, width: 600, height: 800 });
  const b = compareSidePlacement({ automaticPoints: left, finalPoints: right, report, width: 600, height: 800 });
  assert.equal(b.automaticFaceDir, -1);
  for (const metric of a.metricChanges) {
    const mirrored = b.metricChanges.find((candidate) => candidate.id === metric.id)!;
    if (metric.automaticValue !== null && mirrored.automaticValue !== null) {
      assert.ok(Math.abs(metric.automaticValue - mirrored.automaticValue) < 1e-8, metric.id);
    }
  }
});

test("automatic points outside the recorded image have raw geometry but no initial scores", () => {
  const automaticPoints = points();
  for (const point of Object.values(automaticPoints)) point.x += 1000;
  const finalPoints = points();
  const report = analyzeSide(finalPoints, 1, "female");
  const comparison = compareSidePlacement({ automaticPoints, finalPoints, report, width: 600, height: 800 });
  assert.equal(comparison.automaticReport, null);
  assert.match(comparison.automaticUnscoredReason!, /outside the photo/);
  assert.ok(comparison.metricChanges.every((metric) => metric.automaticScore === null));
  assert.ok(comparison.metricChanges.some((metric) => metric.automaticValue !== null));
});

test("missing or non-finite initial points do not prevent retaining corrected evidence", () => {
  for (const corrupt of [
    (p: SidePoints) => { delete (p as Partial<SidePoints>).pronasale; },
    (p: SidePoints) => { p.gonion.x = NaN; },
  ]) {
    const automaticPoints = points();
    corrupt(automaticPoints);
    const finalPoints = points();
    const report = analyzeSide(finalPoints, 1, "male");
    const comparison = compareSidePlacement({ automaticPoints, finalPoints, report, width: 600, height: 800 });
    assert.equal(comparison.automaticReport, null);
    assert.ok(comparison.automaticUnscoredReason);
    assert.ok(comparison.metricChanges.every((metric) => metric.automaticScore === null));
    assert.equal(comparison.pointChanges.length, 12);
    assert.ok(comparison.pointChanges.every((point) => Number.isFinite(point.distancePx)));
    assert.ok(comparison.metricChanges.some((metric) => metric.reviewedScore !== null));
  }
});

test("unknown capture dimensions cannot produce a scored automatic report", () => {
  const finalPoints = points();
  for (const width of [0, NaN, Infinity]) {
    const comparison = compareSidePlacement({ automaticPoints: points(), finalPoints,
      report: analyzeSide(finalPoints, 1, "male"), width, height: 800 });
    assert.equal(comparison.automaticReport, null);
    assert.match(comparison.automaticUnscoredReason!, /dimensions/);
  }
});
