import assert from "node:assert/strict";
import test from "node:test";
import { DELETE, PUT } from "./body-profile.js";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
type Row = {
  user_id: string;
  height_cm: number | null;
  weight_kg: number | null;
  unit_preference: string;
  source: string;
  updated_at: string;
};
type Write = {
  payload: Omit<Row, "updated_at">;
  preference: string;
  release: () => void;
  applied: Promise<void>;
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/**
 * The real Supabase request builders and real route handlers run here. Only
 * HTTP is replaced with a tiny PostgREST conflict simulator. Writes commit
 * atomically using the actual emitted resolution header, and can be released
 * in either order to exercise a cross-device race without production writes.
 */
function fixture(initial?: Partial<Row>) {
  const rows = new Map<string, Row>();
  if (initial) rows.set(USER, {
    user_id: USER, height_cm: 181, weight_kg: 72, unit_preference: "imperial",
    source: "settings", updated_at: "2026-09-01T00:00:00.000Z", ...initial,
  });
  const writes: Write[] = [];
  let holdWrites = false;
  let changed = deferred();
  let failedRead = false;
  let failedWrite = false;
  const json = (value: unknown, status = 200) => Response.json(value, { status });

  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.equal(url.origin, "https://body-profile-tests.invalid", "test never reaches a real project");
    if (url.pathname === "/auth/v1/user") {
      return json({ id: USER, aud: "authenticated", role: "authenticated", email: "body-test@example.invalid" });
    }
    assert.ok(url.pathname.startsWith("/rest/v1/"));
    const table = url.pathname.slice("/rest/v1/".length);
    if (request.method === "GET") {
      assert.equal(url.searchParams.get("user_id"), `eq.${USER}`, "read belongs to the authenticated user");
      if (table === "profiles") return json([{ date_of_birth: "1996-01-01" }]);
      if (table === "entitlements") return json([{ tier: "max", status: "active" }]);
      assert.equal(table, "body_profiles");
      if (failedRead) return json({ message: "read failed", code: "TEST" }, 400);
      const row = rows.get(USER);
      return json(row ? [{ ...row }] : []);
    }
    assert.equal(table, "body_profiles", "migration must not invoke the old RPC");
    assert.equal(request.method, "POST", "both operations use an atomic upsert");
    assert.equal(url.searchParams.get("on_conflict"), "user_id");
    const payload = await request.json() as Write["payload"];
    assert.equal(payload.user_id, USER, "a payload cannot choose another account");
    const preference = request.headers.get("prefer") ?? "";
    assert.match(preference, /resolution=(ignore|merge)-duplicates/);
    const gate = deferred();
    const applied = deferred();
    writes.push({ payload, preference, release: gate.resolve, applied: applied.promise });
    changed.resolve();
    changed = deferred();
    if (holdWrites) await gate.promise;
    if (failedWrite) { applied.resolve(); return json({ message: "write failed", code: "TEST" }, 400); }
    const existing = rows.get(payload.user_id);
    if (!existing || !preference.includes("resolution=ignore-duplicates")) {
      rows.set(payload.user_id, { ...existing, ...payload, updated_at: "2026-09-07T01:00:00.000Z" });
    }
    applied.resolve();
    return new Response(null, { status: 201 });
  };

  return {
    rows, writes, fetcher,
    hold: () => { holdWrites = true; },
    failRead: () => { failedRead = true; },
    failWrite: () => { failedWrite = true; },
    waitWrites: async (count: number) => {
      while (writes.length < count) await changed.promise;
    },
    commit: async (source: string) => {
      const write = writes.find((item) => item.payload.source === source);
      assert.ok(write, `pending ${source} write exists`);
      write.release();
      await write.applied;
    },
  };
}

const request = (method: "PUT" | "DELETE", payload?: unknown) => new Request("https://truemax.app/api/body-profile", {
  method,
  headers: { authorization: "Bearer body-profile-test-token", origin: "https://truemax.app", "content-type": "application/json" },
  ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
});
const migration = { unit: "metric", heightCm: 180, weightKg: 75, source: "device_migration", user_id: OTHER };

