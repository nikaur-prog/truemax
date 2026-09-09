import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { creatorFrontViewIssue } from "../engine/quickCapturePolicy.js";

const quick = readFileSync(new URL("../quick.ts", import.meta.url), "utf8");
const side = readFileSync(new URL("./sideFlow.ts", import.meta.url), "utf8");

test("both entry documents supply every element required by shared side capture", () => {
  const elements = side.slice(side.indexOf("const el = () => ({"), side.indexOf("function renderSideCaptureCopy"));
  const required = [...elements.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
  assert.ok(required.includes("side-swap"), "camera cleanup must be covered even on upload-only paths");
  for (const name of ["index.html", "quick.html"]) {
    const html = readFileSync(new URL(`../../${name}`, import.meta.url), "utf8");
    for (const id of required) {
      assert.equal([...html.matchAll(new RegExp(`id="${id}"`, "g"))].length, 1, `${name} must mount exactly one #${id}`);
    }
  }
});

test("profile and extreme pitch captures cannot become front creator ratings", () => {
  assert.equal(creatorFrontViewIssue({ faceFound: true, frontal: false, yawDeg: 65, pitchDeg: 3 }), "turned");
  assert.equal(creatorFrontViewIssue({ faceFound: true, frontal: false, yawDeg: -45, pitchDeg: 3 }), "turned");
  assert.equal(creatorFrontViewIssue({ faceFound: true, frontal: false, yawDeg: 2, pitchDeg: 40 }), "tilted");
  assert.equal(creatorFrontViewIssue({ faceFound: true, frontal: true, yawDeg: 8, pitchDeg: 3 }), null, "modest pose remains available with normal measurement caveats");
  assert.equal(creatorFrontViewIssue({ faceFound: false, frontal: false, yawDeg: 0, pitchDeg: 0 }), null, "no-face has its own error path");
  const capture = quick.slice(quick.indexOf("async function run("), quick.indexOf("// The last analysed photo"));
  assert.ok(capture.indexOf("creatorFrontViewIssue(q)") < capture.indexOf("last = { lm"));
  assert.match(capture, /if \(viewIssue\) \{[\s\S]+?return;/);
  assert.match(capture, /No score was saved/);
});

test("saved faces are explicitly selected and pose-checked instead of inheriting the previous subject's group", () => {
  const direct = quick.slice(quick.indexOf("async function openSavedFaceFromLibrary"), quick.indexOf("function updateModeStep"));
  const strip = quick.slice(quick.indexOf("async function refreshLibrary"), quick.indexOf("function escapeHtml"));
  for (const source of [direct, strip]) {
    assert.match(source, /resetSexAsk\(\)/);
    assert.match(source, /withSex\(\(\) => void run\(canvas\)/);
    assert.doesNotMatch(source, /show\(storedSex\(\) \?\? "male"/);
  }
});

test("Calibrate retains one reference group across its paired capture and snapshots diagnostic evidence", () => {
  const chooser = quick.slice(quick.indexOf("function withSex"), quick.indexOf("function paintSilhouette"));
  assert.match(chooser, /\(pendingFront \?\? pendingSide\)\?\.sex/);
  assert.match(chooser, /storeSex\(pairedSex\)/);
  assert.match(quick, /if \(mode !== "calibrate"\) resetSexAsk\(\)/);
  assert.match(quick, /diagnostics: snapshotCalibrationDiagnostics\(/);
  assert.match(quick, /automaticPoints: review\.automaticPoints/);
});
