import assert from "node:assert/strict";
import test from "node:test";
import { snapshotCalibrationDiagnostics } from "./calibrationDiagnostics.js";
import { addRatedFace, calibrationDiagnosticsJSON, calibrationReferenceId, corpusJSON, loadCalibrationSet } from "./calibrationSet.js";
import { activateScanOwner, activeScanOwner } from "./scanScope.js";
import { SIDE_POINTS } from "./sideMetrics.js";
import type { SidePoints } from "./sideMetrics.js";
import type { RatedFace } from "./calibrationSet.js";
import type { Report } from "./types.js";
import type { CalibrationImageSource } from "./calibrationImageSource.js";

const report = (sex: "male" | "female" = "female"): Report => ({
  sex, overall: 5.6, overallPercentile: 60, potential: 6,
  metrics: [{ value: 117, score: 4, idealRange: [110, 125], def: { id: "gonialAngle", view: "side" } }],
}) as unknown as Report;
const points = (): SidePoints => Object.fromEntries(SIDE_POINTS.map(({ id }, index) => [id, { x: 40 + index, y: 60 + index }])) as SidePoints;
const imageSource = (): CalibrationImageSource => ({
  schemaVersion: 1, originalFileSha256: "a".repeat(64), reviewPixelsSha256: "b".repeat(64),
  width: 600, height: 800, pixelFormat: "rgba8", orientation: "review-image-as-displayed",
});
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

test("front and side photo fingerprints survive snapshots and export without private source fields", () => {
  const source = { ...imageSource(), fileName: "Private-name.png", pixels: "data:image/png;base64,secret" };
  const capture = diagnostic();
  const snapshot = snapshotCalibrationDiagnostics({
    ...capture,
    front: { width: 600, height: 800, landmarks: [], report: report(), imageSource: source },
    side: { ...capture.side!, imageSource: source },
  });
  source.originalFileSha256 = "c".repeat(64);
  assert.deepEqual(snapshot.front!.imageSource, imageSource());
  assert.deepEqual(snapshot.side!.imageSource, imageSource());
  const exported = calibrationDiagnosticsJSON([{ id: "f01", sex: "female", rating: null, scored: 5.6, measurements: {}, diagnostics: snapshot }]);
  assert.equal(JSON.parse(exported).faces[0].diagnostics.side.imageSource.originalFileSha256, "a".repeat(64));
  assert.doesNotMatch(exported, /Private-name|data:image|fileName/);
  assert.throws(() => snapshotCalibrationDiagnostics({ ...capture, side: { ...capture.side!, imageSource: { ...imageSource(), width: 800 } } }), /dimensions do not match/);
  assert.equal(diagnostic().side!.imageSource, undefined, "legacy snapshots remain readable without invented hashes");
});

test("mixed-reference pairs are rejected rather than silently saving incompatible scores", () => {
  assert.throws(() => snapshotCalibrationDiagnostics({
    build: "test", referenceGroup: "female", front: null,
    side: { ...diagnostic().side!, report: report("male") },
  }), /same reference group/);
});

test("uncertain side capture warnings and initial points survive review, save and export unchanged", () => {
  const capture = diagnostic();
  capture.side!.diagnostics = {
    coordinateSpace: "review-image-pixels",
    localAutomaticPoints: points(),
    localMethod: "silhouette",
    localConfidence: 0,
    templateFallback: true,
    warnings: ["detector-unavailable"],
    reviewedRangeWarnings: ["gonialAngle"],
  };
  const snapshot = snapshotCalibrationDiagnostics({ ...capture, side: capture.side });
  capture.side!.diagnostics!.localAutomaticPoints!.gonion.x = 999;
  capture.side!.diagnostics!.warnings.length = 0;
  const exported = JSON.parse(calibrationDiagnosticsJSON([
    { id: "w1", sex: "female", rating: null, ratedBy: "self", scored: 5.6, measurements: {}, diagnostics: snapshot },
  ]));
  const side = exported.faces[0].diagnostics.side;
  assert.equal(side.operatorVerified, true);
  assert.equal(side.diagnostics.templateFallback, true, "human review does not turn a template into automatic detection");
  assert.notEqual(side.diagnostics.localAutomaticPoints.gonion.x, 999);
  assert.deepEqual(side.diagnostics.warnings, ["detector-unavailable"]);
  assert.deepEqual(side.diagnostics.reviewedRangeWarnings, ["gonialAngle"]);
});

