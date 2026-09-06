import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldAskSideCorrectionConsent } from "./sideFeedbackPayload.js";

test("No then manual correction still asks for optional feedback consent", () => {
  // A No about placement is not an answer about sharing the photograph.
  assert.equal(shouldAskSideCorrectionConsent(false, null, 2), true);
});

test("an explicit sharing answer is never asked again during correction", () => {
  assert.equal(shouldAskSideCorrectionConsent(false, false, 2), false);
  assert.equal(shouldAskSideCorrectionConsent(false, true, 2), false);
});

test("untouched and already prompted automatic placement do not add a consent ask", () => {
  assert.equal(shouldAskSideCorrectionConsent(false, null, 0), false);
  assert.equal(shouldAskSideCorrectionConsent(true, null, 2), false);
});

test("automatic answers are remembered before a fallback to manual correction", () => {
  const source = readFileSync(new URL("../ui/sideFlow.ts", import.meta.url), "utf8");
  const automatic = source.slice(source.indexOf("const afterAutomatic ="), source.indexOf("const releaseFurniture ="));
  assert.equal(automatic.match(/consentAnswer = await askSideFeedbackConsent\(\)/g)?.length, 2);
  assert.match(automatic, /verified: true, consented: consentAnswer/);
  assert.match(automatic, /verified: false, consented: consentAnswer/);
  assert.match(source, /shouldAskSideCorrectionConsent\(Boolean\(opts\.auto\), consentAnswer, moved\.length\)/);
  assert.doesNotMatch(source, /!flaggedWrong && consentAnswer/);
});
