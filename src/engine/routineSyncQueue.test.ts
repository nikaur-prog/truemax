import assert from "node:assert/strict";
import test from "node:test";
import { activateScanOwner } from "./scanScope.js";
import { queueRoutineSync, readPendingRoutineSync, acknowledgeRoutineSync, routineSyncStatus } from "./routineSyncQueue.js";
import type { CoachingRoutine } from "./coachingSnapshot.js";

const routine: CoachingRoutine = { id: "sleep-1700000000000", title: "Sleep", status: "running", startedAt: 1700000000000,
  weeksToReview: 4, tickDays: ["2026-09-09"], checkIns: [] };

test("durable queue is owner scoped, bounded and monotonic; late acknowledgement cannot clear a newer revision", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  let fail = false;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { if (fail) throw new Error("quota"); values.set(key, value); },
    removeItem: (key: string) => values.delete(key),
  } });
  try {
    const owner = activateScanOwner("a");
    const first = queueRoutineSync([routine], owner)!;
    assert.equal(queueRoutineSync([routine], owner)!.revision, first.revision, "unchanged snapshots do not rewrite the queue");
    const second = queueRoutineSync([{ ...routine, status: "judged", tickDays: ["2026-09-10"] }], owner)!;
    acknowledgeRoutineSync(first.revision, owner);
    assert.equal(readPendingRoutineSync(owner)!.revision, second.revision);
    const stale = queueRoutineSync([routine], owner)!;
    assert.equal(stale.items[0].status, "judged");
    assert.deepEqual(stale.items[0].tickDays, ["2026-09-09", "2026-09-10"]);
    activateScanOwner("b");
    assert.equal(routineSyncStatus(), "no-pending");
    assert.throws(() => acknowledgeRoutineSync(stale.revision, owner), /account changed/);
    activateScanOwner("a");
    assert.equal(routineSyncStatus(), "pending");
    assert.throws(() => queueRoutineSync(Array.from({ length: 41 }, (_, i) => ({ ...routine, id: `routine-${i}` })), owner), /Too many/);
    assert.equal(readPendingRoutineSync(owner)!.revision, stale.revision);
    fail = true;
    assert.throws(() => queueRoutineSync([{ ...routine, title: "Changed" }], owner), /quota/);
    fail = false;
    acknowledgeRoutineSync(stale.revision, owner);
    assert.equal(routineSyncStatus(), "no-pending");
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original); else Reflect.deleteProperty(globalThis, "localStorage");
    activateScanOwner(null);
  }
});