test("a missing initial landmark cannot block exporting a corrected capture or invent an initial score", () => {
  const capture = diagnostic();
  delete (capture.side!.automaticPoints as Partial<SidePoints>).pronasale;
  const reviewed = structuredClone(capture.side!.report);
  const snapshot = snapshotCalibrationDiagnostics({ ...capture, side: capture.side });
  const exported = JSON.parse(calibrationDiagnosticsJSON([
    { id: "w1", sex: "female", rating: null, scored: 5.6, measurements: {}, diagnostics: snapshot },
  ]));
  const side = exported.faces[0].diagnostics.side;
  assert.deepEqual(side.report, reviewed);
  assert.deepEqual(side.finalPoints, capture.side!.finalPoints);
  assert.equal(side.placementComparison.automaticReport, null);
  assert.ok(side.placementComparison.automaticUnscoredReason);
  assert.ok(side.placementComparison.metricChanges.every((metric: { automaticScore: unknown }) => metric.automaticScore === null));
  assert.equal(side.placementComparison.pointChanges.some((point: { id: string }) => point.id === "pronasale"), false);
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

test("anonymous reference IDs are bounded and never inferred from private labels", () => {
  for (const value of [undefined, null, "", "   "]) assert.equal(calibrationReferenceId(value), undefined);
  assert.equal(calibrationReferenceId(" f01 "), "f01");
  assert.equal(calibrationReferenceId("case_01-retake"), "case_01-retake");
  assert.equal(calibrationReferenceId("a".repeat(32)), "a".repeat(32));
  for (const value of [12, {}, "Mary Jane", "name@example.com", "../f01", "1face", "F01", "a".repeat(33), "f01\nprivate", "<script>"]) {
    assert.throws(() => calibrationReferenceId(value), /anonymous reference ID/);
  }
  const base: RatedFace = { id: "w1", sex: "female", rating: 6, ratedBy: "self", scored: 5.6, measurements: {}, label: "Private person" };
  const exported = JSON.parse(calibrationDiagnosticsJSON([
    { ...base, referenceId: "f01" },
    { ...base, id: "w2", label: "f02" },
    { ...base, id: "w3", referenceId: "Private name" },
  ]));
  assert.equal(exported.schemaVersion, 1);
  assert.equal(exported.faces[0].referenceId, "f01");
  assert.equal("referenceId" in exported.faces[1], false, "legacy private labels do not become public identifiers");
  assert.equal("referenceId" in exported.faces[2], false, "malformed stored IDs cannot leak arbitrary text");
  assert.doesNotMatch(JSON.stringify(exported), /Private person|Private name|f02/);
  assert.doesNotMatch(corpusJSON([{ ...base, referenceId: "f01" }]), /referenceId|f01/);
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
    addRatedFace(report(), null, "self", "Private person", undefined, { diagnostics: diagnostic(), referenceId: "f01" });
    const stored = loadCalibrationSet();
    assert.equal(stored.length, 1);
    assert.equal(stored[0].diagnostics?.side?.finalPoints.gonion.x, points().gonion.x);
    assert.equal(stored[0].referenceId, "f01");
    assert.equal(JSON.parse(calibrationDiagnosticsJSON(stored)).faces[0].referenceId, "f01");
    assert.throws(() => addRatedFace(report(), null, "self", undefined, undefined, { referenceId: "name@example.com" }), /anonymous reference ID/);
    assert.equal(loadCalibrationSet().length, 1, "bad identifiers cannot create partial captures");
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
