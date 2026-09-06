import assert from "node:assert/strict";
import test from "node:test";
import { activateScanOwner } from "./scanScope.js";
import { deleteBodyProfile, fetchBodyProfile, migrateLocalBodyProfile, readBody, saveBodyProfile, writeBody } from "./bodyProfile.js";

const profile = (heightCm: number | null = 181.2, weightKg: number | null = 80) => ({
  heightCm, weightKg, unit: "metric", required: heightCm === null, updatedAt: "2026-09-07T00:00:00Z",
});
let sequence = 0;
function setup(t: test.TestContext) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "localStorage", previous); else Reflect.deleteProperty(globalThis, "localStorage"); });
  const id = `body-test-${++sequence}`;
  activateScanOwner(id);
  const token = `header.${btoa(JSON.stringify({ sub: id }))}.signature`;
  const respond = (value: unknown, status = 200) => Response.json(value, { status });
  return { id, token, data, respond };
}

test("server body values hydrate preferences and retain server confirmation age", async (t) => {
  const f = setup(t);
  writeBody({ heightCm: 175, weightKg: 70, activity: "light", goal: "lean" });
  const server = await fetchBodyProfile(f.token, async () => f.respond(profile()));
  assert.equal(server?.required, false);
  assert.equal(readBody()?.heightCm, 181.2);
  assert.equal(readBody()?.activity, "light");
  assert.equal(readBody()?.goal, "lean");
  assert.equal(readBody()?.savedAt, Date.parse("2026-09-07T00:00:00Z"));
});

test("cleared server values remove stale cache and cannot be migrated back", async (t) => {
  const f = setup(t);
  writeBody({ heightCm: 175, weightKg: 70, activity: "moderate", goal: "hold" });
  await fetchBodyProfile(f.token, async () => f.respond(profile(null, null)));
  assert.equal(readBody(), null);
  writeBody({ heightCm: 175, weightKg: 70, activity: "moderate", goal: "hold" });
  let calls = 0;
  assert.equal(await migrateLocalBodyProfile(f.token, async () => { calls++; return f.respond(profile()); }), false);
  assert.equal(calls, 0);
});

test("late body responses and old-account tokens cannot write into another account", async (t) => {
  const f = setup(t);
  let release!: (value: Response) => void;
  const request = fetchBodyProfile(f.token, () => new Promise<Response>((resolve) => { release = resolve; }));
  await new Promise((resolve) => setImmediate(resolve));
  activateScanOwner("body-other");
  release(f.respond(profile()));
  assert.equal(await request, null);
  assert.equal(readBody(), null);
  let calls = 0;
  assert.equal(await fetchBodyProfile(f.token, async () => { calls++; return f.respond(profile()); }), null);
  assert.equal(calls, 0);
});

test("failed save leaves cache unchanged, successful save is server-first", async (t) => {
  const f = setup(t);
  writeBody({ heightCm: 175, weightKg: 70, activity: "moderate", goal: "hold" });
  const entry = { unit: "metric" as const, heightCm: 181.2, weightKg: 80 };
  assert.equal((await saveBodyProfile(f.token, entry, "dialog", async () => f.respond({ error: "Try again" }, 500))).ok, false);
  assert.equal(readBody()?.heightCm, 175);
  assert.equal((await saveBodyProfile(f.token, entry, "settings", async (_url, init) => {
    assert.equal(JSON.parse(String(init?.body)).source, "settings");
    assert.equal(readBody()?.heightCm, 175);
    return f.respond(profile());
  })).ok, true);
  assert.equal(readBody()?.heightCm, 181.2);
});

test("legacy device migration submits once, only when no server row has ever been saved", async (t) => {
  const f = setup(t);
  writeBody({ heightCm: 181.2, weightKg: 80, activity: "moderate", goal: "hold" });
  const methods: string[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    methods.push(init?.method ?? "GET");
    return f.respond(init?.method === "GET" ? { ...profile(null, null), updatedAt: null } : profile());
  };
  assert.equal(await migrateLocalBodyProfile(f.token, fetcher), true);
  assert.equal(await migrateLocalBodyProfile(f.token, fetcher), false);
  assert.deepEqual(methods, ["GET", "PUT"]);
});

test("a second old device respects an explicitly cleared timestamped row", async (t) => {
  const f = setup(t);
  writeBody({ heightCm: 175, weightKg: 70, activity: "moderate", goal: "hold" });
  const methods: string[] = [];
  assert.equal(await migrateLocalBodyProfile(f.token, async (_url, init) => {
    methods.push(init?.method ?? "GET");
    return f.respond(profile(null, null));
  }), false);
  assert.deepEqual(methods, ["GET"]);
  assert.equal(readBody(), null);
});

test("delete is serialized after an outstanding read and clears the device too", async (t) => {
  const f = setup(t);
  let release!: (value: Response) => void;
  const read = fetchBodyProfile(f.token, () => new Promise<Response>((resolve) => { release = resolve; }));
  const remove = deleteBodyProfile(f.token, async (_url, init) => {
    assert.equal(init?.method, "DELETE");
    return f.respond(profile(null, null));
  });
  await new Promise((resolve) => setImmediate(resolve));
  release(f.respond(profile()));
  await Promise.all([read, remove]);
  assert.equal(readBody(), null);
});

test("a malformed required flag never masquerades as a server exemption", async (t) => {
  const f = setup(t);
  assert.equal(await fetchBodyProfile(f.token, async () => f.respond({ heightCm: null, weightKg: null })), null);
});
