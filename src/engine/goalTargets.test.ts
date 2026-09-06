import test from "node:test";
import assert from "node:assert/strict";
import { activateScanOwner } from "./scanScope.js";
import { assessTargetProgress, clearGoalTargetDraft, createGoalTargetDraft, draftMatchesPlan, heldTargetRenderState, parseGoalTargetDraft, readGoalTargetDraft, saveGoalTargetDraft } from "./goalTargets.js";
import type { MorphBlueprint } from "./morphPlan.js";
import { buildMorphBlueprint } from "./morphPlan.js";
import { scoreFrontMeasurements } from "./scoring.js";
import { EMPTY_PROFILE } from "./goals.js";

const scanId = "12345678-1234-4234-8234-123456789012";
const plan = () => ({
  version: 1, variant: "selected", sex: "male", hasFront: true, hasSide: false,
  goals: [{ id: "jaw", label: "Jaw", targetIds: ["jawCheekRatio"], measurable: true, views: ["front"], timeframe: "", effortPoints: 0, visualSummary: "Posture" }],
  targets: [{ id: "jawCheekRatio", name: "Jaw : cheekbone width", view: "front", current: 0.98, target: 0.965, decimals: 3, unit: "", completionDelta: 0, goalIds: ["jaw"] }],
  effects: {}, totalPoints: 0,
}) as MorphBlueprint;

test("a draft freezes its accepted baseline and target, not a mutable plan object", () => {
  const p = plan();
  const draft = createGoalTargetDraft(p, scanId)!;
  p.targets[0].current = 0.975;
  p.targets[0].target = 0.960;
  assert.equal(draft.targets[0].current, 0.98);
  assert.equal(draft.targets[0].target, 0.965);
  assert.equal(draft.status, "illustrative");
  assert.equal(draftMatchesPlan(draft, p), true);
});

test("changed goal sets, units, methods and invalid data cannot become current targets", () => {
  const d = createGoalTargetDraft(plan(), scanId)!;
  assert.equal(draftMatchesPlan(d, { ...plan(), goals: [] }), false);
  const p = plan(); p.targets[0].unit = "ratio";
  assert.equal(draftMatchesPlan(d, p), false);
  assert.equal(parseGoalTargetDraft({ ...d, scoreVersion: -1 }), null);
  assert.equal(parseGoalTargetDraft({ ...d, status: "verified" }), null);
  assert.equal(parseGoalTargetDraft({ ...d, targets: [{ ...d.targets[0], target: Infinity }] }), null);
  assert.equal(createGoalTargetDraft({ ...plan(), variant: "max_vision" }, scanId), null);
});

test("draft storage is isolated between accounts and rejects stale-owner writes", () => {
  const values = new Map<string, string>();
  const prior = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => { values.set(k, v); },
    removeItem: (k: string) => { values.delete(k); },
  } });
  try {
    const alice = activateScanOwner("alice");
    const d = createGoalTargetDraft(plan(), scanId)!;
    assert.equal(saveGoalTargetDraft(d, alice), true);
    activateScanOwner("bob");
    assert.equal(readGoalTargetDraft(), null);
    assert.equal(saveGoalTargetDraft(d, alice), false);
    assert.equal(clearGoalTargetDraft(alice), false);
    activateScanOwner("alice");
    assert.equal(readGoalTargetDraft()?.targets[0].target, 0.965);
    assert.equal(clearGoalTargetDraft(alice), true);
    assert.equal(readGoalTargetDraft(), null);
    activateScanOwner(null);
    assert.equal(saveGoalTargetDraft(d, "anonymous:example"), false);
  } finally {
    if (prior) Object.defineProperty(globalThis, "localStorage", prior);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("stored targets cannot introduce excluded metrics, unknown goals or noncanonical units", () => {
  const draft = createGoalTargetDraft(plan(), scanId)!;
  for (const change of [
    { id: "jawFrontalAngle", unit: "°", decimals: 1 },
    { unit: "invented" }, { decimals: 6 }, { view: "side" }, { goalIds: ["skin"] },
  ]) assert.equal(parseGoalTargetDraft({ ...draft, targets: [{ ...draft.targets[0], ...change }] }), null);
  assert.equal(parseGoalTargetDraft({ ...draft, goalIds: ["fake_goal"] }), null);
  const labelled = parseGoalTargetDraft({ ...draft, targets: [{ ...draft.targets[0], name: "A client-written claim" }] });
  assert.equal(labelled?.targets[0].name, "Jaw : cheekbone width");
  const forged = { ...draft, targets: [{ ...draft.targets[0], id: "jawFrontalAngle", unit: "°", decimals: 1 }] };
  assert.equal(draftMatchesPlan(forged, { ...plan(), targets: [] }), false);
});

test("fixed targets keep their destination but only supported remaining edits reach a render", () => {
  const draft = createGoalTargetDraft(plan(), scanId)!;
  const fresh = (value: number) => {
    const report = scoreFrontMeasurements({ jawCheekRatio: value }, "male");
    return { report, plan: buildMorphBlueprint(report, { ...EMPTY_PROFILE, goals: ["jaw"] }, "selected", false) };
  };
  const improving = fresh(0.975);
  const safe = heldTargetRenderState(draft, improving.plan, improving.report, false);
  assert.equal(safe.renderHoldReason, undefined);
  assert.equal(safe.targets[0].current, 0.975);
  assert.equal(safe.targets[0].target, 0.965);
  const past = fresh(0.95);
  const reached = heldTargetRenderState(draft, past.plan, past.report, false);
  assert.deepEqual(reached.reachedIds, ["jawCheekRatio"]);
  assert.deepEqual(reached.targets, []);
  assert.match(reached.renderHoldReason!, /does not confirm/);
  const worse = fresh(1.05);
  const held = heldTargetRenderState(draft, worse.plan, worse.report, false);
  assert.deepEqual(held.heldIds, ["jawCheekRatio"]);
  assert.deepEqual(held.targets, []);
  assert.match(held.renderHoldReason!, /stay fixed/);
  assert.equal(draft.targets[0].current, 0.98);
  assert.equal(draft.targets[0].target, 0.965);
});

test("progress requires calibrated noise and comparable repeated evidence", () => {
  const sample = { baseline: 10, target: [4, 6] as const, readings: [8, 8.2], noiseFloor: 0.5, comparable: true };
  assert.deepEqual(assessTargetProgress({ ...sample, noiseFloor: null }), { status: "unable_to_assess", progress: null });
  assert.equal(assessTargetProgress({ ...sample, comparable: false }).status, "unable_to_assess");
  assert.equal(assessTargetProgress({ ...sample, readings: [7] }).status, "needs_repeat");
  assert.equal(assessTargetProgress({ ...sample, readings: [10, 10, 5] }).status, "needs_repeat");
  assert.equal(assessTargetProgress(sample).status, "confirmed");
  assert.equal(assessTargetProgress({ ...sample, readings: [6, 5, 10] }).progress, 1);
  assert.equal(assessTargetProgress({ ...sample, baseline: 6 }).status, "unable_to_assess");
});
