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
  const chooser = quick.slice(quick.indexOf("function chooseCalibrationReference"), quick.indexOf("function backToCalibrationSlots"));
  assert.match(chooser, /\(pendingFront \?\? pendingSide\)\?\.sex/);
  assert.match(chooser, /if \(pairedSex\) return Promise\.resolve\(pairedSex\)/);
  assert.doesNotMatch(chooser, /storedSex\(|storeSex\(/);
  assert.match(quick, /if \(mode !== "calibrate"\) resetSexAsk\(\)/);
  assert.match(quick, /diagnostics: snapshotCalibrationDiagnostics\(/);
  assert.match(quick, /automaticPoints: review\.automaticPoints/);
  assert.match(quick, /landmarkGuideVersion: review\.landmarkGuideVersion/);
});

test("calibration uploads select the file first and freeze an explicit reference for scoring", () => {
  const pick = quick.slice(quick.indexOf("function openFrontFilePicker"), quick.indexOf("// Paste or drag"));
  assert.match(pick, /if \(mode === "calibrate"\) \{\s+resetCalibrationChoice\(\);\s+openFrontFilePicker\(\)/);
  assert.match(pick, /addEventListener\("cancel"/);
  const file = quick.slice(quick.indexOf("async function useFile("), quick.indexOf("function stopCamera"));
  assert.ok(file.indexOf("await loadImage(f)") < file.indexOf("await chooseCalibrationReference(f)"));
  assert.match(file, /if \(!sex\) \{ backToCalibrationSlots\(\); return; \}/);
  assert.match(file, /await run\(c, generation, f, referenceSex\)/);
  const run = quick.slice(quick.indexOf("async function run("), quick.indexOf("// The last analysed photo"));
  assert.match(run, /const scanSex = referenceSex \?\?/);
  assert.doesNotMatch(run, /show\(storedSex\(\) \?\? "male"/);
  assert.match(run, /render\(analyze\(last\.lm, last\.w, last\.h, scanSex,/);
});

test("late native front picker results cannot enter a replacement mode, capture or account", () => {
  const pick = quick.slice(quick.indexOf("function openFrontFilePicker"), quick.indexOf("// Paste or drag"));
  assert.match(pick, /const pickerMode = mode/);
  assert.match(pick, /const pickerGeneration = \+\+quickScanGeneration/);
  assert.match(pick, /const ownsInput = frontFileInputGuard\.begin\(\)/);
  assert.match(quick, /const frontFileInputGuard = createSideInputGuard\(activeScanOwner\)/);
  assert.match(pick, /el\.file\.cloneNode\(false\)/);
  assert.match(pick, /el\.file\.replaceWith\(input\)/);
  assert.match(pick, /ownsInput\(\) && input === el\.file/);
  assert.match(pick, /pickerGeneration === quickScanGeneration && pickerMode === mode/);
  assert.equal((pick.match(/if \(!acceptsInput\(\)\) return/g) ?? []).length, 2, "change and cancel must both prove picker ownership");
  const clear = quick.slice(quick.indexOf("function clearPending"), quick.indexOf("async function changeCalibrationReference"));
  assert.match(clear, /frontFileInputGuard\.cancel\(\)/);
});

test("saved-library calibration choices preview the selected canvas", () => {
  const strip = quick.slice(quick.indexOf("async function refreshLibrary"), quick.indexOf("function escapeHtml"));
  assert.match(strip, /withSex\(\(\) => void run\(canvas\), undefined, canvas\)/);
  const choice = quick.slice(quick.indexOf("function withSex"), quick.indexOf("function paintSilhouette"));
  assert.match(choice, /chooseCalibrationReference\(photo\)/);
});

test("calibration side files ask after selection and cancellation cannot reach placement", () => {
  const slots = quick.slice(quick.indexOf("function renderFaceSlots"), quick.indexOf("function renderRatingStep"));
  assert.match(slots, /beforeUpload: \(file, signal\) => chooseCalibrationReference\(file, signal\)/);
  assert.match(slots, /onUploadCancel: resetCalibrationChoice/);
  assert.doesNotMatch(slots, /q-slot-side.*withSex/);
  const load = side.slice(side.indexOf("async function load(file:"), side.indexOf("function showSideLoadFailure"));
  assert.ok(load.indexOf("await loadImage(file)") < load.indexOf("await ctx.beforeUpload(file, signal)"));
  assert.ok(load.indexOf("await ctx.beforeUpload(file, signal)") < load.indexOf("await loadCanvas("));
  assert.match(load, /if \(!sex\) \{ openSideCapture\(ctx\); return; \}/);
  assert.match(load, /ctx = \{ \.\.\.ctx, sex \}/);
  assert.match(side, /!inFrame\.isConnected.*document\.querySelector\("\.sref-overlay, \.sexpick"\)/,
    "a prior walkthrough cannot advance behind the reference chooser");
});

test("draft group corrections re-score both views before assignment and never mutate saved captures", () => {
  const change = quick.slice(quick.indexOf("async function changeCalibrationReference"), quick.indexOf("function renderFaceSlots"));
  assert.match(change, /chooseCalibrationReference\([^\n]+undefined, true\)/);
  assert.match(change, /analyze\(pendingFrontLandmarks,/);
  assert.match(change, /analyzeSide\(pendingSidePoints, pendingSideCapture\.faceDir, sex\)/);
  assert.ok(change.indexOf("const side =") < change.indexOf("pendingFront = front"));
  assert.doesNotMatch(change, /addRatedFace|reviseRating|removeRatedFace/);
  const rating = quick.slice(quick.indexOf("function renderRatingStep"), quick.indexOf("function renderVerdictStep"));
  assert.match(rating, /q-cal-back-to-views/);
  assert.match(rating, /report\.sex !== r\.sex/);
});

test("the mounted side review stamps guide provenance before confirmation or export", () => {
  const review = side.slice(side.indexOf("function mountVerify("), side.indexOf("function drawGuides("));
  const stamp = review.indexOf("const landmarkGuideVersion = SIDE_LANDMARK_GUIDE_VERSION;");
  const complete = review.indexOf("ctx.onDone(report, correctedPoints, faceDir, {");
  assert.ok(stamp >= 0 && stamp < complete, "guide version belongs to the review session");
  assert.match(review.slice(complete), /seedVersion,\s+landmarkGuideVersion,/);
});
