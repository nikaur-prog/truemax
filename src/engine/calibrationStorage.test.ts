import test from "node:test";
import assert from "node:assert/strict";
import {
  addRatedFace, calibrationDiagnosticsJSON, clearCalibrationSet, confirmOwnRating,
  corpusJSON, loadCalibrationSet, loadCalibrationSetForExport, removeRatedFace, reviseRating,
} from "./calibrationSet.js";
import type { RatedFace } from "./calibrationSet.js";
import { activateScanOwner, activeScanOwner } from "./scanScope.js";
import type { Report, Sex } from "./types.js";
import { CalibrationCaptureReviewRequired } from "./calibrationCaptureGuard.js";

const owner = "calibration-storage-owner";
const key = `tm.calibration.v1:user:${owner}`;
const row = (id = "m1", ratedBy: RatedFace["ratedBy"] = "self"): RatedFace => ({
  id, sex: "male", rating: 5, scored: 5.5, ratedBy, ratingTarget: "front", referenceId: "m01", measurements: { fwhr: 2.1, gonialAngle: 121 },
});
const report = (sex: Sex = "male"): Report => ({ sex, overall: 5.5, metrics: [] }) as unknown as Report;

function withStorage(run: (store: {
  entries: Map<string, string>;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
}) => void): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const previousOwner = activeScanOwner();
  const entries = new Map<string, string>();
  const storage = {
    getItem: (entryKey: string): string | null => entries.get(entryKey) ?? null,
    setItem: (entryKey: string, value: string): void => { entries.set(entryKey, value); },
    removeItem: (entryKey: string): void => { entries.delete(entryKey); },
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  activateScanOwner(owner);
  try { run({ entries, storage }); }
  finally {
    activateScanOwner(previousOwner?.startsWith("user:") ? previousOwner.slice(5) : null);
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

test("a saved capture is confirmed in the same owner's storage before success", () => withStorage(({ entries }) => {
  const saved = addRatedFace(report(), null, "self", undefined, undefined, { referenceId: "m01" });
  assert.deepEqual(JSON.parse(entries.get(key)!), saved);
  assert.equal(saved[0].referenceId, "m01");
  activateScanOwner("another-admin");
  assert.deepEqual(loadCalibrationSet(), []);
  addRatedFace(report(), null, "self", undefined, undefined, { referenceId: "m01" });
  assert.equal(JSON.parse(entries.get(key)!).length, 1, "a second owner cannot change the first set");
}));

test("saved view scores and explicit rating scope survive storage and private export without changing primary", () => withStorage(() => {
  const scores = { front: 6.7, side: 4.2, combined: 6.0 };
  const primary = { ...report(), overall: 6.7 };
  const saved = addRatedFace(primary, 6.2, "external", undefined, undefined, {
    referenceId: "m01", ratingTarget: "external-overall", captureScores: scores,
  });
  scores.combined = 9;
  assert.equal(saved[0].scored, 6.7);
  assert.equal(saved[0].captureScores?.combined, 6.0);
  const exported = JSON.parse(calibrationDiagnosticsJSON(loadCalibrationSet())).faces[0];
  assert.equal(exported.scored, 6.7);
  assert.equal(exported.ratingTarget, "external-overall");
  assert.deepEqual(exported.captureScores, { front: 6.7, side: 4.2, combined: 6 });
  assert.deepEqual(JSON.parse(corpusJSON(saved)).faces, []);
}));

test("duplicate anonymous reference IDs require an explicit exception and never overwrite prior rows", () => withStorage(({ entries }) => {
  addRatedFace(report(), null, "self", undefined, undefined, { referenceId: "m01" });
  const before = entries.get(key);
  assert.throws(() => addRatedFace(report(), null, "self", undefined, undefined, { referenceId: " m01 " }), CalibrationCaptureReviewRequired);
  assert.equal(entries.get(key), before);
  const repeated = addRatedFace(report(), null, "self", undefined, undefined, { referenceId: "m01-retake", acknowledgedCaptureWarnings: ["reference-reused:m1"] });
  assert.equal(repeated.length, 2);
  assert.deepEqual(repeated[0], JSON.parse(before!)[0]);
  assert.deepEqual(repeated[1].captureReview, { schemaVersion: 1, acknowledgedWarnings: ["reference-reused:m1"] });
  assert.throws(() => addRatedFace(report("female"), null, "self", undefined, undefined, { referenceId: "m01" }), CalibrationCaptureReviewRequired);
}));

test("capture exception acknowledgement must include every current warning and remains private diagnostic evidence", () => withStorage(() => {
  addRatedFace(report(), null, "self", undefined, undefined, { referenceId: "m01" });
  assert.throws(() => addRatedFace(report("female"), 6, "self", undefined, undefined, {
    referenceId: "m01", acknowledgedCaptureWarnings: ["reference-reused:m1"],
  }), CalibrationCaptureReviewRequired);
  const faceReport = { ...report("female"), metrics: [{ def: { id: "fwhr" }, value: 2.1 }] } as unknown as Report;
  const result = addRatedFace(faceReport, 6, "self", undefined, undefined, {
    referenceId: "m01", ratingTarget: "front", acknowledgedCaptureWarnings: ["reference-group", "reference-reused:m1"],
  });
  assert.equal(result.length, 2);
  assert.deepEqual(JSON.parse(corpusJSON(result)).faces, [], "an acknowledged exception cannot silently become an independent fitting row");
  const exported = JSON.parse(calibrationDiagnosticsJSON(result));
  assert.deepEqual(exported.faces[1].captureReview, result[1].captureReview);
}));

test("invalid reference IDs never touch a saved set", () => withStorage(({ entries }) => {
  const before = JSON.stringify([row()]);
  entries.set(key, before);
  for (const referenceId of ["Private Name", "person@example.com", "../m01", "M01", "a".repeat(33)]) {
    assert.throws(() => addRatedFace(report(), null, "self", undefined, undefined, { referenceId }), /anonymous reference ID/);
    assert.equal(entries.get(key), before);
  }
}));

test("storage read errors cannot replace an existing set with a fresh one", () => withStorage(({ entries, storage }) => {
  const before = JSON.stringify([row()]);
  entries.set(key, before);
  storage.getItem = () => { throw new Error("Storage unavailable"); };
  assert.throws(() => addRatedFace(report(), null, "self"), /could not be read/);
  assert.throws(() => clearCalibrationSet(), /could not be read/);
  assert.equal(entries.get(key), before);
}));

test("malformed and ambiguous stored rows are preserved rather than overwritten", () => withStorage(({ entries }) => {
  for (const raw of ["not-json", "{}", "[null]", JSON.stringify([row(), row()])]) {
    entries.set(key, raw);
    assert.throws(() => addRatedFace(report(), null, "self"), /could not be read|not readable/);
    assert.throws(() => removeRatedFace("m1"), /could not be read|not readable/);
    assert.throws(() => loadCalibrationSetForExport(), /could not be read|not readable/);
    assert.equal(entries.get(key), raw);
  }
}));

test("quota failures surface for every mutation and preserve the old set", () => withStorage(({ entries, storage }) => {
  const before = JSON.stringify([row("m1", undefined)]);
  entries.set(key, before);
  storage.setItem = () => { throw new Error("QuotaExceededError"); };
  const actions = [
    () => addRatedFace(report(), null, "self"),
    () => reviseRating("m1", 6, true),
    () => removeRatedFace("m1"),
    () => confirmOwnRating("m1"),
    () => clearCalibrationSet(),
  ];
  for (const action of actions) {
    assert.throws(action, /QuotaExceededError/);
    assert.equal(entries.get(key), before);
  }
}));

test("a storage implementation that silently ignores writes never reports success", () => withStorage(({ entries, storage }) => {
  const before = JSON.stringify([row()]);
  entries.set(key, before);
  storage.setItem = () => {};
  assert.throws(() => addRatedFace(report(), null, "self"), /could not be confirmed/);
  assert.equal(entries.get(key), before);
}));

test("a write followed by an exception rolls back its exact write", () => withStorage(({ entries, storage }) => {
  const before = JSON.stringify([row()]);
  entries.set(key, before);
  let failOnce = true;
  storage.setItem = (entryKey, value) => {
    entries.set(entryKey, value);
    if (failOnce) { failOnce = false; throw new Error("Write interrupted"); }
  };
  assert.throws(() => addRatedFace(report(), null, "self"), /Write interrupted/);
  assert.equal(entries.get(key), before);
}));

test("a failed first capture removes only its own partial write", () => withStorage(({ entries, storage }) => {
  storage.setItem = (entryKey, value) => { entries.set(entryKey, value); throw new Error("Write interrupted"); };
  assert.throws(() => addRatedFace(report(), null, "self"), /Write interrupted/);
  assert.equal(entries.has(key), false);
}));

test("read-back exceptions roll back a successful write when the saved value can still be read", () => withStorage(({ entries, storage }) => {
  const before = JSON.stringify([row()]);
  entries.set(key, before);
  let failNextRead = false;
  storage.setItem = (entryKey, value) => { entries.set(entryKey, value); failNextRead = true; };
  storage.getItem = (entryKey) => {
    if (failNextRead) { failNextRead = false; throw new Error("Read interrupted"); }
    return entries.get(entryKey) ?? null;
  };
  assert.throws(() => addRatedFace(report(), null, "self"), /Read interrupted/);
  assert.equal(entries.get(key), before);
}));

test("a newer tab's write is not overwritten by either a save or rollback", () => withStorage(({ entries, storage }) => {
  entries.set(key, JSON.stringify([row()]));
  const newer = JSON.stringify([row(), { ...row("m2"), referenceId: "m02" }]);
  let reads = 0;
  storage.getItem = (entryKey) => {
    if (++reads === 2) entries.set(entryKey, newer);
    return entries.get(entryKey) ?? null;
  };
  assert.throws(() => addRatedFace(report(), null, "self"), /changed in another window/);
  assert.equal(entries.get(key), newer);

  storage.getItem = (entryKey) => entries.get(entryKey) ?? null;
  storage.setItem = (entryKey) => { entries.set(entryKey, newer); throw new Error("Another write won"); };
  assert.throws(() => addRatedFace(report(), null, "self"), /Another write won/);
  assert.equal(entries.get(key), newer);
}));

test("account changes during a write roll back the old owner's write without touching the new account", () => withStorage(({ entries, storage }) => {
  const before = JSON.stringify([row()]);
  const otherKey = "tm.calibration.v1:user:new-owner";
  entries.set(key, before);
  entries.set(otherKey, "[]");
  storage.setItem = (entryKey, value) => { entries.set(entryKey, value); activateScanOwner("new-owner"); };
  assert.throws(() => addRatedFace(report(), null, "self"), /account changed/);
  assert.equal(entries.get(key), before);
  assert.equal(entries.get(otherKey), "[]");
}));

test("anonymous scopes cannot save admin calibration rows", () => withStorage(({ entries }) => {
  activateScanOwner(null);
  assert.throws(() => addRatedFace(report(), null, "self"), /Sign in again/);
  assert.equal(entries.size, 0);
}));

test("missing-row edits fail instead of claiming to update or delete a face", () => withStorage(({ entries }) => {
  const before = JSON.stringify([row()]);
  entries.set(key, before);
  for (const action of [() => reviseRating("m2", 5, true), () => removeRatedFace("m2"), () => confirmOwnRating("m2")]) {
    assert.throws(action, /no longer in your set/);
    assert.equal(entries.get(key), before);
  }
}));

test("editing or confirming cannot promote external or revised labels into the fitting corpus", () => withStorage(({ entries }) => {
  for (const ratedBy of ["external", "revised"] as const) {
    entries.set(key, JSON.stringify([row("m1", ratedBy)]));
    const edited = reviseRating("m1", 6, true);
    assert.equal(edited[0].ratedBy, ratedBy);
    assert.deepEqual(JSON.parse(corpusJSON(edited)).faces, []);
    assert.equal(JSON.parse(calibrationDiagnosticsJSON(edited)).faces.length, 1);
    assert.throws(() => confirmOwnRating("m1"), /cannot be relabelled/);
  }
}));

test("a first rating after an unrated result is review-only even through the typo path", () => withStorage(({ entries }) => {
  for (const ratedBy of ["self", "external", "revised", undefined] as const) {
    for (const keepsProvenance of [false, true]) {
      const capture: RatedFace = { ...row(), rating: null, ratedBy };
      entries.set(key, JSON.stringify([capture]));
      const edited = reviseRating("m1", 6, keepsProvenance);
      assert.equal(edited[0].rating, 6);
      assert.equal(edited[0].ratedBy, ratedBy === "external" ? "external" : "revised");
      assert.deepEqual(JSON.parse(corpusJSON(edited)).faces, []);
      assert.equal(JSON.parse(calibrationDiagnosticsJSON(edited)).faces[0].rating, 6);
      assert.throws(() => confirmOwnRating("m1"), /cannot be relabelled/);
    }
  }
}));

test("a numeric typo correction retains independent front eligibility and leaves other legacy rows untouched", () => withStorage(({ entries }) => {
  const legacy: RatedFace = { ...row("m2"), referenceId: "m02" };
  delete legacy.ratingTarget;
  delete legacy.ratedBy;
  const legacyBefore = JSON.stringify(legacy);
  entries.set(key, JSON.stringify([row(), legacy]));
  const edited = reviseRating("m1", 6, true);
  assert.equal(edited[0].ratedBy, "self");
  assert.deepEqual(JSON.parse(corpusJSON(edited)).faces.map((face: RatedFace) => face.id), ["m1"]);
  assert.equal(JSON.stringify(edited[1]), legacyBefore);
}));

test("legacy unknown labels remain unknown after typo corrections until deliberately confirmed", () => withStorage(({ entries }) => {
  const legacy = row();
  delete legacy.ratedBy;
  entries.set(key, JSON.stringify([legacy]));
  assert.equal(reviseRating("m1", 6, true)[0].ratedBy, undefined);
  assert.equal(confirmOwnRating("m1")[0].ratedBy, "self");
}));
