import assert from "node:assert/strict";
import test from "node:test";
import { snapshotCalibrationDiagnostics } from "./calibrationDiagnostics.js";
import { addRatedFace, calibrationDiagnosticsJSON, corpusJSON, loadCalibrationSet } from "./calibrationSet.js";
import { activateScanOwner, activeScanOwner } from "./scanScope.js";
import { SIDE_POINTS } from "./sideMetrics.js";
import type { SidePoints } from "./sideMetrics.js";
import type { RatedFace } from "./calibrationSet.js";
import type { Report } from "./types.js";

const report = (sex: "male" | "female" = "female"): Report => ({
  sex, overall: 5.6, overallPercentile: 60, potential: 6,
  metrics: [{ value: 117, score: 4, idealRange: [110, 125], def: { id: "gonialAngle", view: "side" } }],
}) as unknown as Report;
const points = (): SidePoints => Object.fromEntries(SIDE_POINTS.map(({ id }, index) => [id, { x: 40 + index, y: 60 + index }])) as SidePoints;
const diagnostic = () => snapshotCalibrationDiagnostics({
  build: "test-build",
  referenceGroup: "female",
  capturedAt: "2026-09-09T06:00:00Z",
  front: null,
  side: { width: 600, height: 800, faceDir: 1, automaticPoints: points(), finalPoints: points(), seedMethod: "mesh", seedVersion: "test-v1", operatorVerified: true, report: report() },
});

test("capture diagnostics own the points and references even after the editor changes", () => {
  const original = diagnostic();
  const copy = snapshotCalibrationDiagnostics({ ...original, side: original.side });
  original.side!.automaticPoints.gonion.x = 900;
  original.side!.finalPoints.gonion.x = 950;
  original.side!.report.metrics[0].idealRange[0] = 50;
  assert.notEqual(copy.side!.automaticPoints.gonion.x, 900);
  assert.notEqual(copy.side!.finalPoints.gonion.x, 950);
  assert.deepEqual(copy.side!.report.metrics[0].idealRange, [110, 125]);
  assert.equal(copy.side!.coordinateSpace, "review-image-pixels");
  assert.equal(copy.side!.reviewKind, "operator-not-expert");
  assert.equal(copy.side!.width, 600);
});

test("mixed-reference pairs are rejected rather than silently saving incompatible scores", () => {
  assert.throws(() => snapshotCalibrationDiagnostics({
    build: "test", referenceGroup: "female", front: null,
    side: { ...diagnostic().side!, report: report("male") },
  }), /same reference group/);
});

test("diagnostic export retains unrated and external rows but omits names, photos and unrelated fields", () => {
  const faces: RatedFace[] = [
    { id: "w1", sex: "female", rating: null, ratedBy: "self", scored: 5.6, measurements: { gonialAngle: 117 }, label: "Private name", thumb: "data:image/jpeg;base64,secret", diagnostics: diagnostic() },
    { id: "w2", sex: "female", rating: 7.5, ratedBy: "external", scored: 5.6, measurements: { gonialAngle: 120 } },
  ];
  const text = calibrationDiagnosticsJSON(faces);
  const exported = JSON.parse(text);
  assert.equal(exported.faces.length, 2);
  assert.equal(exported.faces[0].rating, null);
  assert.equal(exported.faces[1].ratingSource, "external");
  assert.equal(exported.faces[1].diagnostics, null, "legacy rows do not invent missing points");
  assert.equal(exported.faces[0].diagnostics.side.seedVersion, "test-v1");
  assert.doesNotMatch(text, /Private name|data:image|thumb/);
  assert.deepEqual(JSON.parse(corpusJSON(faces)).faces, [], "diagnostic export never makes rows eligible for fitting");
});

test("diagnostics survive local save and storage failure is not reported as a saved capture", () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const owner = activeScanOwner();
  const entries = new Map<string, string>();
  let fail = false;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (fail) throw new Error("QuotaExceededError");
      entries.set(key, value);
    },
  } });
  try {
    activateScanOwner("capture-test-owner");
    addRatedFace(report(), null, "self", undefined, undefined, { diagnostics: diagnostic() });
    const stored = loadCalibrationSet();
    assert.equal(stored.length, 1);
    assert.equal(stored[0].diagnostics?.side?.finalPoints.gonion.x, points().gonion.x);
    fail = true;
    assert.throws(() => addRatedFace(report(), null, "self"), /QuotaExceededError/);
    assert.equal(loadCalibrationSet().length, 1);
    activateScanOwner("other-capture-owner");
    assert.equal(loadCalibrationSet().length, 0, "another account cannot inherit diagnostic points");
  } finally {
    activateScanOwner(owner?.startsWith("user:") ? owner.slice(5) : null);
    if (prior) Object.defineProperty(globalThis, "localStorage", prior);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
