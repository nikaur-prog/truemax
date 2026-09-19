import assert from "node:assert/strict";
import test from "node:test";
import { hydrateRoutineContext, loadRoutineMemory, mergeRoutineEvidence, routineSyncRows, syncRoutineMemory } from "./_maxRoutineSync.js";
import { sanitiseCoachingSnapshot } from "../src/engine/coachingSnapshot.js";
import type { CoachingRoutine, CoachingSnapshot } from "../src/engine/coachingSnapshot.js";

const routine: CoachingRoutine = { id: "sleep-123", title: "Regular bedtime", status: "running", startedAt: 1700000000000, weeksToReview: 8, tickDays: ["2026-09-08"], checkIns: [] };

test("routine identity survives title edits and all lifecycle states map explicitly", () => {
  const states = { offered: "paused", committed: "paused", running: "active", declined: "replaced", judged: "completed" } as const;
  for (const [status, expected] of Object.entries(states)) {
    const row = routineSyncRows([{ ...routine, status }], "owner-a", "now")[0];
    assert.equal(row.user_id, "owner-a");
    assert.equal(row.normalized_title, "protocol:sleep-123");
    assert.equal(row.status, expected);
    assert.equal(JSON.parse(row.notes).protocol.startedAt, routine.startedAt);
  }
  assert.equal(routineSyncRows([{ ...routine, title: "New label" }], "owner-a", "now")[0].normalized_title, "protocol:sleep-123");
  assert.deepEqual(routineSyncRows([{ title: "Legacy title without a routine id" }], "owner-a", "now"), []);
});

test("stale routine snapshots cannot restart a reviewed routine and recent evidence is merged", () => {
  const merged = mergeRoutineEvidence({ ...routine, status: "judged", tickDays: ["2026-09-09"] }, routine);
  assert.equal(merged.status, "judged");
  assert.deepEqual(merged.tickDays, ["2026-09-08", "2026-09-09"]);
  assert.equal(mergeRoutineEvidence(routine, { ...routine, status: "offered", startedAt: null }).status, "running");
  assert.equal(mergeRoutineEvidence(routine, { ...routine, status: "offered", startedAt: null }).startedAt, routine.startedAt);
});

test("maximum bounded routine notes fit the existing database column", () => {
  const noisy = { ...routine, id: "x".repeat(80), title: '\\"'.repeat(60), weeksToReview: 100.12345678912345,
    restore: { recId: "x".repeat(40), metricId: "x".repeat(40), start: "instant", offeredAt: 8.64e15, startBy: 8.64e15 },
    tickDays: Array.from({ length: 7 }, (_, i) => `2026-09-0${i + 1}`),
    checkIns: Array.from({ length: 3 }, (_, i) => ({ at: 8.64e15 - i, using: false, noticing: false })) };
  assert.ok(routineSyncRows([noisy], "owner-a", "now")[0].notes.length <= 1000);
});

function scriptedAdmin(responses: unknown[]) {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const admin = { from(table: string) {
    calls.push({ op: "from", args: [table] });
    const chain: Record<string, unknown> = {};
    for (const op of ["select", "eq", "in", "is", "insert", "update", "maybeSingle", "like", "order", "limit"]) chain[op] = (...args: unknown[]) => { calls.push({ op, args }); return chain; };
    chain.then = (resolve: (value: unknown) => void) => {
      assert.ok(responses.length, "unexpected extra query");
      resolve(responses.shift());
    };
    return chain;
  } } as unknown as Parameters<typeof syncRoutineMemory>[0];
  return { admin, calls };
}
const ok = (data: unknown = []) => ({ data, error: null });
const stored = (value: CoachingRoutine) => ({ id: "db-1", ...routineSyncRows([value], "owner-a", "now")[0] });

test("sync queries are owner-scoped and legacy retirement is exact, not a deletion", async () => {
  const { admin, calls } = scriptedAdmin([ok(), ok([{ id: "db-1" }]), ok()]);
  assert.equal((await syncRoutineMemory(admin, "owner-a", [routine])).length, 1);
  assert.equal(calls.filter((call) => call.op === "eq" && call.args[0] === "user_id" && call.args[1] === "owner-a").length, 2);
  assert.ok(calls.some((call) => call.op === "is" && call.args[0] === "source_conversation_id" && call.args[1] === null));
  assert.ok(calls.some((call) => call.op === "eq" && call.args[0] === "notes" && call.args[1] === ""));
  assert.ok(calls.some((call) => call.op === "in" && JSON.stringify(call.args[1]) === '["regular bedtime"]'));
  const insert = calls.find((call) => call.op === "insert")!;
  assert.equal((insert.args[0] as { user_id: string }).user_id, "owner-a");
});

