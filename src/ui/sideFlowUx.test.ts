import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
const flow = readFileSync(new URL("./sideFlow.ts", import.meta.url), "utf8");
const tutorial = readFileSync(new URL("./photoTutorial.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
const confirm = readFileSync(new URL("./scanConfirm.ts", import.meta.url), "utf8");

test("front capture teaches only the front; the optional side teaches after opt-in", () => {
  assert.equal(main.match(/offerTutorial\("front",/g)?.length, 2, "camera and upload both offer the front guide");
  assert.doesNotMatch(main, /offerBothTutorials/);
  assert.doesNotMatch(tutorial, /offerBothTutorials|offerTutorial\("both"/);
  const start = main.slice(main.indexOf("function startSide()"), main.indexOf("function renderQualityChips"));
  const lesson = start.indexOf('playTutorial("side", false, resolve)');
  const permission = start.indexOf("await prepareSidePlacementChoice()");
  const capture = start.lastIndexOf("openSide();");
  assert.ok(lesson > 0 && permission > lesson && capture > permission);
  assert.match(start, /if \(!tutorialSuppressed\("side"\)\)/);
  assert.match(start.slice(lesson, permission), /if \(!scanSession.isCurrent\(token\)\) return/);
  assert.match(main, /if \(takeSide\) \{\s*startSide\(\);\s*return;\s*\}\s*track\("scan-side-skipped"\);\s*await gateAnalysis\(null, token\)/);
});

test("the side choice shows a labelled example before asking for the side photo", () => {
  const invitation = main.slice(main.indexOf("const takeSide = await confirmScanAction"), main.indexOf("if (takeSide)"));
  assert.match(invitation, /example: \{\s*src: "\/tutorial\/side-do.jpg"/);
  assert.match(invitation, /caption: "Example only/);
  assert.match(invitation, /cancelLabel: "Use front only"/);
  assert.match(confirm, /caption.textContent = options.example.caption/);
  assert.match(confirm, /image.onerror = \(\) => \{ image.hidden = true; \}/);
});

test("side controls separate the decision, editing utilities and exits", () => {
  const review = flow.slice(flow.indexOf("const showReviewActions"), flow.indexOf("const confirmPlacement"));
  assert.match(review, /class="side-review-actions"/);
  assert.match(review, /class="side-review-tools"/);
  assert.match(review, /appendSideExitActions\(e.actions, ctx\)/);
  assert.match(css, /body:not\(\.cam-takeover\) #side-actions\s*\{[^}]*flex-direction: row;[^}]*flex-wrap: wrap;/s);
  assert.match(css, /\.side-review-actions, \.side-review-tools\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(css, /\.side-exit-actions\s*\{[^}]*flex: 0 0 100%/s);
  assert.match(css, /@container \(max-width: 380px\)\s*\{\s*\.side-review-actions \{ grid-template-columns: 1fr;/);
});

test("all contribution routes require an explicitly eligible adult self-scan", () => {
  assert.equal(main.match(/feedbackEligible: currentSideFeedbackEligible\(\)/g)?.length, 2, "capture and post-report correction share the same eligibility check");
  assert.equal(flow.match(/ctx\.feedbackEligible === true \? await askSideFeedbackConsent\(\) : false/g)?.length, 3);
  assert.match(flow, /if \(ctx\.feedbackEligible === true && shouldAskSideCorrectionConsent/);
  assert.match(flow, /let consented = ctx\.feedbackEligible === true &&/);
  assert.match(flow, /if \(feedback\) feedback.subjectConfirmation = "my-own-adult-face"/);
});

test("contribution needs a separate unchecked subject confirmation, never a share click", () => {
  const dialog = flow.slice(flow.indexOf("function askSideFeedbackConsent"));
  assert.match(dialog, /type="checkbox" id="side-feedback-own-face" \/>/);
  assert.doesNotMatch(dialog, /type="checkbox"[^>]*checked/);
  assert.match(dialog, /data-choice="yes" disabled/);
  assert.match(dialog, /yes.disabled = !subject.checked/);
  assert.match(dialog, /if \(choice && !subject.checked\) return/);
  assert.match(dialog, /no.focus\(\)/);
});

test("missing camera-switch markup cannot abort a side photo upload", () => {
  const stop = flow.slice(flow.indexOf("function stopSideCamera"), flow.indexOf("async function load"));
  assert.match(stop, /e.swap\?\.classList.add\("hidden"\)/);
  assert.match(stop, /if \(e.swap\) e.swap.onclick = null/);
});
