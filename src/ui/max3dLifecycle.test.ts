import test from "node:test";
import assert from "node:assert/strict";
import { createMax3DMounter } from "./max3d.js";
import type { Max3DRuntime } from "./max3d.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function flush(): Promise<void> { for (let i = 0; i < 6; i++) await Promise.resolve(); }

function browser({ observers = true } = {}) {
  const original = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown): void => {
    original.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  };
  const visibility: ((entries: unknown[]) => void)[] = [];
  class Observer {
    constructor(callback: (entries: unknown[]) => void) { visibility.push(callback); }
    observe(): void {} disconnect(): void {}
  }
  class Passive { observe(): void {} disconnect(): void {} }
  const motion = Object.assign(new EventTarget(), { matches: false });
  const connection = Object.assign(new EventTarget(), { saveData: false });
  const doc = Object.assign(new EventTarget(), { hidden: false, documentElement: {} });
  const win = Object.assign(new EventTarget(), { innerWidth: 1000, innerHeight: 800, matchMedia: () => motion });
  const stage = Object.assign(new EventTarget(), {
    isConnected: true, querySelector: () => null,
    getBoundingClientRect: () => ({ width: 320, height: 320, top: 10, left: 10, bottom: 330, right: 330 }),
  }) as unknown as HTMLElement;
  install("window", win); install("document", doc); install("navigator", { connection });
  install("IntersectionObserver", observers ? Observer : undefined);
  install("ResizeObserver", Passive); install("MutationObserver", Passive);
  return {
    stage, motion, connection, doc,
    visible: (value = true) => visibility[visibility.length - 1]([{ isIntersecting: value, intersectionRatio: value ? 1 : 0 }]),
    restore() { for (const [name, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } },
  };
}

function fakeRuntime() {
  const calls: [string, unknown][] = [];
  const runtime: Max3DRuntime = {
    setState: (state) => calls.push(["state", state]),
    setView: (view) => calls.push(["view", view]),
    setPlayfulEnabled: (enabled) => calls.push(["playful", enabled]),
    setSpeechLevel: (level) => calls.push(["speech", level]),
    pause: (paused) => calls.push(["pause", paused]),
    dispose: () => calls.push(["dispose", true]),
  };
  return { calls, runtime };
}

test("latest state, view, playful preference and speech level survive both delayed import and asset creation", async () => {
  const browserState = browser();
  const created = deferred<Max3DRuntime>();
  const loaded = deferred<{ createMax3D: typeof import("./max3dRuntime.js").createMax3D }>();
  const { runtime, calls } = fakeRuntime();
  let loads = 0, initial = "";
  const mount = createMax3DMounter(() => { loads++; return loaded.promise; });
  const handle = mount(browserState.stage, "idle");
  try {
    handle.setAnimation("thinking"); handle.setView("front");
    assert.equal(loads, 0);
    browserState.visible(); browserState.visible();
    assert.equal(loads, 1);
    loaded.resolve({ createMax3D: async (_stage, _fallback, state) => { initial = state; return created.promise; } });
    await flush();
    assert.equal(initial, "thinking");
    handle.setAnimation("speaking"); handle.setView("side"); handle.setPlayfulEnabled(false); handle.setSpeechLevel(9);
    created.resolve(runtime); await flush();
    assert.deepEqual(calls, [["playful", false], ["speech", 1], ["state", "speaking"], ["view", "side"], ["pause", false]]);
    handle.setSpeechLevel(null);
    assert.deepEqual(calls[calls.length - 1], ["speech", null]);
  } finally { handle.destroy(); browserState.restore(); }
});

test("hidden, reduced-motion and data-saving transitions pause the same renderer without another load", async () => {
  const f = browser();
  const { runtime, calls } = fakeRuntime();
  let loads = 0;
  const mount = createMax3DMounter(async () => { loads++; return { createMax3D: async () => runtime }; });
  const handle = mount(f.stage);
  try {
    f.motion.matches = true; f.visible(); await flush(); assert.equal(loads, 0);
    f.motion.matches = false; f.motion.dispatchEvent(new Event("change")); await flush();
    assert.equal(loads, 1);
    for (const change of [
      () => { f.doc.hidden = true; f.doc.dispatchEvent(new Event("visibilitychange")); },
      () => { f.doc.hidden = false; f.doc.dispatchEvent(new Event("visibilitychange")); },
      () => { f.connection.saveData = true; f.connection.dispatchEvent(new Event("change")); },
      () => { f.connection.saveData = false; f.connection.dispatchEvent(new Event("change")); },
      () => f.visible(false), () => f.visible(true),
    ]) change();
    assert.deepEqual(calls.filter(([name]) => name === "pause").map(([, value]) => value), [false, true, false, true, false, true, false]);
    assert.equal(loads, 1);
  } finally { handle.destroy(); f.restore(); }
});

test("a replaced delayed creation is disposed and never receives late state commands", async () => {
  const f = browser();
  const pending = deferred<Max3DRuntime>();
  const { runtime, calls } = fakeRuntime();
  const mount = createMax3DMounter(async () => ({ createMax3D: async () => pending.promise }));
  const first = mount(f.stage);
  try {
    f.visible(); await flush();
    const second = mount(f.stage);
    first.setAnimation("speaking"); first.setSpeechLevel(1);
    pending.resolve(runtime); await flush();
    assert.deepEqual(calls, [["dispose", true]]);
    second.destroy();
  } finally { first.destroy(); f.restore(); }
});

test("a visible embedded browser without IntersectionObserver can load the lazy preview", async () => {
  const f = browser({ observers: false });
  const { runtime, calls } = fakeRuntime();
  let loads = 0;
  const mount = createMax3DMounter(async () => { loads++; return { createMax3D: async () => runtime }; });
  const handle = mount(f.stage, "quiet", { playful: false });
  try {
    await flush(); assert.equal(loads, 1);
    assert.ok(calls.some(([name, value]) => name === "state" && value === "quiet"));
    assert.ok(calls.some(([name, value]) => name === "playful" && value === false));
  } finally { handle.destroy(); f.restore(); }
});
