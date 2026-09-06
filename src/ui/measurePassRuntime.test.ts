import test from "node:test";
import assert from "node:assert/strict";
import { runMeasurePass, type PassHost, type PassSources, type PassStep } from "./measurePass.js";
import { drawLandmarksAnimated } from "./overlay.js";

function runtime() {
  let now = 0, id = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const frames = new Map<number, FrameRequestCallback>();
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  const clock = {
    setTimeout: (callback: () => void, ms: number) => { timers.set(++id, { at: now + ms, callback }); return id; },
    clearTimeout: (key: number) => { timers.delete(key); },
    matchMedia: () => ({ matches: false }),
  };
  install("window", clock);
  install("performance", { now: () => now });
  install("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  install("cancelAnimationFrame", (key: number) => { frames.delete(key); });
  const flush = async () => { for (let count = 0; count < 10; count++) await Promise.resolve(); };
  return {
    timers, frames,
    async advance(ms: number, paintFrames = true) {
      const until = now + ms;
      while (now < until) {
        now = Math.min(now + 10, until);
        for (const [key, timer] of [...timers]) if (timer.at <= now) { timers.delete(key); timer.callback(); }
        if (paintFrames) for (const [key, callback] of [...frames]) { frames.delete(key); callback(now); }
        await flush();
      }
    },
    flush,
    restore() { for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } },
  };
}
function element() {
  const classes = new Set<string>();
  return {
    style: {}, innerHTML: "", textContent: "",
    classList: { add: (...items: string[]) => items.forEach((item) => classes.add(item)), remove: (...items: string[]) => items.forEach((item) => classes.delete(item)), contains: (item: string) => classes.has(item) },
    scrollIntoView: () => {},
  } as unknown as HTMLElement;
}
function fixture() {
  let clears = 0;
  const fills: string[] = [];
  const context = { clearRect: () => { clears++; }, drawImage: () => {}, beginPath: () => {}, arc: () => {}, fillStyle: "", fill() { fills.push(this.fillStyle); } };
  const canvas = { width: 100, height: 100, getContext: () => context } as unknown as HTMLCanvasElement;
  const host: PassHost = { zoomable: element(), status: element(), barFill: element(), capLeft: element(), frame: element(), photoCanvas: canvas, overlayCanvas: canvas };
  const sources: PassSources = { front: { photo: canvas, landmarks: [], width: 100, height: 100 }, side: null };
  return { host, sources, canvas, fills, clears: () => clears };
}

test("external cancellation resolves the pass immediately and removes all local work and fade classes", async () => {
  const clock = runtime();
  try {
    const { host, sources } = fixture();
    const controller = new AbortController();
    const run = runMeasurePass(host, sources, [], { durationPolicy: "interactive", signal: controller.signal, open: new Promise(() => {}) });
    let done = false; void run.done.then(() => { done = true; });
    controller.abort();
    assert.equal(clock.timers.size, 0, "no cancellation polling or delayed narration remains");
    assert.equal(clock.frames.size, 0);
    assert.equal(host.barFill.classList.contains("driven"), false);
    assert.equal(host.status.classList.contains("swapping"), false);
    await clock.flush();
    assert.equal(done, true);
  } finally { clock.restore(); }
});

test("interactive pass deadline resolves even when animation frames are throttled away", async () => {
  const clock = runtime();
  try {
    const { host, sources } = fixture();
    // Side without a source makes draw a harmless no-op; the timing runner
    // still awaits its frame, as a real background-throttled pass would.
    const plan = [{ view: "side", label: "Jawline", metric: { def: { name: "Jaw angle" } } }] as PassStep[];
    const run = runMeasurePass(host, sources, plan, { durationPolicy: "interactive", startPainted: "front" });
    let done = false; void run.done.then(() => { done = true; });
    await clock.advance(2490, false);
    assert.equal(done, false);
    await clock.advance(10, false);
    assert.equal(done, true);
    assert.equal(clock.timers.size, 0);
    assert.equal(clock.frames.size, 0);
    assert.equal(host.zoomable.classList.contains("viewfade"), false);
  } finally { clock.restore(); }
});

test("pre-cancelled pass does not mutate the new surface", async () => {
  const clock = runtime();
  try {
    const { host, sources, clears } = fixture();
    const controller = new AbortController(); controller.abort();
    await runMeasurePass(host, sources, [], { signal: controller.signal }).done;
    assert.equal(clears(), 0);
    assert.equal(clock.timers.size + clock.frames.size, 0);
  } finally { clock.restore(); }
});

test("compact landmark reveal is white, leaves geometry untouched and stops stale frames on abort", async () => {
  const clock = runtime();
  try {
    const { canvas, fills, clears } = fixture();
    const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
    const snapshot = JSON.stringify(landmarks);
    const reveal = drawLandmarksAnimated(canvas, landmarks, 100, 100, { durationMs: 320, neutral: true });
    await clock.advance(320);
    await reveal.done;
    assert.equal(fills.length > 0, true);
    assert.ok(fills.every((color) => color === "rgba(255, 255, 255, 0.92)"));
    assert.equal(JSON.stringify(landmarks), snapshot);
    assert.equal(clock.frames.size, 0);
    const controller = new AbortController();
    const next = drawLandmarksAnimated(canvas, landmarks, 100, 100, { durationMs: 320, signal: controller.signal });
    const stale = [...clock.frames.values()][0];
    controller.abort(); await next.done;
    const count = clears(); stale(640);
    assert.equal(clears(), count);
    assert.equal(clock.frames.size, 0);
  } finally { clock.restore(); }
});
