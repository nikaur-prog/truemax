import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mountPublicVitals, publicVital, type PublicVital } from "./publicVitals.js";

const ID = "v6-1750000000000-1234567890123";
const base: PublicVital = { name: "LCP", value: 1350.25, delta: 1350.25, rating: "good", id: ID };
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(allowed: boolean | null = true, eligible = true) {
  let consent = allowed;
  let available = eligible;
  const listeners = new Set<() => void>();
  const sent: PublicVital[] = [];
  const callbacks = new Map<string, (metric: unknown) => void>();
  const registrations: string[] = [];
  let loads = 0;
  const controller = {
    available: () => available,
    consent: () => consent,
    subscribe(callback: () => void) { listeners.add(callback); return () => { listeners.delete(callback); }; },
    trackVital(metric: PublicVital) { sent.push(metric); },
  };
  const register = (name: string) => (callback: (metric: never) => void) => {
    registrations.push(name);
    callbacks.set(name, callback as (metric: unknown) => void);
  };
  const library = { onLCP: register("LCP"), onCLS: register("CLS"), onINP: register("INP") };
  const load = async () => { loads++; return library; };
  const sync = () => { for (const listener of listeners) listener(); };
  return { controller, load, library, callbacks, sent, registrations, listeners, loads: () => loads,
    setConsent(value: boolean | null, notify = true) { consent = value; if (notify) sync(); },
    setAvailable(value: boolean) { available = value; sync(); }, sync };
}

test("only finite, correctly typed standard core vitals cross the bridge", () => {
  assert.deepEqual(publicVital({ ...base, entries: [{ name: "private-url", element: "private-node" }],
    attribution: { selector: "#private" }, navigationURL: "https://private.example", user_id: "private" }), base);
  assert.deepEqual(publicVital({ ...base, name: "INP", value: 240, delta: -40 }), { ...base, name: "INP", value: 240, delta: -40 });
  for (const bad of [null, {}, { ...base, name: "FCP" }, { ...base, name: "__proto__" },
    { ...base, rating: "excellent" }, { ...base, value: -1 }, { ...base, value: "1200" },
    { ...base, value: Infinity }, { ...base, value: NaN }, { ...base, value: Number.MAX_VALUE },
    { ...base, delta: "2" }, { ...base, delta: Infinity }, { ...base, delta: NaN }, { ...base, delta: -Number.MAX_VALUE },
    { ...base, id: "person@example.com" }, { ...base, id: `https://site/${ID}` }, { ...base, id: `${ID}\n` },
    { ...base, id: "v5-1750000000000-1234567890123" }, { ...base, id: `${ID}a` }]) {
    assert.equal(publicVital(bad), null);
  }
  assert.equal(Object.is(publicVital({ ...base, value: -0, delta: -0 })!.value, -0), false);
});

test("unavailable or unconsented pages do not load, observe or replay after a new grant", async () => {
  for (const consent of [false, null]) {
    const f = fixture(consent);
    mountPublicVitals(f.controller, f.load);
    f.setConsent(true);
    mountPublicVitals(f.controller, f.load);
    await tick();
    assert.equal(f.loads(), 0);
    assert.deepEqual(f.registrations, []);
    assert.deepEqual(f.sent, []);
  }
  const f = fixture(true, false);
  mountPublicVitals(f.controller, f.load);
  f.setAvailable(true);
  await tick();
  assert.equal(f.loads(), 0);
});

test("one consented page registers once despite duplicate mounts or BFcache syncs", async () => {
  const f = fixture();
  const stop = mountPublicVitals(f.controller, f.load);
  assert.equal(mountPublicVitals(f.controller, f.load), stop);
  f.sync(); f.sync();
  await tick();
  assert.equal(f.loads(), 1);
  assert.deepEqual(f.registrations, ["LCP", "CLS", "INP"]);
  f.callbacks.get("LCP")!(base);
  f.callbacks.get("LCP")!({ ...base });
  const restored = { ...base, id: "v6-1750000000010-1234567890124" };
  f.sync();
  f.callbacks.get("LCP")!(restored);
  assert.deepEqual(f.sent, [base, restored]);
  assert.equal(f.loads(), 1);
});

test("official INP/CLS updates keep deltas and drop raw entries without synthesizing values", async () => {
  const f = fixture();
  mountPublicVitals(f.controller, f.load);
  await tick();
  assert.deepEqual(f.sent, []); // Unsupported/no-interaction browser has no invented INP.
  const first = { ...base, name: "INP" as const, value: 280, delta: 280 };
  const second = { ...first, value: 240, delta: -40 };
  f.callbacks.get("INP")!({ ...first, entries: [{ name: "private" }] });
  f.callbacks.get("INP")!(second);
  f.callbacks.get("CLS")!({ ...base, name: "CLS", value: 0, delta: 0 });
  assert.deepEqual(f.sent, [first, second, { ...base, name: "CLS", value: 0, delta: 0 }]);
});

test("revoke, consent expiry, or private navigation permanently silence this document", async () => {
  for (const reason of ["revoke", "expiry", "private"] as const) {
    const f = fixture();
    mountPublicVitals(f.controller, f.load);
    await tick();
    if (reason === "private") f.setAvailable(false);
    else f.setConsent(reason === "expiry" ? null : false);
    f.callbacks.get("LCP")!(base);
    f.setAvailable(true); f.setConsent(true);
    mountPublicVitals(f.controller, f.load);
    f.callbacks.get("LCP")!(base);
    assert.deepEqual(f.sent, []);
    assert.equal(f.loads(), 1);
    assert.equal(f.listeners.size, 0);
  }
});

test("every callback checks current permission even without a storage notification", async () => {
  const f = fixture();
  mountPublicVitals(f.controller, f.load);
  await tick();
  f.setConsent(false, false);
  f.callbacks.get("LCP")!(base);
  f.setConsent(true);
  f.callbacks.get("LCP")!(base);
  assert.deepEqual(f.sent, []);
});

test("revoking or disposing during an async import cannot register observers", async () => {
  for (const cancel of ["revoke", "dispose"] as const) {
    const f = fixture();
    let release!: (value: typeof f.library) => void;
    const pending = new Promise<typeof f.library>(resolve => { release = resolve; });
    const stop = mountPublicVitals(f.controller, () => pending);
    await tick();
    if (cancel === "revoke") f.setConsent(false); else stop();
    release(f.library);
    await tick();
    assert.deepEqual(f.registrations, []);
    assert.equal(f.listeners.size, 0);
  }
});

test("failed loading stays fail-closed without retries or unhandled rejection", async () => {
  const f = fixture();
  mountPublicVitals(f.controller, async () => { throw new Error("offline"); });
  await tick();
  f.sync();
  assert.deepEqual(f.registrations, []);
  assert.equal(f.listeners.size, 0);
});

test("vitals use a pinned local standard build, never attribution or a third-party CDN", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.dependencies["web-vitals"], "6.2.2");
  const source = readFileSync(new URL("./publicVitals.ts", import.meta.url), "utf8");
  assert.match(source, /\(\) => import\("web-vitals"\)/);
  assert.doesNotMatch(source, /web-vitals\/attribution|createElement|sendBeacon|\.entries|navigationURL|reportAllChanges/);
});
