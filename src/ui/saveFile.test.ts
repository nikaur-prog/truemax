import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { canShareFiles, saveFile, setSavesDirectly } from "./saveFile.js";
import { installNativeFileShare } from "../engine/nativeBridge.js";

function environment(t: TestContext, handheld = false) {
  const entries = new Map<string, string>();
  const calls = { shared: 0, downloaded: 0, created: 0 };
  const navigator = {
    canShare: () => true,
    userActivation: { isActive: true },
    share: async (_data: ShareData) => { calls.shared++; },
  };
  const globals = {
    navigator,
    window: {
      matchMedia: (query: string) => ({ matches: query === "(pointer: coarse)" && handheld }),
      setTimeout: () => 1,
    },
    localStorage: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => { entries.set(key, value); },
      removeItem: (key: string) => { entries.delete(key); },
    },
    document: {
      body: { appendChild() {} },
      createElement: (tag: string) => {
        calls.created++;
        assert.equal(tag, "a", "no extra share/retry dialog should open");
        return { style: {}, click: () => { calls.downloaded++; }, remove() {} };
      },
    },
  };
  for (const [key, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  t.mock.method(URL, "createObjectURL", () => "blob:test-download");
  return { navigator, calls };
}

test("native save passes file bytes and treats dismissal as terminal", async (t) => {
  const env = environment(t, true);
  const received: File[] = [];
  const remove = installNativeFileShare({ share: async (file) => { received.push(file); return "cancelled"; } });
  try {
    assert.equal(canShareFiles("image/png"), true);
    assert.equal(await saveFile(new Blob(["pixels"], { type: "image/png" }), "face.png", "scan"), "cancelled");
    assert.equal(received[0].name, "face.png");
    assert.equal(received[0].type, "image/png");
    assert.equal(await received[0].text(), "pixels");
    assert.deepEqual(env.calls, { shared: 0, downloaded: 0, created: 0 });
  } finally { remove(); }
});

test("native errors never fall through to web sharing or a download", async (t) => {
  const env = environment(t, true);
  for (const share of [
    async () => { throw new Error("native storage full"); },
    () => { throw new Error("native storage full"); },
  ]) {
    const remove = installNativeFileShare({ share });
    try {
      await assert.rejects(saveFile(new Blob(["pixels"]), "face.png"), /native storage full/);
      assert.deepEqual(env.calls, { shared: 0, downloaded: 0, created: 0 });
    } finally { remove(); }
  }
});

test("removing the native adapter restores ordinary desktop download behavior", async (t) => {
  const env = environment(t);
  const remove = installNativeFileShare({ share: async () => "shared" });
  assert.equal(await saveFile(new Blob(["pixels"]), "face.png"), "shared");
  remove();
  assert.equal(canShareFiles("image/png"), false);
  assert.equal(await saveFile(new Blob(["pixels"]), "face.png"), "downloaded");
  assert.equal(env.calls.downloaded, 1);
  assert.equal(env.calls.shared, 0);
});

test("ordinary web sharing keeps cancellation terminal and respects direct-save preference", async (t) => {
  const env = environment(t, true);
  env.navigator.share = async () => { env.calls.shared++; throw new DOMException("Dismissed", "AbortError"); };
  assert.equal(canShareFiles("image/png"), true);
  assert.equal(await saveFile(new Blob(["pixels"]), "face.png"), "cancelled");
  assert.equal(env.calls.downloaded, 0);
  setSavesDirectly(true);
  assert.equal(canShareFiles("image/png"), false);
  assert.equal(await saveFile(new Blob(["pixels"]), "face.png"), "downloaded");
  assert.equal(env.calls.shared, 1);
  assert.equal(env.calls.downloaded, 1);
});
