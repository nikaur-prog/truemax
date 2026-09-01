import assert from "node:assert/strict";
import test from "node:test";
import { mountCanvasRecovery } from "./canvasRecovery.js";

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
