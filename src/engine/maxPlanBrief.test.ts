import test from "node:test";
import assert from "node:assert/strict";
import { cleanCoachPlanBrief, coachPlanQuestion, saveCoachPlanBrief } from "./maxPlanBrief.js";
import { EMPTY_PROFILE, loadProfile, saveProfile } from "./goals.js";
import { activateScanOwner } from "./scanScope.js";

test("brief is bounded and only known goals survive", () => {
  const brief = cleanCoachPlanBrief({ goals: ["skin", "skin", "fake", "jaw", "hair", "eyes"], endGoal: "x".repeat(200), currentRoutine: "y".repeat(500) });
  assert.deepEqual(brief.goals, ["skin", "jaw", "hair"]);
  assert.equal(brief.endGoal.length, 140);
  assert.equal(brief.currentRoutine.length, 170);
  const question = coachPlanQuestion(brief);
  assert.ok(question.length <= 600);
  assert.match(question, /Skin quality, Sharper jawline, Hair/);
  assert.match(question, /Do not save new routines yet\./);
});

test("no chosen goal invites clarification rather than choosing their lowest score", () => {
  const question = coachPlanQuestion({ goals: [], endGoal: "", currentRoutine: "" });
  assert.match(question, /Help me choose a focus first/);
  assert.doesNotMatch(question, /lowest|weakest|point|ideal/);
});

test("brief accepts malformed or older device profile fields without throwing", () => {
  for (const value of [null, [], { goals: null, endGoal: {} }, { goals: "skin", currentRoutine: 3 }]) {
    assert.deepEqual(cleanCoachPlanBrief(value), { goals: [], endGoal: "", currentRoutine: "" });
  }
  assert.deepEqual(cleanCoachPlanBrief({ goals: [null, 7, "skin"], endGoal: " Simple " }), {
    goals: ["skin"], endGoal: "Simple", currentRoutine: "",
  });
});

test("save preserves other quiz fields and refuses account changes and failed storage", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const data = new Map<string, string>();
  let fail = false;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { if (fail) throw new Error("full"); data.set(key, value); },
  } });
  try {
    const owner = activateScanOwner("brief-user");
    saveProfile({ ...EMPTY_PROFILE, skin: ["dryness"], quiet: ["nose"], preDone: true });
    const brief = { goals: ["skin"], endGoal: "Keep things simple", currentRoutine: "My product list" };
    assert.equal(saveCoachPlanBrief(brief, owner), true);
    assert.deepEqual(loadProfile().skin, ["dryness"]);
    assert.deepEqual(loadProfile().quiet, ["nose"]);
    assert.equal(loadProfile().preDone, true);
    assert.doesNotMatch([...data.values()].join(""), /My product list/);
    fail = true;
    assert.equal(saveCoachPlanBrief({ ...brief, endGoal: "changed" }, owner), false);
    activateScanOwner("different-user");
    assert.equal(saveCoachPlanBrief(brief, owner), false);
    assert.deepEqual(loadProfile().goals, []);
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
    activateScanOwner(null);
  }
});
