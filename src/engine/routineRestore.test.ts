import assert from "node:assert/strict";
import test from "node:test";
import { reconcileRoutineSnapshots } from "./routineRestore.js";
import { dedupeCoachingRoutines, mergeCoachingRoutine } from "./coachingSnapshot.js";
import type { CoachingRoutine } from "./coachingSnapshot.js";
import { adherenceFromTicks } from "./protocol.js";

const routine: CoachingRoutine = { id: "sleep-1700000000000", title: "Consistent sleep timing", status: "running",
  startedAt: 1700000000000, weeksToReview: 4, tickDays: ["2026-09-09"], checkIns: [{ at: 1700000001000, using: true, noticing: null }],
  restore: { recId: "sleep", offeredAt: 1700000000000, startBy: 1700000100000, metricId: "", start: "commit" } };

test("an empty device restores the saved identity/state and marks bounded history as partial", () => {
  const restored = reconcileRoutineSnapshots([], [routine]);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, routine.id);
  assert.equal(restored[0].status, "running");
  assert.equal(restored[0].startedAt, routine.startedAt);
  assert.equal(restored[0].startBy, routine.restore!.startBy);
  assert.equal(restored[0].historyPartial, true);
  assert.equal(adherenceFromTicks(restored[0], Date.now()), null);
  assert.deepEqual(reconcileRoutineSnapshots(restored, [routine]), restored);
});

test("restoration never starts an offered or committed action or revives terminal state", () => {
  for (const status of ["offered", "committed", "declined", "judged"] as const) {
    const [restored] = reconcileRoutineSnapshots([], [{ ...routine, status, startedAt: null }]);
    assert.equal(restored.status, status);
    assert.equal(restored.startedAt, null);
  }
  const [completed] = reconcileRoutineSnapshots([], [{ ...routine, status: "judged" }]);
  assert.equal(reconcileRoutineSnapshots([completed], [routine])[0].status, "judged");
});

test("a device with full history keeps it while absorbing terminal server state", () => {
  const [restored] = reconcileRoutineSnapshots([], [routine]);
  const local = { ...restored, ticks: ["2026-09-01", "2026-09-02"], historyPartial: false };
  const [merged] = reconcileRoutineSnapshots([local], [{ ...routine, status: "judged" }]);
  assert.equal(merged.status, "judged");
  assert.deepEqual(merged.ticks, ["2026-09-01", "2026-09-02", "2026-09-09"]);
  assert.equal(merged.historyPartial, false);
});

test("two offline additions to one catalogue action become one tracker without losing terminal state", () => {
  const second = { ...routine, id: "sleep-1700000005000", status: "judged" as const };
  assert.equal(dedupeCoachingRoutines([second, routine]).length, 1);
  assert.equal(dedupeCoachingRoutines([second, routine])[0].status, "judged");
  const [local] = reconcileRoutineSnapshots([], [second]);
  const merged = reconcileRoutineSnapshots([local], [routine]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, routine.id);
  assert.equal(merged[0].status, "judged");
});

test("a stale device cannot undo a postponed start in server or device merges", () => {
  const postponed = { ...routine, status: "committed" as const, startedAt: null,
    restore: { ...routine.restore!, startBy: 1700000900000 } };
  const old = { ...routine, status: "committed" as const, startedAt: null };
  assert.equal(mergeCoachingRoutine(postponed, old).restore!.startBy, postponed.restore.startBy);
  assert.equal(mergeCoachingRoutine(old, postponed).restore!.startBy, postponed.restore.startBy);
  const [local] = reconcileRoutineSnapshots([], [old]);
  assert.equal(reconcileRoutineSnapshots([local], [postponed])[0].startBy, postponed.restore.startBy);
});

test("plain notes, unknown definitions, malformed identities and missing running dates are not invented actions", () => {
  assert.deepEqual(reconcileRoutineSnapshots([], [{ title: "Add that" }, { ...routine, restore: { ...routine.restore, recId: "unknown-product" } },
    { ...routine, status: "running", startedAt: null }, { ...routine, id: "some-note", restore: undefined }]), []);
  const [legacy] = reconcileRoutineSnapshots([], [{ ...routine, restore: undefined }]);
  assert.equal(legacy.recId, "sleep");
  assert.equal(legacy.startBy, null, "legacy dates are not guessed");
});
