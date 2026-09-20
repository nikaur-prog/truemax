import test from "node:test";
import assert from "node:assert/strict";
import { calibrationCaptureWarnings, calibrationFileReference, suggestedCalibrationReference } from "./calibrationCaptureGuard.js";
import type { CalibrationDiagnostics } from "./calibrationDiagnostics.js";
import type { CalibrationImageSource } from "./calibrationImageSource.js";
import type { RatedFace } from "./calibrationSet.js";

const source = (key: string): CalibrationImageSource => ({
  schemaVersion: 1, originalFileSha256: key.repeat(64), reviewPixelsSha256: key.repeat(64),
  width: 100, height: 100, pixelFormat: "rgba8", orientation: "review-image-as-displayed",
});
const diagnostics = (front?: CalibrationImageSource, side?: CalibrationImageSource) => ({
  front: front ? { imageSource: front } : null, side: side ? { imageSource: side } : null,
}) as CalibrationDiagnostics;
const saved = (overrides: Partial<RatedFace> = {}): RatedFace => ({
  id: "m1", referenceId: "m01", sex: "male", rating: null, scored: 5,
  measurements: {}, diagnostics: diagnostics(source("a"), source("b")), ...overrides,
});

test("filename hints only accept anonymous pilot files and normalise aliases", () => {
  assert.deepEqual(calibrationFileReference("w1-side.png"), { referenceId: "f01", view: "side" });
  assert.deepEqual(calibrationFileReference("F02_FRONT.JPG"), { referenceId: "f02", view: "front" });
  for (const name of ["Jane-front.png", "person@example.com.png", "/folder/f01-front.png", "f01-front (1).png", "f00-side.png", "IMG_001.jpg", "f01-side.txt"]) {
    assert.equal(calibrationFileReference(name), undefined, name);
  }
});

test("ID suggestion requires compatible filenames and does not guess from save-order IDs", () => {
  const front = calibrationFileReference("f01-front.png");
  const side = calibrationFileReference("w1-side.png");
  assert.equal(suggestedCalibrationReference({ front, side }), "f01");
  assert.equal(suggestedCalibrationReference({ front, side: calibrationFileReference("f02-side.png") }), undefined);
  assert.equal(suggestedCalibrationReference({}), undefined);
  assert.deepEqual(calibrationCaptureWarnings({ sex: "female" }, [saved({ id: "m1", referenceId: undefined })]), []);
});

test("conflicting filenames, wrong view and explicit reference-group mismatch are independently visible", () => {
  const warnings = calibrationCaptureWarnings({ sex: "female", referenceId: "m02", fileReferences: {
    front: calibrationFileReference("f01-side.png"), side: calibrationFileReference("m02-side.png"),
  } }, []);
  assert.deepEqual(warnings.map(({ code }) => code), ["reference-group", "file-pair", "file-view-front", "file-reference-front", "file-group-side"]);
  assert.deepEqual(calibrationCaptureWarnings({ sex: "female", referenceId: "case_01" }, []), []);
});

test("duplicate photos are identified across group, filename, view and ID changes", () => {
  const warnings = calibrationCaptureWarnings({ sex: "female", referenceId: "f09", diagnostics: diagnostics(source("a"), source("b")) }, [saved()]);
  assert.deepEqual(warnings.map(({ code }) => code), ["photo-reused:m1"]);
  assert.match(warnings[0].message, /different reference group/);
  assert.deepEqual(calibrationCaptureWarnings({ sex: "male", diagnostics: diagnostics(undefined, source("a")) }, [saved()]).map(({ code }) => code), ["photo-reused:m1"]);
});

test("decoded pixel matches work without upload fingerprints but invalid hashes never match", () => {
  const pixels = { ...source("c"), originalFileSha256: undefined };
  assert.equal(calibrationCaptureWarnings({ sex: "female", diagnostics: diagnostics(pixels) }, [saved({ diagnostics: diagnostics(pixels) })]).length, 1);
  assert.equal(calibrationCaptureWarnings({ sex: "female", diagnostics: diagnostics({ ...pixels, width: 50 }) }, [saved({ diagnostics: diagnostics(pixels) })]).length, 0);
  const invalid = { ...pixels, reviewPixelsSha256: "", originalFileSha256: "" };
  assert.deepEqual(calibrationCaptureWarnings({ sex: "female", diagnostics: diagnostics(invalid) }, [saved({ diagnostics: diagnostics(invalid) })]), []);
});

test("same photo in both slots and reference aliases/retakes require explicit repeat review", () => {
  assert.deepEqual(calibrationCaptureWarnings({ sex: "female", diagnostics: diagnostics(source("a"), source("a")) }, []).map(({ code }) => code), ["same-photo-both-views"]);
  for (const referenceId of ["f01", "f1", "w01", "f01-retake"]) {
    const warnings = calibrationCaptureWarnings({ sex: "female", referenceId }, [saved({ sex: "female", referenceId: "w1" })]);
    assert.deepEqual(warnings.map(({ code }) => code), ["reference-reused:m1"]);
  }
});
