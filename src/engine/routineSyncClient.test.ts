import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { activateScanOwner, activeScanOwner } from "./scanScope.js";
import { readProtocols, writeProtocols } from "./protocol.js";
import type { Protocol } from "./protocol.js";
import { reconcileRoutineSnapshots } from "./routineRestore.js";
import { sanitiseCoachingRoutine } from "./coachingSnapshot.js";
import { queueRoutineSync, readPendingRoutineSync, routineSyncStatus, routineSnapshots, acknowledgeRoutineSync } from "./routineSyncQueue.js";

const source = readFileSync(new URL("./maxConversations.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText
  .replace(/^import .*;\n/gm, "").replace(/^export /gm, "");
const routine: Protocol = { id: "sleep-1700000000000", title: "Sleep", recId: "sleep", channel: "lifestyle", metricId: "",
  offeredAt: 1700000000000, startBy: null, startedAt: 1700000000000, status: "running", weeksToJudge: 4, checkIns: [], ticks: ["2026-09-09"] };

function harness() {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const data = new Map<string, string>();
  let failStorage = false;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { if (failStorage) throw new Error("quota"); data.set(key, value); },
    removeItem: (key: string) => data.delete(key),
  } });
  const owner = activateScanOwner("sync-owner");
  writeProtocols([routine]);
  let response: (items: unknown[]) => Promise<{ ok: boolean; json: () => Promise<unknown> }> = async (items) => ({ ok: true, json: async () => ({ routines: items }) });
  let token: Promise<string | null> = Promise.resolve("fixture");
  const requests: Array<{ path: string; items: unknown[] }> = [];
  const timers = new Map<number, () => void>();
  let clock = 0;
  const api = new Function("currentAccessToken", "activeScanOwner", "readProtocols", "writeProtocols", "reconcileRoutineSnapshots",
    "sanitiseCoachingRoutine", "queueRoutineSync", "acknowledgeRoutineSync", "readPendingRoutineSync", "routineSnapshots", "fetch", "setTimeout", "clearTimeout",
    `${js}\nreturn { syncMaxPlanItems, retryPendingRoutineSync };`)(
    () => token, activeScanOwner, readProtocols, writeProtocols, reconcileRoutineSnapshots, sanitiseCoachingRoutine,
    queueRoutineSync, acknowledgeRoutineSync, readPendingRoutineSync, routineSnapshots,
    async (path: string, init: { body: string }) => { const { items } = JSON.parse(init.body); requests.push({ path, items }); return response(items); },
    (callback: () => void, ms: number) => { assert.equal(ms, 15_000); timers.set(++clock, callback); return clock; },
    (id: number) => timers.delete(id),
  ) as { syncMaxPlanItems: (items: unknown[]) => Promise<void>; retryPendingRoutineSync: () => Promise<boolean> };
  return { owner, api, requests, token: (next: Promise<string | null>) => { token = next; }, response: (next: typeof response) => { response = next; },
    fireDeadline: () => { for (const callback of [...timers.values()]) callback(); },
    blockStorage: () => { failStorage = true; }, close: () => {
      if (previous) Object.defineProperty(globalThis, "localStorage", previous); else Reflect.deleteProperty(globalThis, "localStorage"); activateScanOwner(null);
    } };
}

test("failed or malformed sync acknowledgements retain the durable queue; a later retry clears it", async () => {
  const h = harness();
  try {
    for (const body of [{ error: "offline" }, { routines: [] }, { routines: [{ id: routine.id }] }]) {
      h.response(async () => ({ ok: !("error" in body), json: async () => body }));
      await assert.rejects(h.api.retryPendingRoutineSync());
      assert.equal(routineSyncStatus(), "pending");
    }
    h.response(async (items) => ({ ok: true, json: async () => ({ routines: items }) }));
    assert.equal(await h.api.retryPendingRoutineSync(), true);
    assert.equal(routineSyncStatus(), "no-pending");
    assert.equal(await h.api.retryPendingRoutineSync(), false);
    assert.ok(h.requests.every((request) => request.path === "/api/max-conversations"), "no chat, points or day-count endpoint");
  } finally { h.close(); }
});

test("a late sync cannot acknowledge a newer tick or overwrite its local history", async () => {
  const h = harness();
  try {
    let release!: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
    let posted!: unknown[];
    h.response(async (items) => { posted = items; return new Promise((resolve) => { release = resolve; }); });
    const pending = h.api.syncMaxPlanItems([]);
    await Promise.resolve();
    writeProtocols([{ ...routine, ticks: ["2026-09-09", "2026-09-10"] }]);
    release({ ok: true, json: async () => ({ routines: posted }) });
    await pending;
    assert.equal(routineSyncStatus(), "pending");
    assert.deepEqual(readProtocols()[0].ticks, ["2026-09-09", "2026-09-10"]);
  } finally { h.close(); }
});

test("server-canonical terminal state is restored before acknowledgement and survives a stale caller", async () => {
  const h = harness();
  try {
    h.response(async (items) => ({ ok: true, json: async () => ({ routines: items.map((item) => ({ ...(item as object), status: "judged" })) }) }));
    await h.api.syncMaxPlanItems([]);
    assert.equal(readProtocols()[0].status, "judged");
    assert.equal(routineSyncStatus(), "no-pending");
    await h.api.syncMaxPlanItems(routineSnapshots([routine]));
    assert.equal((h.requests[h.requests.length - 1].items[0] as { status: string }).status, "judged");
    assert.equal(readProtocols()[0].status, "judged");
  } finally { h.close(); }
});

test("changed accounts and failed local restoration cannot clear the original queue", async () => {
  const h = harness();
  try {
    let token!: (value: string) => void;
    h.token(new Promise((resolve) => { token = resolve; }));
    const pending = h.api.syncMaxPlanItems([]);
    activateScanOwner("other"); token("fixture");
    await assert.rejects(pending, /Sign in/);
    assert.equal(h.requests.length, 0);
    activateScanOwner("sync-owner");
    assert.equal(routineSyncStatus(), "pending");
    h.response(async (items) => { h.blockStorage(); return { ok: true, json: async () => ({ routines: items.map((item) => ({ ...(item as object), status: "judged" })) }) }; });
    await assert.rejects(h.api.retryPendingRoutineSync(), /storage/);
    assert.equal(routineSyncStatus(), "pending");
    assert.equal(readProtocols()[0].status, "running");
  } finally { h.close(); }
});

test("whole-operation deadline releases stalled auth/body and late completions never acknowledge pending work", async () => {
  const h = harness();
  try {
    let token!: (value: string) => void;
    h.token(new Promise((resolve) => { token = resolve; }));
    const pending = h.api.syncMaxPlanItems([]);
    h.fireDeadline();
    await assert.rejects(pending, /timed out/);
    token("fixture");
    await Promise.resolve();
    assert.equal(h.requests.length, 0, "a token arriving after timeout cannot start a write");
    assert.equal(routineSyncStatus(), "pending");
    let body!: (value: unknown) => void;
    let submitted!: unknown[];
    h.response(async (items) => { submitted = items; return { ok: true, json: () => new Promise((resolve) => { body = resolve; }) }; });
    const slowBody = h.api.syncMaxPlanItems([]);
    for (let turn = 0; turn < 5 && !body; turn++) await Promise.resolve();
    h.fireDeadline();
    await assert.rejects(slowBody, /timed out/);
    body({ routines: submitted });
    await Promise.resolve(); await Promise.resolve();
    assert.equal(routineSyncStatus(), "pending", "a late body cannot acknowledge the timed-out operation");
  } finally { h.close(); }
});