test("concurrent completion wins after an update compare-and-set loses", async () => {
  const initial = stored({ ...routine, tickDays: [] });
  const completed = stored({ ...routine, status: "judged", tickDays: ["2026-09-09"] });
  const { admin, calls } = scriptedAdmin([ok([initial]), ok(), ok(completed), ok([{ id: "db-1" }]), ok()]);
  const synced = await syncRoutineMemory(admin, "owner-a", [routine]);
  assert.equal(synced[0].status, "judged");
  assert.deepEqual(synced[0].tickDays, ["2026-09-08", "2026-09-09"]);
  assert.ok(calls.some((call) => call.op === "eq" && call.args[0] === "notes" && call.args[1] === initial.notes));
  assert.ok(calls.some((call) => call.op === "eq" && call.args[0] === "status" && call.args[1] === "completed"));
  assert.ok(calls.some((call) => call.op === "eq" && call.args[0] === "id" && call.args[1] === "db-1"));
});

test("a unique insert race refetches without restarting a completed routine", async () => {
  const completed = stored({ ...routine, status: "judged" });
  const { admin, calls } = scriptedAdmin([ok(), { data: null, error: { code: "23505", message: "duplicate" } }, ok(completed), ok()]);
  assert.equal((await syncRoutineMemory(admin, "owner-a", [routine]))[0].status, "judged");
  assert.equal(calls.filter((call) => call.op === "update").length, 1, "only legacy retirement, not a stale update");
});

test("repeated compare-and-set losses fail explicitly instead of claiming success", async () => {
  const initial = stored({ ...routine, tickDays: [] });
  const { admin } = scriptedAdmin([ok([initial]), ok(), ok(initial), ok(), ok(initial), ok(), ok(initial)]);
  await assert.rejects(syncRoutineMemory(admin, "owner-a", [routine]), /changed on another device/);
});

test("restoration reads owner-scoped action records with terminal states, not chat notes", async () => {
  const { admin, calls } = scriptedAdmin([ok([{ ...stored(routine), status: "completed" },
    { ...stored(routine), normalized_title: "ordinary-note" }, { ...stored(routine), notes: "free text" }])]);
  const result = await loadRoutineMemory(admin, "owner-a");
  assert.equal(result.length, 1);
  assert.equal(result[0].status, "judged");
  assert.ok(calls.some((call) => call.op === "eq" && call.args[0] === "user_id" && call.args[1] === "owner-a"));
  assert.ok(calls.some((call) => call.op === "is" && call.args[0] === "source_conversation_id" && call.args[1] === null));
  assert.ok(calls.some((call) => call.op === "like" && call.args[1] === "protocol:%"));
});

test("restoration refuses a truncated action set instead of silently dropping terminal records", async () => {
  const { admin } = scriptedAdmin([ok(Array.from({ length: 201 }, () => stored(routine)))]);
  await assert.rejects(loadRoutineMemory(admin, "owner-a"), /too large/);
});

test("server context hydrates saved routines for a client without coaching context", async () => {
  const { admin } = scriptedAdmin([ok([stored({ ...routine, status: "judged" })])]);
  const context: { coaching?: CoachingSnapshot; activePlan: string[] } = { activePlan: ["Regular bedtime: running"] };
  await hydrateRoutineContext(context, admin, "owner-a", "now");
  assert.equal(context.coaching!.routines[0].status, "judged");
  assert.deepEqual(context.activePlan, [], "stale device labels cannot contradict server state");
});

test("routine hydration retains selected preferences but replaces device plan notes", async () => {
  const { admin } = scriptedAdmin([ok([stored({ ...routine, status: "declined" })])]);
  const context = { coaching: sanitiseCoachingSnapshot({ goals: ["Better sleep"], routines: [] })!, activePlan: ["Old product: active"] };
  await hydrateRoutineContext(context, admin, "owner-a", "now");
  assert.deepEqual(context.coaching.goals, ["Better sleep"]);
  assert.equal(context.coaching.routines[0].status, "declined");
  assert.deepEqual(context.activePlan, []);
});
