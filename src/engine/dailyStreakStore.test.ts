import assert from "node:assert/strict";
import test from "node:test";
import { createDailyStreakStore, type StreakCache } from "./dailyStreakStore.js";
import { EMPTY_STREAK, readStreak, type StreakCountResult, type StreakSnapshot } from "./dailyStreak.js";

const day = "2026-09-07";
const snapshot = (current = 0, enabled = true): StreakSnapshot => {
  const state = { ...EMPTY_STREAK, current, best: current, enabled, lastCountedDay: current ? day : null };
  return { state, reading: readStreak(state, day), balances: { consistency: current * 2 }, today: day };
};
const counted = (): StreakCountResult => ({ ...snapshot(1), counted: true, ended: false, weekLanded: false, graceSpent: 0, awarded: 2 });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  let owner: string | null = "user:a";
  let server = snapshot();
  let countFailure = false;
  const data = new Map<string, string>();
  const changes: (StreakCache | null)[] = [];
  const tokens: string[] = [];
  const calls: string[] = [];
  const deps = {
    owner: () => owner,
    token: async (id: string) => { tokens.push(id); return `token:${id}`; },
    storage: () => ({ getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } }),
    now: () => new Date("2026-09-07T12:00:00Z"),
    read: async (_token: string): Promise<StreakSnapshot | null> => server,
    count: async (token: string): Promise<StreakCountResult | null> => {
      calls.push(token);
      if (countFailure) return null;
      server = counted();
      return counted();
    },
    enable: async (_token: string, enabled: boolean): Promise<StreakSnapshot | null> => { server = snapshot(server.state.current, enabled); return server; },
    changed: (cache: StreakCache | null) => { changes.push(cache); },
  };
  return { deps, data, changes, tokens, calls, setOwner: (value: string | null) => { owner = value; },
    fail: (value: boolean) => { countFailure = value; } };
}

test("late GET and POST responses cannot enter a different account's cache", async () => {
  for (const method of ["read", "count"] as const) {
    const f = fixture();
    const gate = deferred<StreakCountResult>();
    f.deps[method] = () => gate.promise;
    const store = createDailyStreakStore(f.deps);
    const request = method === "read" ? store.refresh() : store.record("scan", day);
    await new Promise((resolve) => setImmediate(resolve));
    f.setOwner("user:b");
    gate.resolve(counted());
    await request;
    assert.equal(f.data.has("truemax:dailyStreak:user:b"), false);
    assert.equal(f.changes.length, 0);
    assert.equal(store.cached(), null);
    assert.deepEqual(f.tokens, ["a"]);
  }
});

test("each account can count its own day on one page, while duplicate actions collapse", async () => {
  const f = fixture();
  const store = createDailyStreakStore(f.deps);
  await Promise.all([store.record("routine", day), store.record("checkin", day)]);
  f.setOwner("user:b");
  await store.record("scan", day);
  assert.deepEqual(f.calls, ["token:a", "token:b"]);
});

test("failed count rolls back its optimistic display and retries on refresh after reload", async () => {
  const f = fixture();
  let store = createDailyStreakStore(f.deps);
  await store.refresh();
  f.fail(true);
  await store.record("routine", day);
  assert.ok(f.changes.some((cache) => cache?.state.current === 1));
  assert.equal(f.changes[f.changes.length - 1]?.state.current, 0);
  assert.equal(store.cached()?.state.current, 0);
  assert.match(f.data.get("truemax:dailyStreak:user:a:pending")!, /routine/);
  f.fail(false);
  store = createDailyStreakStore(f.deps);
  await store.refresh();
  assert.equal(store.cached()?.state.current, 1);
  assert.equal(f.calls.length, 2);
  assert.equal(f.data.get("truemax:dailyStreak:user:a:pending"), "[]");
});

test("serial reads cannot overwrite a newer count or Settings choice", async () => {
  const f = fixture();
  const gate = deferred<StreakSnapshot>();
  f.deps.read = () => gate.promise;
  const store = createDailyStreakStore(f.deps);
  const read = store.refresh();
  const action = store.record("scan", day);
  const toggle = store.setEnabled(false, "a");
  gate.resolve(snapshot());
  await Promise.all([read, action, toggle]);
  assert.equal(store.cached()?.state.enabled, false);
  assert.equal(store.cached()?.state.current, 1);
  assert.equal(f.changes[f.changes.length - 1]?.state.enabled, false);
});

test("signed-out actions do not claim a signed-in user's next action", async () => {
  const f = fixture();
  f.setOwner("anonymous:tab");
  const store = createDailyStreakStore(f.deps);
  await store.record("scan", day);
  assert.equal(f.data.size, 0);
  assert.equal(f.tokens.length, 0);
  f.setOwner("user:a");
  await store.record("scan", day);
  assert.equal(f.calls.length, 1);
  assert.equal(await store.setEnabled(false, "b"), null);
  assert.equal(await store.refresh("b"), null);
});

test("invalid cache fields and expired queued days are never rendered or submitted", async () => {
  const f = fixture();
  f.data.set("truemax:dailyStreak:user:a", JSON.stringify({ state: { current: 1 }, balances: { consistency: "<img>" } }));
  f.data.set("truemax:dailyStreak:user:a:pending", JSON.stringify([{ reason: "routine", day: "2026-08-01" }]));
  const store = createDailyStreakStore(f.deps);
  assert.equal(store.cached(), null);
  await store.refresh();
  assert.equal(f.calls.length, 0);
});
