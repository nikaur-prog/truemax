import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const quick = readFileSync(new URL("../quick.ts", import.meta.url), "utf8");
const league = readFileSync(new URL("../league/main.ts", import.meta.url), "utf8");

test("calibration is a League owner-admin tool, not a creator upgrade or public route", () => {
  const html = readFileSync(new URL("../../quick.html", import.meta.url), "utf8");
  assert.match(html, /data-mode="calibrate" data-owner-only="true"/);
  assert.match(league, /\$\{me\.owner \? `[\s\S]*?href="\/league\/tools#calibrate"/);
  const entry = quick.slice(quick.indexOf("function enterMode("), quick.indexOf("async function openSavedFaceFromLibrary"));
  assert.ok(entry.indexOf("!canUseOwnerTools(quickAccess, quickOwnerId)") < entry.indexOf("mode = next"));
  const cal = quick.slice(quick.indexOf("function renderFaceSlots"), quick.indexOf("function renderRatingEdit"));
  assert.match(cal, /if \(!canUseOwnerTools\(quickAccess, quickOwnerId\)\) return/);
  assert.match(cal, /reviewMode: "calibration"/);
  assert.match(cal, /diagnostics: review\.diagnostics/);
  assert.equal([...quick.matchAll(/reviewMode: "calibration"/g)].length, 1, "regular creator/public scanning does not get the research override");
});

test("account switching clears the resolved grant before leaving the tool", () => {
  assert.match(quick, /const transition = quickOwnerScopeTransition\(previousOwner, owner\)/);
  assert.match(quick, /quickOwnerId = transition\.userId/);
  assert.doesNotMatch(quick, /quickOwnerId = owner;/);
  const changed = quick.slice(quick.indexOf("if (changed) {"), quick.indexOf("location.reload()"));
  assert.ok(changed.indexOf("quickAccess = null") < changed.indexOf("leaveMode()"));
});

test("calibration records explicit anonymous reference IDs separately from private labels", () => {
  const form = quick.slice(quick.indexOf("function renderRatingStep("), quick.indexOf("function renderVerdictStep("));
  assert.match(form, /id="q-cal-reference"/);
  assert.match(form, /referenceId = calibrationReferenceId\(reference\.value\)/);
  assert.match(form, /\{\s*referenceId,\s*ratingTarget: verdict\.ratingTarget,\s*captureScores: verdict\.captureScores,\s*thumb:/);
  assert.doesNotMatch(form, /calibrationReferenceId\(label\.value\)/);
});

test("League uses staff access independently of a pending creator application", () => {
  assert.match(league, /const entry = leagueEntry\(staff, row\?\.status \?\? null\)/);
  assert.match(league, /if \(entry === "staff"\)[\s\S]*?synthetic_staff: true/);
});

test("front calibration carries the upload fingerprint through the pending capture and clears it on reset", () => {
  assert.match(quick, /await run\(c, generation, f, referenceSex\)/);
  assert.match(quick, /if \(mode === "calibrate"\) \{\s*try \{\s*imageSource = await fingerprintCalibrationImage\(src, \{ originalFile: sourceFile \}\)/);
  assert.match(quick, /pendingFrontImageSource = last\?\.imageSource/);
  assert.match(quick, /imageSource: pendingFrontImageSource/);
  const reset = quick.slice(quick.indexOf("function clearPending("), quick.indexOf("function renderFaceSlots("));
  assert.match(reset, /pendingFrontImageSource = undefined/);
  assert.match(quick, /imageSource: review\.imageSource/);
});

test("saved-set display and both exports fail visibly on unreadable storage", () => {
  const view = quick.slice(quick.indexOf("function renderCalibrationSet("), quick.indexOf("const wait ="));
  assert.equal([...view.matchAll(/loadCalibrationSetForExport\(\)/g)].length, 3);
  assert.doesNotMatch(view, /loadCalibrationSet\(\)/);
  assert.match(view, /Saved set unavailable/);
  assert.match(view, /Do not clear your browser data/);
  assert.match(view, /The diagnostics could not be exported/);
  assert.match(view, /The corpus could not be read/);
});

test("pilot filename hints are per-capture and reviewed exceptions need explicit acknowledgement", () => {
  const reset = quick.slice(quick.indexOf("function clearPending("), quick.indexOf("async function changeCalibrationReference("));
  assert.match(reset, /pendingFrontFileReference = undefined/);
  assert.match(reset, /pendingSideFileReference = undefined/);
  assert.match(quick, /pendingFrontFileReference = sourceFile \? calibrationFileReference\(sourceFile\.name\) : undefined/);
  assert.match(quick, /if \(sex && !signal\.aborted\) acceptedFileReference = calibrationFileReference\(file\.name\)/);
  const form = quick.slice(quick.indexOf("function renderRatingStep("), quick.indexOf("function renderVerdictStep("));
  assert.match(form, /reference\.value = suggestedCalibrationReference/);
  assert.match(form, /reference\.oninput = \(\) => \{\s*captureConfirm\.checked = false/);
  assert.match(form, /acknowledgedCaptureWarnings: captureConfirm\.checked && !captureWarning\.classList\.contains\("hidden"\) \? displayedWarningCodes : \[\]/);
  assert.match(form, /error instanceof CalibrationCaptureReviewRequired/);
  assert.match(form, /item\.textContent = message/);
});
