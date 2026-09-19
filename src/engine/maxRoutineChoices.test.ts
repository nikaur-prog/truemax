import assert from "node:assert/strict";
import test from "node:test";
import { coachRoutineChoices, addSelectedCoachRoutine } from "./maxRoutineChoices.js";
import { EMPTY_PROFILE } from "./goals.js";
import { RECS } from "./recommendations.js";
import { activateScanOwner } from "./scanScope.js";
import { readProtocols } from "./protocol.js";

test("basic routine choices respect preferences and never assume an adult body profile", () => {
  const profile = { ...EMPTY_PROFILE, goals: ["muscle", "bodyfat", "eyes", "skin", "grooming"], skin: ["sensitive"] };
  const choices = coachRoutineChoices(profile, []);
  assert.ok(choices.some((rec) => rec.id === "sleep"));
  assert.ok(choices.every((rec) => !rec.guardian && !rec.otc && rec.channel !== "diet" && !rec.goals.includes("bodyfat") && !rec.goals.includes("muscle")));
  assert.deepEqual(coachRoutineChoices({ ...profile, advice: { diet: false, lifestyle: false, grooming: false, capture: false } }, []), []);
});

test("routine selection reads back storage and lets a partially written offer be retried", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const data = new Map<string, string>();
  let writes = 0;
  let allowedWrites = 0;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { if (++writes > allowedWrites) throw new Error("storage full"); data.set(key, value); },
  } });
  activateScanOwner("routine-test-owner");
  const rec = RECS.find((item) => item.id === "sleep")!;
  try {
    assert.equal(addSelectedCoachRoutine(rec, 1700000000000), "failed");
    assert.equal(readProtocols().length, 0);
    writes = 0; allowedWrites = 1;
    assert.equal(addSelectedCoachRoutine(rec, 1700000000000), "failed");
    assert.equal(readProtocols()[0].status, "offered");
    allowedWrites = Infinity;
    assert.equal(addSelectedCoachRoutine(rec, 1700000000000), "added");
    assert.equal(readProtocols()[0].status, "committed");
    assert.equal(readProtocols()[0].startedAt, null);
    assert.equal(addSelectedCoachRoutine(rec, 1700000000000), "existing");
    assert.equal(readProtocols().length, 1);
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
    activateScanOwner(null);
  }
});
