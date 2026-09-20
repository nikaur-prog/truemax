import assert from "node:assert/strict";
import test from "node:test";
import { createAnalyticsController } from "./analytics.js";
import { ANALYTICS_CONSENT_KEY } from "./analyticsPolicy.js";

function fixture(options: { granted?: boolean; cookieError?: boolean; createError?: boolean; appendError?: boolean; hookError?: boolean } = {}) {
  const records = new Map<string, string>();
  if (options.granted) records.set(ANALYTICS_CONSENT_KEY, JSON.stringify({ version: 1, allowed: true, at: Date.now() }));
  let failWrites = false;
  const frames = new Set<unknown>();
  const hooks = new Map<string, EventListener>();
  const storage = {
    getItem: (key: string) => records.get(key) ?? null,
    setItem(key: string, value: string) { if (failWrites) throw new Error("blocked writes"); records.set(key, value); },
    removeItem(key: string) { if (failWrites) throw new Error("blocked writes"); records.delete(key); },
  };
  const win = {
    location: new URL("https://www.truemax.app/"), localStorage: storage,
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: {
      referrer: "",
      get cookie() { if (options.cookieError) throw new Error("blocked cookies"); return "_ga=x; session=private"; },
      set cookie(_value: string) { if (options.cookieError) throw new Error("blocked cookies"); },
      createElement() {
        if (options.createError) throw new Error("blocked DOM");
        const frame = { contentWindow: { postMessage() {} }, setAttribute() {}, addEventListener() {}, remove() { frames.delete(frame); } };
        return frame;
      },
      body: { appendChild(frame: unknown) { if (options.appendError) throw new Error("blocked append"); frames.add(frame); } },
    },
    history: { pushState() {}, replaceState() {} },
    setInterval: () => 1, clearInterval() {},
    addEventListener(name: string, hook: EventListener) { if (options.hookError) throw new Error("blocked listener"); hooks.set(name, hook); },
    removeEventListener(name: string) { hooks.delete(name); },
  } as unknown as Window;
  return { win, records, frames, hooks, failWrites: () => { failWrites = true; } };
}

test("unconfigured analytics does not initialize the DOM, timers or listeners", () => {
  const f = fixture({ createError: true, hookError: true });
  const c = createAnalyticsController(f.win, "");
  assert.equal(c.available(), false); c.track("scan-started"); c.setConsent(true); c.dispose();
  assert.equal(f.hooks.size, 0); assert.equal(f.frames.size, 0);
});

test("no frame before consent; ordinary sync cannot duplicate it", () => {
  const f = fixture(); const c = createAnalyticsController(f.win, "G-TEST123456");
  assert.equal(f.frames.size, 0); c.setConsent(true); assert.equal(f.frames.size, 1);
  c.track("scan-started"); c.track("scan-started"); assert.equal(f.frames.size, 1);
  c.setConsent(false); assert.equal(f.frames.size, 0); assert.equal(c.consent(), false);
  c.setConsent(true); assert.equal(f.frames.size, 1); c.dispose();
});

test("failed revocation cannot resurrect a readable older grant, even when removal also fails", () => {
  const f = fixture({ granted: true }); const c = createAnalyticsController(f.win, "G-TEST123456");
  assert.equal(f.frames.size, 1); let changed = 0; c.subscribe(() => { changed++; });
  f.failWrites(); c.setConsent(false);
  assert.equal(c.persistenceFailed(), true);
  assert.equal(c.consent(), false); assert.equal(f.frames.size, 0); assert.equal(changed, 1);
  assert.equal(JSON.parse(f.records.get(ANALYTICS_CONSENT_KEY)!).allowed, true, "Regression exercises an unremovable old grant.");
  c.track("scan-started"); c.setConsent(true);
  assert.equal(f.frames.size, 0); assert.equal(c.consent(), false); c.dispose();
});

test("cookie access, DOM creation and insertion failures never break primary operations", () => {
  for (const options of [{ cookieError: true }, { createError: true }, { appendError: true }]) {
    const f = fixture({ ...options, granted: true });
    assert.doesNotThrow(() => {
      const c = createAnalyticsController(f.win, "G-TEST123456");
      c.track("scan-started"); c.setConsent(false); c.track("checkout-started"); c.dispose();
    });
    assert.equal(f.frames.size, 0);
  }
});

test("partially blocked initialization fails closed and restores history hooks", () => {
  const f = fixture({ granted: true, hookError: true }); const original = f.win.history.pushState;
  const c = createAnalyticsController(f.win, "G-TEST123456");
  assert.equal(c.available(), false); assert.equal(f.frames.size, 0);
  assert.equal(f.win.history.pushState, original); c.setConsent(true); c.track("scan-started"); c.dispose();
});