test("body-profile routes use atomic conflict policies and retain clears", { timeout: 15000 }, async (t) => {
  const savedFetch = globalThis.fetch;
  const savedUrl = process.env.SUPABASE_URL;
  const savedSecret = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_URL = "https://body-profile-tests.invalid";
  process.env.SUPABASE_SECRET_KEY = "body-profile-test-secret";
  let current = fixture();
  // Supabase may capture this function when its client is initialized. Keep
  // the dispatcher stable and switch only the controlled fixture underneath.
  globalThis.fetch = (input, init) => current.fetcher(input, init);
  try {
    await t.test("migration inserts an absent row and never overwrites an existing value", async () => {
      current = fixture();
      assert.equal((await PUT(request("PUT", migration))).status, 200);
      assert.equal(current.rows.get(USER)?.height_cm, 180);
      assert.match(current.writes[0].preference, /resolution=ignore-duplicates/);
      assert.equal((await PUT(request("PUT", { ...migration, heightCm: 190 }))).status, 200);
      assert.equal(current.rows.get(USER)?.height_cm, 180);
    });

    await t.test("clearing an absent row creates a tombstone that rejects later device migration", async () => {
      current = fixture();
      const cleared = await DELETE(request("DELETE"));
      assert.equal(cleared.status, 200);
      assert.equal((await cleared.json()).required, true);
      assert.equal(current.rows.get(USER)?.height_cm, null);
      assert.equal(current.rows.get(USER)?.source, "settings");
      assert.match(current.writes[0].preference, /resolution=merge-duplicates/);
      assert.equal((await PUT(request("PUT", migration))).status, 200);
      assert.equal(current.rows.get(USER)?.height_cm, null);
      assert.equal(current.rows.get(USER)?.weight_kg, null);
    });

    await t.test("clearing keeps an existing imperial preference", async () => {
      current = fixture({ unit_preference: "imperial" });
      const response = await DELETE(request("DELETE"));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).unit, "imperial");
      assert.equal(current.rows.get(USER)?.unit_preference, "imperial");
      assert.equal(current.rows.get(USER)?.weight_kg, null);
    });

    for (const order of [["settings", "device_migration"], ["device_migration", "settings"]]) {
      await t.test(`concurrent clear and migration: ${order.join(" then ")}`, async () => {
        current = fixture();
        current.hold();
        const migrating = PUT(request("PUT", migration));
        const clearing = DELETE(request("DELETE"));
        await current.waitWrites(2);
        for (const source of order) await current.commit(source);
        const responses = await Promise.all([migrating, clearing]);
        assert.deepEqual(responses.map((response) => response.status), [200, 200]);
        assert.equal(current.rows.get(USER)?.height_cm, null);
        assert.equal(current.rows.get(USER)?.weight_kg, null);
        assert.equal(current.rows.get(USER)?.source, "settings");
      });
    }

    await t.test("a deliberate later save can refill a cleared profile", async () => {
      current = fixture({ height_cm: null, weight_kg: null });
      const response = await PUT(request("PUT", { unit: "imperial", feet: 6, inches: 0, pounds: 165, source: "settings" }));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).required, false);
      assert.equal(current.rows.get(USER)?.height_cm, 182.9);
      assert.match(current.writes[0].preference, /resolution=merge-duplicates/);
    });

    await t.test("a failed preference read or write never reports a successful clear", async () => {
      current = fixture();
      current.failRead();
      assert.equal((await DELETE(request("DELETE"))).status, 500);
      assert.equal(current.writes.length, 0);
      current = fixture();
      current.failWrite();
      assert.equal((await DELETE(request("DELETE"))).status, 500);
      assert.equal(current.rows.has(USER), false);
    });

    await t.test("missing authentication and foreign origins cannot create a tombstone", async () => {
      current = fixture();
      assert.equal((await DELETE(new Request("https://truemax.app/api/body-profile", { method: "DELETE" }))).status, 401);
      assert.equal((await DELETE(new Request("https://truemax.app/api/body-profile", {
        method: "DELETE", headers: { authorization: "Bearer test", origin: "https://other.invalid" },
      }))).status, 403);
      assert.equal(current.writes.length, 0);
    });
  } finally {
    globalThis.fetch = savedFetch;
    if (savedUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = savedUrl;
    if (savedSecret === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = savedSecret;
  }
});
