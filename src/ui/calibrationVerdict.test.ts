import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Report } from "../engine/types.js";
import type { SidePoints } from "../engine/sideMetrics.js";
import { calibrationVerdictSnapshot } from "./calibrationVerdict.js";
import type { CalibrationCapture } from "./calibrationVerdict.js";

const report = (suspects: number): Report => ({
  metrics: [...Array(suspects)].map(() => ({ implausible: true })).concat([{ implausible: false }]),
}) as unknown as Report;

const pending = (): CalibrationCapture => ({
  front: report(1),
  side: report(2),
  frontPhoto: { id: "front-photo" } as unknown as HTMLCanvasElement,
  frontLandmarks: [{ x: 0.2, y: 0.3, z: 0, visibility: 1 }],
  sidePhoto: { id: "side-photo" } as unknown as HTMLCanvasElement,
  sidePoints: { gonion: { x: 20, y: 30 } } as SidePoints,
});

test("saved dual-view media survives clearing the editable capture slots", () => {
  const slots = pending();
  const frontPhoto = slots.frontPhoto;
  const sidePhoto = slots.sidePhoto;
  const side = slots.side;
  const snapshot = calibrationVerdictSnapshot(slots.front!, slots);
  for (const key of Object.keys(slots) as (keyof CalibrationCapture)[]) slots[key] = null;
  assert.equal(snapshot.additionalSide, side);
  assert.equal(snapshot.hasSide, true);
  assert.equal(snapshot.suspect, 3);
  assert.equal(snapshot.dual?.frontPhoto, frontPhoto);
  assert.equal(snapshot.dual?.sidePhoto, sidePhoto);
  assert.deepEqual(snapshot.dual?.frontLandmarks, [{ x: 0.2, y: 0.3, z: 0, visibility: 1 }]);
  assert.deepEqual(snapshot.dual?.sidePoints.gonion, { x: 20, y: 30 });
});

test("saved landmarks are isolated from later point edits", () => {
  const slots = pending();
  const snapshot = calibrationVerdictSnapshot(slots.front!, slots);
  slots.frontLandmarks![0].x = 0.9;
  slots.sidePoints!.gonion.x = 90;
  assert.equal(snapshot.dual!.frontLandmarks[0].x, 0.2);
  assert.equal(snapshot.dual!.sidePoints.gonion.x, 20);
});

test("side-only saves count each suspect once and never merge the side with itself", () => {
  const slots = pending();
  slots.front = null;
  slots.frontPhoto = null;
  slots.frontLandmarks = null;
  const snapshot = calibrationVerdictSnapshot(slots.side!, slots);
  assert.equal(snapshot.suspect, 2);
  assert.equal(snapshot.hasSide, true);
  assert.equal(snapshot.additionalSide, null);
  assert.equal(snapshot.dual, null);
});

test("front-only saves have no side export and retain their suspect count", () => {
  const slots = pending();
  slots.side = null;
  slots.sidePhoto = null;
  slots.sidePoints = null;
  const snapshot = calibrationVerdictSnapshot(slots.front!, slots);
  assert.equal(snapshot.suspect, 1);
  assert.equal(snapshot.hasSide, false);
  assert.equal(snapshot.additionalSide, null);
  assert.equal(snapshot.dual, null);
});

test("incomplete dual-view assets do not offer an unusable video export", () => {
  for (const key of ["frontPhoto", "frontLandmarks", "sidePhoto", "sidePoints"] as const) {
    const slots = pending();
    slots[key] = null;
    assert.equal(calibrationVerdictSnapshot(slots.front!, slots).dual, null, key);
  }
  const slots = pending();
  slots.frontLandmarks = [];
  assert.equal(calibrationVerdictSnapshot(slots.front!, slots).dual, null);
});

const quick = readFileSync(new URL("../quick.ts", import.meta.url), "utf8");

test("Calibrate snapshots before clearing and renders/downloads from that snapshot", () => {
  const save = quick.slice(quick.indexOf("const store = (rating: number | null)"), quick.indexOf("function renderVerdictStep"));
  assert.match(save, /const verdict = calibrationVerdictSnapshot\(r,/);
  assert.match(save, /suspect: verdict\.suspect/);
  assert.match(save, /clearPending\(\);\s+renderVerdictStep\(r, rating, verdict\);/);
  assert.ok(save.indexOf("calibrationVerdictSnapshot") < save.indexOf("clearPending()"));
  const verdict = quick.slice(quick.indexOf("function renderVerdictStep"), quick.indexOf("function gapOf"));
  assert.match(verdict, /const side = capture\.additionalSide/);
  assert.match(verdict, /\$\{capture\.dual/);
  assert.match(verdict, /const media = capture\.dual/);
  assert.match(verdict, /media\.frontPhoto,\s+media\.frontLandmarks/);
  assert.doesNotMatch(verdict, /pendingFront|pendingSide/);
});

test("leaving Calibrate drops saved handlers and capture media", () => {
  const leave = quick.slice(quick.indexOf("function leaveMode"), quick.indexOf('for (const button of document.querySelectorAll<HTMLButtonElement>(".q-pillar"))', quick.indexOf("function leaveMode")));
  assert.match(leave, /clearPending\(\)/);
  assert.match(leave, /el\.calBody\.replaceChildren\(\)/);
  const set = quick.slice(quick.indexOf("function renderCalibrationSet"), quick.indexOf("const faces = loadCalibrationSet()", quick.indexOf("function renderCalibrationSet")));
  assert.match(set, /clearPending\(\)/);
});

test("Calibrate explains collection is not automatic training and keeps ratings optional", () => {
  assert.match(quick, /Side correction shared privately for review\. Automatic placement has not changed\./);
  assert.match(quick, /Ratings are optional; you can\s+save measurements without judging attractiveness/);
  assert.match(quick, /Saving a face does not\s+automatically train the scanner or change anyone's scores/);
  assert.doesNotMatch(quick, /Side correction shared: it will teach the automatic placement/);
  const save = quick.slice(quick.indexOf("const store = (rating: number | null)"), quick.indexOf("function renderVerdictStep"));
  assert.match(save, /rating !== null && external.checked \? "external" : "self"/);
  assert.match(save, /if \(!num\.value\.trim\(\)\) \{\s+store\(null\);/);
});
