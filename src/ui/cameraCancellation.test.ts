import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import type { FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { readFileSync } from "node:fs";
import { applyFrontFit, startCamera } from "./camera.js";
import { bindNativeAppLifecycle } from "../engine/nativeBridge.js";

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
  const context = {
    clearRect() {}, drawImage() {}, translate() {}, scale() {},
    getImageData: () => ({ data: new Uint8ClampedArray(160 * 160 * 4).fill(128) }),
  };
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
    readyState: 2,
    currentTime: 0,
    videoWidth: 640,
    videoHeight: 480,
    play: async () => {},
  };
  const requests: Array<Promise<MediaStream>> = [];
  const requestedConstraints: MediaStreamConstraints[] = [];
  let requested = 0;
  const globals: Record<string, unknown> = {
    document: doc,
    navigator: { mediaDevices: {
      getUserMedia: (constraints: MediaStreamConstraints) => {
        requested++;
        requestedConstraints.push(constraints);
        const next = requests.shift();
        if (!next) throw new Error("Unexpected camera request");
        return next;
      },
    } },
    window: { setTimeout, clearTimeout, devicePixelRatio: 1 },
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
  return { requests, requestedConstraints, video, assignments, engine, opts, callbacks, pendingFrames, doc, modes,
    get requested() { return requested; }, get bootCount() { return bootCount; } };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("front prefers native aspect without a square requirement and side keeps its existing request", async (t) => {
  const env = environment(t);
  env.requests.push(Promise.resolve(mediaStream().stream), Promise.resolve(mediaStream().stream));
  const front = await startCamera(env.opts(), env.engine);
  assert.deepEqual(env.requestedConstraints[0], { video: { facingMode: "user", width: { ideal: 1920 }, resizeMode: { ideal: "none" } }, audio: false });
  front.stop();
  const side = await startCamera({ ...env.opts(), mode: "side" }, env.engine);
  assert.deepEqual(env.requestedConstraints[1], { video: { facingMode: "user", width: { ideal: 1920 }, height: { ideal: 1920 } }, audio: false });
  side.stop();
});

test("display fitting cannot change captured resolution and stop restores the original inline style", async (t) => {
  const env = environment(t);
  const mutations: Array<[string, string | null]> = [];
  const video = Object.assign(env.video, {
    style: {} as CSSStyleDeclaration,
    getAttribute: () => "opacity: 0.9",
    setAttribute: (name: string, value: string) => { mutations.push([name, value]); },
    removeAttribute: (name: string) => { mutations.push([name, null]); },
  });
  env.requests.push(Promise.resolve(mediaStream().stream));
  const handle = await startCamera(env.opts(), env.engine);
  applyFrontFit(video as unknown as HTMLVideoElement, { width: 640, height: 480 }, { width: 390, height: 844 }, { scale: 1.2, x: -30, y: 40 }, false);
  assert.match(video.style.transform, /matrix\(-1.2/);
  const image = handle.capture();
  assert.equal(image?.width, 640);
  assert.equal(image?.height, 480);
  handle.stop();
  assert.deepEqual(mutations[mutations.length - 1], ["style", "opacity: 0.9"]);
});

test("capture refuses unavailable, zero-height, muted, ended or stale camera frames", async (t) => {
  const env = environment(t);
  let now = 1000;
  t.mock.method(performance, "now", () => now);
  const media = mediaStream();
  env.requests.push(Promise.resolve(media.stream));
  const handle = await startCamera(env.opts(), env.engine);
  try {
    assert.ok(handle.capture());
    env.video.readyState = 1;
    assert.equal(handle.capture(), null);
    env.video.readyState = 2;
    env.video.videoHeight = 0;
    assert.equal(handle.capture(), null);
    env.video.videoHeight = 480;
    media.track.muted = true;
    assert.equal(handle.capture(), null);
    media.track.muted = false;
    media.track.readyState = "ended";
    assert.equal(handle.capture(), null);
    media.track.readyState = "live";
    assert.ok(handle.capture());
    now += 501;
    assert.equal(handle.capture(), null);
  } finally { handle.stop(); }
});

test("foreground recovery gives the watchdog grace without making a frozen source capturable", async (t) => {
  const env = environment(t);
  let now = 1000;
  t.mock.method(performance, "now", () => now);
  env.requests.push(Promise.resolve(mediaStream().stream));
  const handle = await startCamera(env.opts(), { ...env.engine, detectVideo: () => null });
  try {
    assert.ok(handle.capture());
    env.doc.visibilityState = "hidden";
    env.doc.dispatchEvent(new Event("visibilitychange"));
    now = 5000;
    env.doc.visibilityState = "visible";
    env.doc.dispatchEvent(new Event("visibilitychange"));
    assert.equal(handle.capture(), null, "resuming does not refresh unchanged source pixels");
    const [id, callback] = [...env.pendingFrames][0];
    env.pendingFrames.delete(id);
    callback(now);
    assert.equal(env.requested, 1, "the watchdog still lets the existing stream resume before reacquiring");
    assert.equal(handle.capture(), null);
    env.video.currentTime += 1 / 30;
    assert.ok(handle.capture(), "the first genuinely new source frame restores capture");
  } finally { handle.stop(); }
});

test("capture observes a fresh source frame after slow synchronous inference", async (t) => {
  const env = environment(t);
  let now = 1000;
  t.mock.method(performance, "now", () => now);
  env.requests.push(Promise.resolve(mediaStream().stream));
  const handle = await startCamera(env.opts(), {
    ...env.engine,
    detectVideo: () => {
      now += 600;
      env.video.currentTime += 0.6;
      return null;
    },
  });
  try {
    const [id, callback] = [...env.pendingFrames][0];
    env.pendingFrames.delete(id);
    callback(1000);
    assert.equal(now, 1600);
    assert.equal(env.video.currentTime, 0.6);
    const shot = handle.capture();
    assert.equal(shot?.width, 640);
    assert.equal(shot?.height, 480);
    now += 501;
    assert.equal(handle.capture(), null, "the capture observation does not make a subsequently frozen source perpetually fresh");
  } finally { handle.stop(); }
});

test("onCheck capture survives a source clock cached during 600ms inference but not a later frozen loop", async (t) => {
  const env = environment(t);
  let now = 1000;
  t.mock.method(performance, "now", () => now);
  env.requests.push(Promise.resolve(mediaStream().stream));
  let capture: (() => HTMLCanvasElement | null) | null = null;
  const checkedShots: Array<HTMLCanvasElement | null> = [];
  const pausedShots: Array<HTMLCanvasElement | null> = [];
  const handle = await startCamera({
    ...env.opts(),
    onCheck: () => { if (capture) checkedShots.push(capture()); },
    onPause: () => { if (capture) pausedShots.push(capture()); },
  }, {
    ...env.engine,
    // Browser currentTime is stable throughout this entire synchronous task.
    detectVideo: () => { now += 600; return null; },
  });
  capture = () => handle.capture();
  const tick = (time: number) => {
    now = time;
    const [id, callback] = [...env.pendingFrames][0];
    env.pendingFrames.delete(id);
    callback(time);
  };
  try {
    env.video.currentTime = 1 / 30;
    tick(1000);
    assert.equal(now, 1600);
    assert.equal(env.video.currentTime, 1 / 30);
    assert.equal(checkedShots.length, 1);
    assert.equal(checkedShots[0]?.width, 640, "capture runs inside onCheck after expensive inference");
    assert.equal(checkedShots[0]?.height, 480);
    assert.equal(handle.capture(), null, "the same-task allowance is already cleared on callback return");

    tick(1650);
    assert.equal(checkedShots.length, 1, "a frozen source is not reanalyzed");
    assert.deepEqual(pausedShots, [null], "even a shutter inside the next loop rejects a genuinely frozen source");
    assert.equal(handle.capture(), null);
  } finally { handle.stop(); }
});

test("same-task frame allowance is cleared even when onCheck throws", async (t) => {
  const env = environment(t);
  let now = 1000;
  t.mock.method(performance, "now", () => now);
  env.requests.push(Promise.resolve(mediaStream().stream));
  let capture: (() => HTMLCanvasElement | null) | null = null;
  let shot: HTMLCanvasElement | null = null;
  const handle = await startCamera({
    ...env.opts(),
    onCheck: () => {
      shot = capture?.() ?? null;
      throw new Error("test callback failure");
    },
  }, { ...env.engine, detectVideo: () => { now += 600; return null; } });
  capture = () => handle.capture();
  try {
    env.video.currentTime = 1 / 30;
    const [id, callback] = [...env.pendingFrames][0];
    env.pendingFrames.delete(id);
    assert.throws(() => callback(1000), /test callback failure/);
    assert.ok(shot);
    assert.equal(handle.capture(), null);
  } finally { handle.stop(); }
});

test("slow inference cannot refresh a frozen source clock at capture", async (t) => {
  const env = environment(t);
  let now = 1000;
  t.mock.method(performance, "now", () => now);
  env.requests.push(Promise.resolve(mediaStream().stream));
  const handle = await startCamera(env.opts(), {
    ...env.engine,
    detectVideo: () => { now += 600; return null; },
  });
  try {
    const [id, callback] = [...env.pendingFrames][0];
    env.pendingFrames.delete(id);
    callback(1000);
    assert.equal(now, 1600);
    assert.equal(env.video.currentTime, 0);
    assert.equal(handle.capture(), null);
    now += 100;
    assert.equal(handle.capture(), null, "repeated shutter attempts do not reset a frozen frame's age");
    env.video.currentTime = 0.7;
    assert.ok(handle.capture(), "the shutter recovers as soon as an actual new source frame is observed");
  } finally { handle.stop(); }
});

test("camera zoom advances between detector reads and countdown lock leaves detection running", async (t) => {
  const env = environment(t);
  let now = 1000;
  t.mock.method(performance, "now", () => now);
  const video = Object.assign(env.video, { style: {} as CSSStyleDeclaration });
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  lm[234].x = 0.3; lm[454].x = 0.7;
  lm[10].y = 0.25; lm[152].y = 0.75;
  const result: FaceLandmarkerResult = { faceLandmarks: [lm], faceBlendshapes: [], facialTransformationMatrixes: [] };
  let reads = 0;
  env.requests.push(Promise.resolve(mediaStream().stream));
  const handle = await startCamera(env.opts(), { ...env.engine, detectVideo: () => { reads++; return result; } });
  const tick = (time: number) => {
    now = time;
    video.currentTime += 1 / 60;
    const [id, callback] = [...env.pendingFrames][0];
    env.pendingFrames.delete(id);
    callback(time);
  };
  try {
    tick(1000);
    const initial = video.style.transform;
    assert.equal(reads, 1);
    tick(1016);
    const second = video.style.transform;
    assert.notEqual(second, initial);
    tick(1032);
    assert.notEqual(video.style.transform, second);
    assert.equal(reads, 1, "two paint frames advance before the next inference read");
    handle.setFramingLocked?.(true);
    const locked = video.style.transform;
    tick(1048); tick(1064); tick(1112);
    assert.equal(video.style.transform, locked);
    assert.equal(reads, 2, "locking the display never stops source quality checks");
    assert.equal(handle.capture()?.width, 640);
    handle.setFramingLocked?.(false);
    tick(1128);
    assert.notEqual(video.style.transform, locked);
  } finally { handle.stop(); }
});

async function nativeActivity() {
  let event!: (state: { isActive: boolean }) => void;
  const dispose = bindNativeAppLifecycle({
    addListener: async (_name, callback) => { event = callback; return { remove: async () => {} }; },
    getState: async () => ({ isActive: true }),
  });
  await flush();
  return { set: (isActive: boolean) => event({ isActive }), dispose };
}

test("native resume does not race an outstanding initial permission request", async (t) => {
  const env = environment(t);
  const activity = await nativeActivity();
  const permission = deferred<MediaStream>();
  env.requests.push(permission.promise);
  const controller = new AbortController();
  try {
    const startup = startCamera(env.opts(controller.signal), env.engine);
    activity.set(false);
    activity.set(true);
    assert.equal(env.requested, 1);
    const camera = mediaStream();
    permission.resolve(camera.stream);
    const handle = await startup;
    assert.equal(env.video.srcObject, camera.stream);
    assert.equal(env.requested, 1);
    handle.stop();
  } finally { controller.abort(); activity.dispose(); }
});

test("a permission result received while native-paused is released and startup resumes once", async (t) => {
  const env = environment(t);
  const activity = await nativeActivity();
  const permission = deferred<MediaStream>();
  const resumed = mediaStream();
  env.requests.push(permission.promise, Promise.resolve(resumed.stream));
  const controller = new AbortController();
  try {
    const startup = startCamera(env.opts(controller.signal), env.engine);
    activity.set(false);
    const background = mediaStream();
    permission.resolve(background.stream);
    await flush();
    assert.equal(background.track.stopped, 1);
    assert.deepEqual(env.assignments, []);
    assert.equal(env.requested, 1);
    activity.set(true);
    const handle = await startup;
    assert.equal(env.requested, 2);
    assert.equal(env.video.srcObject, resumed.stream);
    handle.stop();
  } finally { controller.abort(); activity.dispose(); }
});

test("native pause during video playback startup retries after resume without closing the camera", async (t) => {
  const env = environment(t);
  const activity = await nativeActivity();
  const first = mediaStream();
  const resumed = mediaStream();
  const play = deferred<void>();
  env.requests.push(Promise.resolve(first.stream), Promise.resolve(resumed.stream));
  env.video.play = () => env.video.srcObject === first.stream ? play.promise : Promise.resolve();
  const controller = new AbortController();
  try {
    const startup = startCamera(env.opts(controller.signal), env.engine);
    await flush();
    activity.set(false);
    activity.set(true);
    assert.equal(env.requested, 1);
    play.reject(new Error("Playback interrupted by backgrounding"));
    const handle = await startup;
    assert.equal(env.video.srcObject, resumed.stream);
    assert.equal(env.callbacks.lost, 0);
    handle.stop();
  } finally { controller.abort(); activity.dispose(); }
});

test("native pause stops preview, capture and swap until resume without needing document visibility", async (t) => {
  const env = environment(t);
  const activity = await nativeActivity();
  const camera = mediaStream();
  env.requests.push(Promise.resolve(camera.stream));
  const handle = await startCamera(env.opts(), env.engine);
  try {
    activity.set(false);
    assert.equal(env.doc.visibilityState, "visible");
    assert.equal(env.pendingFrames.size, 0);
    assert.equal(handle.capture(), null);
    assert.equal(await handle.swap(), false);
    assert.equal(env.requested, 1);
    activity.set(true);
    assert.equal(env.pendingFrames.size, 1);
    assert.ok(handle.capture());
    handle.stop();
    const paused = env.callbacks.paused;
    activity.set(false);
    assert.equal(env.callbacks.paused, paused, "stopped camera unsubscribes from native activity");
  } finally { handle.stop(); activity.dispose(); }
});

test("native foreground recovery also waits for a new frame after a frozen interruption", async (t) => {
  const env = environment(t);
  let now = 1000;
  t.mock.method(performance, "now", () => now);
  const activity = await nativeActivity();
  env.requests.push(Promise.resolve(mediaStream().stream));
  const handle = await startCamera(env.opts(), env.engine);
  try {
    assert.ok(handle.capture());
    activity.set(false);
    now = 5000;
    activity.set(true);
    assert.equal(handle.capture(), null);
    env.video.currentTime += 1 / 30;
    assert.ok(handle.capture());
  } finally { handle.stop(); activity.dispose(); }
});

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
