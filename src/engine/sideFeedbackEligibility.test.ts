import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sideFeedbackEligible } from "./sideFeedbackEligibility.js";

const adultSelf = { knownAdult: true, subjectAsked: true, isGuest: false, owner: "user:alice", profileOwner: "alice" };

test("a signed-in adult can contribute only after the scan is explicitly their own", () => {
  assert.equal(sideFeedbackEligible(adultSelf), true);
  for (const changed of [
    { knownAdult: false }, { subjectAsked: false }, { isGuest: true },
    { owner: null }, { owner: "anonymous:alice" }, { owner: "user:bob" },
    { profileOwner: null }, { profileOwner: "bob" },
  ]) assert.equal(sideFeedbackEligible({ ...adultSelf, ...changed }), false, JSON.stringify(changed));
});

test("restored unknown attribution and guest reclassification cannot reuse an old own-face intent", () => {
  let state = { ...adultSelf, subjectAsked: false };
  assert.equal(sideFeedbackEligible(state), false);
  state = { ...state, subjectAsked: true, isGuest: true };
  assert.equal(sideFeedbackEligible(state), false);
  state = { ...state, isGuest: false };
  assert.equal(sideFeedbackEligible(state), true);
});

test("fresh capture, post-report correction and delayed submission use the same live eligibility gate", () => {
  const source = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
  assert.equal([...source.matchAll(/feedbackEligible: currentSideFeedbackEligible\(\)/g)].length, 2);
  const submit = source.slice(source.indexOf("async function submitConsentedSideFeedback"), source.indexOf("// Both photographs are in."));
  assert.ok(submit.indexOf("if (!currentSideFeedbackEligible()) return;") < submit.indexOf("submitSideCorrectionFeedback("));
  const gate = source.slice(source.indexOf("function currentSideFeedbackEligible"), source.indexOf("async function submitConsentedSideFeedback"));
  assert.match(gate, /knownAdult, subjectAsked, isGuest: scanSubject !== null/);
  assert.match(gate, /owner: activeScanOwner\(\), profileOwner: knownProfileOwner/);
  const redo = source.slice(source.indexOf("onRedoSide: () =>"), source.indexOf("onSexChange: (sex: Sex)"));
  assert.ok(redo.indexOf("if (!scanIsCurrent(token, generation)") < redo.indexOf("photo: review.photo"));
});
