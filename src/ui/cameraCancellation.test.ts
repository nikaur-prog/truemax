import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startCamera } from "./camera.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function classList() {
  const values = new Set<string>();
  return {
    toggle(value: string, force?: boolean) {
      const present = force ?? !values.has(value);
      if (present) values.add(value); else values.delete(value);
      return present;
    },
    remove(...names: string[]) { names.forEach((name) => values.delete(name)); },
    contains(value: string) { return values.has(value); },
  };
}

function mediaStream() {
  const track = Object.assign(new EventTarget(), {
    stopped: 0,
    readyState: "live",
    muted: false,
    getSettings: () => ({ facingMode: "user" }),
    stop() { this.stopped++; this.readyState = "ended"; },
  });
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, track };
}

function environment(t: TestContext) {
  const pendingFrames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  const context = { clearRect() {}, drawImage() {}, translate() {}, scale() {} };
  const canvas = () => ({ width: 640, height: 480, classList: classList(), getContext: () => context });
  const doc = Object.assign(new EventTarget(), {
    visibilityState: "visible",
    createElement: () => canvas(),
  });
  const assignments: Array<MediaStream | null> = [];
  let attached: MediaStream | null = null;
  const video = {
    classList: classList(),
    get srcObject() { return attached; },
    set srcObject(stream: MediaStream | null) { attached = stream; assignments.push(stream); },
    muted: false,
    playsInline: false,
    readyState: 0,
    currentTime: 0,
    videoWidth: 640,
    videoHeight: 480,
    play: async () => {},
  };
  const requests: Array<Promise<MediaStream>> = [];
  let requested = 0;
  const globals: Record<string, unknown> = {
    document: doc,
    navigator: { mediaDevices: {
      getUserMedia: () => {
        requested++;
        const next = requests.shift();
        if (!next) throw new Error("Unexpected camera request");
        return next;
      },
    } },
    window: { setTimeout, clearTimeout },
    requestAnimationFrame: (callback: FrameRequestCallback) => { pendingFrames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id: number) => { pendingFrames.delete(id); },
  };
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries(globals)) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  t.after(() => {
    for (const [name, original] of originals) {
      if (original) Object.defineProperty(globalThis, name, original);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  let bootCount = 0;
  const modes: string[] = [];
  const engine = {
    async initLandmarker() { bootCount++; },
    async setRunningMode(mode: "IMAGE" | "VIDEO") { modes.push(mode); },
  };
  const callbacks = { paused: 0, checked: 0, lost: 0 };
  const opts = (signal?: AbortSignal) => ({
    video: video as unknown as HTMLVideoElement,
    guideCanvas: canvas() as unknown as HTMLCanvasElement,
    signal,
    onPause: () => { callbacks.paused++; },
    onCheck: () => { callbacks.checked++; },
    onLost: () => { callbacks.lost++; },
  });
  return { requests, video, assignments, engine, opts, callbacks, pendingFrames, doc, modes,
    get requested() { return requested; }, get bootCount() { return bootCount; } };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("already cancelled camera never requests hardware", async (t) => {
  const env = environment(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(startCamera(env.opts(controller.signal), env.engine), { name: "AbortError" });
  assert.equal(env.requested, 0);
  assert.equal(env.bootCount, 0);
});

test("abort rejects startup promptly and disposes late getUserMedia without attachment", { timeout: 1000 }, async (t) => {
  const env = environment(t);
  const pending = deferred<MediaStream>();
  env.requests.push(pending.promise);
  const controller = new AbortController();
  const startup = startCamera(env.opts(controller.signal), env.engine);
  const rejected = assert.rejects(startup, { name: "AbortError" });
  controller.abort();
  await rejected;
  const late = mediaStream();
  pending.resolve(late.stream);
  await flush();
  assert.equal(late.track.stopped, 1);
  assert.deepEqual(env.assignments, []);
  assert.equal(env.bootCount, 0);
  assert.equal(env.pendingFrames.size, 0);
  assert.deepEqual(env.callbacks, { paused: 1, checked: 0, lost: 0 });
});

test("a late old permission response cannot replace or stop a successor stream", async (t) => {
  const env = environment(t);
  const oldMedia = deferred<MediaStream>();
  const next = mediaStream();
  env.requests.push(oldMedia.promise, Promise.resolve(next.stream));
  const oldController = new AbortController();
  const oldStart = startCamera(env.opts(oldController.signal), env.engine);
  const oldRejected = assert.rejects(oldStart, { name: "AbortError" });
  oldController.abort();
  await oldRejected;
  const nextController = new AbortController();
  const successor = await startCamera(env.opts(nextController.signal), env.engine);
  const late = mediaStream();
  oldMedia.resolve(late.stream);
  await flush();
  assert.equal(env.video.srcObject, next.stream);
  assert.equal(late.track.stopped, 1);
  assert.equal(next.track.stopped, 0);
  assert.deepEqual(env.assignments, [next.stream]);
  assert.equal(env.pendingFrames.size, 1);
  successor.stop();
});

test("abort during video.play cannot clear a newer preview when the old play settles", async (t) => {
  const env = environment(t);
  const old = mediaStream();
  const next = mediaStream();
  const oldPlay = deferred<void>();
  env.requests.push(Promise.resolve(old.stream), Promise.resolve(next.stream));
  env.video.play = () => env.video.srcObject === old.stream ? oldPlay.promise : Promise.resolve();
  const oldController = new AbortController();
  const oldStart = startCamera(env.opts(oldController.signal), env.engine);
  const oldRejected = assert.rejects(oldStart, { name: "AbortError" });
  await flush();
  assert.equal(env.video.srcObject, old.stream);
  oldController.abort();
  await oldRejected;
  const successor = await startCamera(env.opts(), env.engine);
  const assignmentsBeforeOldPlay = [...env.assignments];
  oldPlay.resolve();
  await flush();
  assert.equal(env.video.srcObject, next.stream);
  assert.deepEqual(env.assignments, assignmentsBeforeOldPlay);
  assert.equal(next.track.stopped, 0);
  successor.stop();
});

test("aborting a live camera stops frames and prevents old capture, swap and pause callbacks", async (t) => {
  const env = environment(t);
  const old = mediaStream();
  const next = mediaStream();
  env.requests.push(Promise.resolve(old.stream), Promise.resolve(next.stream));
  const controller = new AbortController();
  const handle = await startCamera(env.opts(controller.signal), env.engine);
  const pausedBeforeAbort = env.callbacks.paused;
  controller.abort();
  assert.equal(env.pendingFrames.size, 0);
  assert.equal(old.track.stopped, 1);
  assert.equal(env.video.srcObject, null);
  const successor = await startCamera(env.opts(), env.engine);
  assert.equal(handle.capture(), null);
  assert.equal(await handle.swap(), false);
  handle.stop();
  old.track.dispatchEvent(new Event("ended"));
  assert.equal(env.video.srcObject, next.stream);
  assert.equal(env.callbacks.paused, pausedBeforeAbort + 1);
  assert.equal(env.callbacks.checked, 0);
  assert.equal(env.callbacks.lost, 0);
  assert.equal(env.requested, 2);
  successor.stop();
});

test("late engine boot cannot switch an aborted camera back to VIDEO", async (t) => {
  const env = environment(t);
  const boot = deferred<void>();
  const stream = mediaStream();
  env.requests.push(Promise.resolve(stream.stream));
  const controller = new AbortController();
  await startCamera(env.opts(controller.signal), { ...env.engine, initLandmarker: () => boot.promise });
  controller.abort();
  boot.resolve();
  await flush();
  assert.deepEqual(env.modes, []);
  assert.equal(env.pendingFrames.size, 0);
});

test("an aborted recovery request cannot replace a new camera", async (t) => {
  const env = environment(t);
  const initial = mediaStream();
  const recovery = deferred<MediaStream>();
  const successorStream = mediaStream();
  env.requests.push(Promise.resolve(initial.stream), recovery.promise, Promise.resolve(successorStream.stream));
  const controller = new AbortController();
  await startCamera(env.opts(controller.signal), env.engine);
  initial.track.dispatchEvent(new Event("ended"));
  assert.equal(env.requested, 2);
  controller.abort();
  const successor = await startCamera(env.opts(), env.engine);
  const lateRecovery = mediaStream();
  const assignments = [...env.assignments];
  recovery.resolve(lateRecovery.stream);
  await flush();
  assert.equal(lateRecovery.track.stopped, 1);
  assert.equal(successorStream.track.stopped, 0);
  assert.equal(env.video.srcObject, successorStream.stream);
  assert.deepEqual(env.assignments, assignments);
  assert.equal(env.callbacks.lost, 0);
  assert.equal(env.requested, 3);
  successor.stop();
});

test("front and side capture pass cancellation through camera startup and close", () => {
  const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
  const frontStart = main.slice(main.indexOf("async function openCamera()"), main.indexOf("async function closeCamera("));
  assert.match(frontStart, /signal: controller.signal/);
  assert.match(frontStart, /if \(cameraAbort === controller\) camOpening = false/);
  const frontClose = main.slice(main.indexOf("async function closeCamera("), main.indexOf('el.btnCamera.addEventListener("click"'));
  assert.match(frontClose, /cameraAbort = null;\s*camOpening = false;\s*cancelledCamera\?\.abort\(\)/);
  assert.ok(frontClose.indexOf("cancelledCamera?.abort()") < frontClose.indexOf("cam?.stop()"));
  assert.match(main, /if \(cam === swappingCamera && cameraAbort === controller\) el\.camSwap\.disabled = false/);
  const side = readFileSync(new URL("./sideFlow.ts", import.meta.url), "utf8");
  assert.match(side, /signal: cameraAbort.signal/);
  const sideClose = side.slice(side.indexOf("function stopSideCamera()"), side.indexOf("export function openSideAdjust"));
  assert.match(sideClose, /sideCameraAbort = null;\s*cancelledCamera\?\.abort\(\)/);
});
