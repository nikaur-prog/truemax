import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scanConfirmPreviewSize } from "./scanConfirm.js";

test("the front review copy is bounded instead of duplicating a full phone canvas", () => {
  assert.deepEqual(scanConfirmPreviewSize(2160, 2880), { width: 780, height: 1040 });
  assert.deepEqual(scanConfirmPreviewSize(720, 960), { width: 720, height: 960 });
  assert.deepEqual(scanConfirmPreviewSize(0, 0), { width: 0, height: 0 });
});

test("a captured front is accepted before the optional side decision", () => {
  const src = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
  const captured = src.indexOf('title: "Happy with this front photo?"');
  const armed = src.lastIndexOf('armLeaveGuard("scan")', captured);
  const accepted = src.indexOf("if (!accepted)", captured);
  const optional = src.indexOf('title: "And now the side photo"', accepted);
  const side = src.indexOf("if (takeSide) {", optional);
  const frontOnly = src.indexOf("await gateAnalysis(null, token)", side);
  assert.ok(armed > 0 && captured > armed && accepted > captured && optional > accepted);
  assert.ok(side > optional && frontOnly > side);
  assert.match(src.slice(captured, optional), /preview: frontShot/);
});

test("backing out of the profile step never strands a completed front scan", () => {
  const src = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
  const review = src.indexOf("function showFrontReview()");
  const skip = src.indexOf('id="front-skip-side"', review);
  const skipHandler = src.indexOf('getElementById("front-skip-side")', skip);
  const frontOnly = src.indexOf("void gateAnalysis(null, token)", skipHandler);
  const permission = src.indexOf("await prepareSidePlacementChoice()", frontOnly);
  const cancelledConsentFallback = src.indexOf("await gateAnalysis(null, token)", permission);

  assert.ok(review > 0 && skip > review && skipHandler > skip && frontOnly > skipHandler);
  assert.ok(permission > frontOnly && cancelledConsentFallback > permission);
});

test("mobile scan exits use app UI, while refresh keeps the browser guard", () => {
  const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
  const results = readFileSync(new URL("./results.ts", import.meta.url), "utf8");
  assert.doesNotMatch(main, /window\.confirm\("Leave this report/);
  assert.doesNotMatch(results, /window\.confirm\("Start over with a new photo/);
  assert.match(main, /window\.addEventListener\("beforeunload"/);
  assert.match(main, /closeScanConfirm\(\);\s*disarmLeaveGuard\(\);/);
});

test("side review offers retake and skip at the preview and correction steps", () => {
  const src = readFileSync(new URL("./sideFlow.ts", import.meta.url), "utf8");
  assert.match(src, /retakeButton\.textContent = "Take another side photo"/);
  assert.match(src, /skipButton\.textContent = "Skip side and see front analysis"/);
  assert.match(src, /if \(ctx\.onSkip\)/);
  assert.match(src, /if \(exitCtx\) appendSideExitActions\(backdrop\.querySelector\("section"\)!, exitCtx\)/);
  assert.match(src, /if \(opts\.exitCtx\) appendSideExitActions/);
  const guided = src.slice(src.indexOf("const showGuidedActions"), src.indexOf("const showReviewActions"));
  assert.match(guided, /appendSideExitActions\(e.actions, ctx\)/);
  const review = src.slice(src.indexOf("const showReviewActions"), src.indexOf("const confirmPlacement"));
  assert.match(review, /appendSideExitActions\(e.actions, ctx\)/);
});

test("skipping the side routes the owned front to analysis without a side result", () => {
  const src = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
  const flow = src.slice(src.indexOf("function startSide()"));
  const skip = flow.slice(flow.indexOf("onSkip:"), flow.indexOf("onDone:"));
  assert.match(skip, /scanSession.isCurrent\(token\)/);
  assert.match(skip, /lastSide = null/);
  assert.match(skip, /gateAnalysis\(null, token\)/);
  assert.doesNotMatch(skip, /resetToUpload|onDone\(/);
});

test("side readers use an owned snapshot with cancellation and no artificial delay", () => {
  const src = readFileSync(new URL("./sideFlow.ts", import.meta.url), "utf8");
  assert.match(src, /seedSidePointsSmart\(\s*snapshot,/);
  assert.match(src, /cloudPlacementFor\(snapshot, localResult, signal\)/);
  assert.match(src, /if \(!sideAttempt.current\(signal\)\) return/);
  assert.doesNotMatch(src, /READ_BEAT_MS/);
});

test("retake removes the old preview's invisible action state", () => {
  const src = readFileSync(new URL("./sideFlow.ts", import.meta.url), "utf8");
  const capture = src.slice(src.indexOf("export function openSideCapture"), src.indexOf("function skipSide"));
  assert.match(capture, /e\.actions\.classList\.remove\("mode-pending", "guided-row"\)/);
});

test("optional feedback never blocks report paint and uses scan cancellation", () => {
  const src = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /await feedbackInFlight/);
  assert.match(src, /signal: scanWorkAbort.signal/);
  assert.match(src, /durationPolicy: "interactive"/);
  const pass = src.slice(src.indexOf("async function playMeasurePass"), src.indexOf("async function runFullAnalysis"));
  assert.match(pass, /paintFrontPane\(frontShot\);\s*markMeasuredOnScreen/);
});

test("draft targets require verified side baselines and reset on identity change", () => {
  const src = readFileSync(new URL("./results.ts", import.meta.url), "utf8");
  assert.match(src, /fresh.targets = fresh.targets.filter\(\(target\) => target.view !== "side" \|\| ctx!.sideVerified === true\)/);
  assert.match(src, /clearResultsIdentityState\(\): void \{\s*resultOwner = null;\s*goalDraft = null;/);
  assert.match(src, /if \(keepTargets && !gated && adultUser\)/);
});

test("direct goal panel redraw disposes a running preview before replacing its DOM", () => {
  const src = readFileSync(new URL("./results.ts", import.meta.url), "utf8");
  const panel = src.slice(src.indexOf("function showImprove(): void"));
  const dispose = panel.indexOf("detachMorphPreview?.();");
  const replace = panel.indexOf("body().innerHTML =");
  const mount = panel.indexOf("detachMorphPreview = wireMorphPreview");
  assert.ok(dispose > 0 && replace > dispose && mount > replace);
  assert.match(panel.slice(dispose, replace), /detachMorphPreview = null/);
});
