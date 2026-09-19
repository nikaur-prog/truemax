import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { mountCanvasRecovery } from "./canvasRecovery.js";
import { bindNativeAppLifecycle } from "../engine/nativeBridge.js";

type Listener = () => void;

function eventTarget() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    listeners,
    addEventListener(type: string, listener: Listener) {
      const set = listeners.get(type) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type: string, listener: Listener) {
      listeners.get(type)?.delete(listener);
    },
    fire(type: string) {
      for (const listener of listeners.get(type) ?? []) listener();
    },
  };
}

function delayedImages(t: TestContext) {
  const images: Array<{ onload: (() => void) | null }> = [];
  let draws = 0;
  let restored = 0;
  const canvas = {
    width: 640, height: 800,
    getContext: () => ({ clearRect() {}, drawImage() { draws++; } }),
    toBlob: (done: (blob: Blob) => void) => done(new Blob(["pixels"])),
  } as unknown as HTMLCanvasElement;
  const doc = { ...eventTarget(), hidden: false, visibilityState: "visible", createElement: () => canvas };
  const globals = {
    document: doc,
    window: eventTarget(),
    Image: class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() { images.push(this); }
      set src(_value: string) {}
    },
  };
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(globals)) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  const handle = mountCanvasRecovery([canvas], () => { restored++; });
  t.after(() => {
    handle.destroy();
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  return { handle, canvas, images, doc, get draws() { return draws; }, get restored() { return restored; } };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("destroying a report during decode prevents the old photo from overwriting its successor", async (t) => {
  const env = delayedImages(t);
  const pending = env.handle.restore();
  await flush();
  assert.equal(env.images.length, 1);
  env.handle.destroy();
  env.canvas.width = 999;
  env.images[0].onload?.();
  assert.equal(await pending, false);
  assert.equal(env.canvas.width, 999);
  assert.equal(env.draws, 0);
  assert.equal(env.restored, 0);
});

test("native pause blocks an in-flight repaint and a later resume restores without a visibility event", async (t) => {
  const env = delayedImages(t);
  let activity!: (state: { isActive: boolean }) => void;
  const dispose = bindNativeAppLifecycle({
    addListener: async (_name, listener) => { activity = listener; return { remove: async () => {} }; },
    getState: async () => ({ isActive: true }),
  });
  try {
    await flush();
    const pending = env.handle.restore();
    await flush();
    activity({ isActive: false });
    env.images[0].onload?.();
    assert.equal(await pending, false);
    assert.equal(env.draws, 0);
    assert.equal(await env.handle.restore(), false);
    activity({ isActive: true });
    await flush();
    assert.equal(env.images.length, 2);
    env.images[1].onload?.();
    await flush();
    assert.equal(env.draws, 1);
    assert.equal(env.restored, 1);
    assert.equal(env.doc.visibilityState, "visible");
  } finally { env.handle.destroy(); dispose(); }
});

test("a foreground return rebuilds a discarded source canvas and cleanup disarms it", async () => {
  const docEvents = eventTarget();
  const winEvents = eventTarget();
  let draws = 0;
  let restored = 0;
  const context = {
    clearRect() {},
    drawImage() { draws += 1; },
  };
  const canvas = {
    width: 640,
    height: 800,
    getContext: () => context,
    toBlob: (done: (blob: Blob | null) => void) => done(new Blob(["photo"], { type: "image/jpeg" })),
  } as unknown as HTMLCanvasElement;

  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { ...docEvents, hidden: false, createElement: () => canvas },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { ...winEvents },
  });
  Object.defineProperty(globalThis, "Image", {
    configurable: true,
    value: FakeImage,
  });

  try {
    const handle = mountCanvasRecovery([canvas], () => { restored += 1; });
    // Ignore encoding: for an in-bound capture it calls toBlob directly and
    // does not draw. This draw is the actual restoration.
    assert.equal(await handle.restore(), true);
    assert.equal(draws, 1);
    assert.equal(restored, 1);

    docEvents.fire("visibilitychange");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(draws, 2);
    assert.equal(restored, 2);

    handle.destroy();
    winEvents.fire("pageshow");
    docEvents.fire("visibilitychange");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(draws, 2);
    assert.equal(docEvents.listeners.get("visibilitychange")?.size ?? 0, 0);
    assert.equal(winEvents.listeners.get("pageshow")?.size ?? 0, 0);
  } finally {
    Reflect.deleteProperty(globalThis, "Image");
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "document");
  }
});
