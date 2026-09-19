import test from "node:test";
import assert from "node:assert/strict";
import {
  bindNativeAppLifecycle, isAppForeground, subscribeNativeActivity,
  installNativeFileShare, nativeFileSharingAvailable, shareNativeFile,
} from "./nativeBridge.js";
import type { NativeAppPlugin } from "./nativeBridge.js";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("native activity respects browser visibility and ignores stale startup state", async () => {
  let event!: (state: { isActive: boolean }) => void;
  let resolveState!: (state: { isActive: boolean }) => void;
  let removed = 0;
  const plugin: NativeAppPlugin = {
    addListener: async (_name, callback) => { event = callback; return { remove: async () => { removed++; } }; },
    getState: () => new Promise((resolve) => { resolveState = resolve; }),
  };
  const values: boolean[] = [];
  const unsubscribe = subscribeNativeActivity((active) => values.push(active));
  const dispose = bindNativeAppLifecycle(plugin);
  try {
    await flush();
    event({ isActive: false });
    resolveState({ isActive: true });
    await flush();
    assert.equal(isAppForeground(), false);
    event({ isActive: false });
    assert.deepEqual(values, [false]);
    event({ isActive: true });
    assert.equal(isAppForeground(), true);
    Object.defineProperty(globalThis, "document", { configurable: true, value: { hidden: true, visibilityState: "hidden" } });
    assert.equal(isAppForeground(), false);
    Reflect.deleteProperty(globalThis, "document");
    dispose(); dispose();
    event({ isActive: false });
    assert.equal(isAppForeground(), true);
    assert.equal(removed, 1);
  } finally { dispose(); unsubscribe(); Reflect.deleteProperty(globalThis, "document"); }
});

test("disposal during asynchronous native listener registration removes the late handle", async () => {
  let complete!: (handle: { remove(): Promise<void> }) => void;
  let removed = 0;
  let stateReads = 0;
  const dispose = bindNativeAppLifecycle({
    addListener: () => new Promise((resolve) => { complete = resolve; }),
    getState: async () => { stateReads++; return { isActive: true }; },
  });
  dispose();
  complete({ remove: async () => { removed++; } });
  await flush();
  assert.equal(removed, 1);
  assert.equal(stateReads, 0);
});

test("one activity consumer cannot prevent another from pausing", async () => {
  let event!: (state: { isActive: boolean }) => void;
  const broken = subscribeNativeActivity(() => { throw new Error("surface gone"); });
  const values: boolean[] = [];
  const good = subscribeNativeActivity((active) => values.push(active));
  const dispose = bindNativeAppLifecycle({
    addListener: async (_name, callback) => { event = callback; return { remove: async () => {} }; },
    getState: async () => ({ isActive: true }),
  });
  try {
    await flush();
    event({ isActive: false });
    assert.deepEqual(values, [false]);
  } finally { dispose(); broken(); good(); }
});

test("failed native registration releases the binding and restores browser activity", async () => {
  for (const synchronous of [false, true]) {
    const dispose = bindNativeAppLifecycle({
      addListener: (_name, callback) => {
        callback({ isActive: false });
        if (synchronous) throw new Error("native plugin unavailable");
        return Promise.reject(new Error("native registration failed"));
      },
      getState: async () => ({ isActive: false }),
    });
    await flush();
    assert.equal(isAppForeground(), true);
    const retry = bindNativeAppLifecycle({
      addListener: async () => ({ remove: async () => {} }),
      getState: async () => ({ isActive: false }),
    });
    try {
      await flush();
      dispose();
      assert.equal(isAppForeground(), false, "disposing the failed binding cannot resume its successor");
    } finally { retry(); dispose(); }
  }
});

test("native sharing passes the original file, preserves cancel/error and has no web side effects", async () => {
  const file = new File(["pixels"], "scan.png", { type: "image/png" });
  assert.equal(shareNativeFile(file), undefined);
  let received: File | null = null;
  const dispose = installNativeFileShare({ share: async (value) => { received = value; return "cancelled"; } });
  try {
    assert.equal(nativeFileSharingAvailable(), true);
    assert.equal(await shareNativeFile(file), "cancelled");
    assert.equal(received, file);
    assert.throws(() => installNativeFileShare({ share: async () => "shared" }));
  } finally { dispose(); }
  const removeBroken = installNativeFileShare({ share: async () => { throw new Error("disk full"); } });
  try { await assert.rejects(shareNativeFile(file)!, /disk full/); } finally { removeBroken(); }
  assert.equal(nativeFileSharingAvailable(), false);
});
