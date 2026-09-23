import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  CAPTURE_FEEDBACK_MS, CAPTURE_REDUCED_FEEDBACK_MS, CAPTURE_TICKS,
  playCaptureTick, primeCaptureAudio, showCaptureFeedback,
} from "./captureFeedback.js";

function globals(t: TestContext, values: Record<string, unknown>) {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(values)) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  t.after(() => {
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
}

function environment(t: TestContext, reduced = false, animationSupport = true) {
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const animations: Array<{ frames: Keyframe[]; cancelled: boolean }> = [];
  const drawings: unknown[][] = [];
  let nextTimer = 0;
  class Element {
    width = 0;
    height = 0;
    className = "";
    textContent = "";
    style: Record<string, string> = {};
    attributes = new Map<string, string>();
    children: Element[] = [];
    parent: Element | null = null;
    constructor(readonly tag: string) {}
    setAttribute(key: string, value: string) { this.attributes.set(key, value); }
    append(...children: Element[]) { children.forEach((child) => { child.parent = this; this.children.push(child); }); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((item) => item !== this); }
    getContext() { return {
      translate: (...args: number[]) => drawings.push(["translate", ...args]),
      scale: (...args: number[]) => drawings.push(["scale", ...args]),
      drawImage: (...args: unknown[]) => drawings.push(["drawImage", ...args]),
    }; }
    animate(frames: Keyframe[]) {
      const animation = { frames, cancelled: false };
      animations.push(animation);
      return { cancel() { animation.cancelled = true; } };
    }
  }
  const body = new Element("body");
  const frame = {
    isConnected: true,
    getBoundingClientRect: () => ({ left: 40, top: 120, width: 390, height: 500 }),
  } as unknown as HTMLElement;
  const previewStyle = {
    left: "0px", top: "0px", width: "1920px", height: "1080px", objectFit: "fill",
    objectPosition: "50% 50%", transform: "matrix(-0.7, 0, 0, 0.7, 850, -90)", transformOrigin: "0px 0px",
  };
  const video = { classList: { contains: () => false } } as unknown as HTMLVideoElement;
  globals(t, {
    window: {},
    document: { body, createElement: (tag: string) => {
      const element = new Element(tag);
      if (!animationSupport) Object.defineProperty(element, "animate", { value: undefined });
      return element;
    } },
    matchMedia: () => ({ matches: reduced }),
    getComputedStyle: (element: unknown) => element === frame ? { borderRadius: "24px" } : previewStyle,
    setTimeout: (callback: () => void, delay: number) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
    clearTimeout: (id: number) => timers.delete(id),
  });
  const snapshot = { width: 1920, height: 1080 } as HTMLCanvasElement;
  return {
    body, frame, video, snapshot, previewStyle, animations, drawings, timers,
    finish() { for (const timer of [...timers.values()]) timer.callback(); },
  };
}

test("captured photograph freezes at the existing preview transform and curtains fully clean up", async (t) => {
  const env = environment(t);
  const feedback = showCaptureFeedback(env.snapshot, { frame: env.frame, video: env.video });
  const layer = env.body.children[0];
  assert.equal(layer.className, "capture-feedback");
  assert.equal(layer.style.top, "120px");
  assert.equal(layer.style.pointerEvents, "none");
  const frozen = layer.children[0];
  assert.deepEqual(frozen.style, { position: "absolute", ...env.previewStyle });
  assert.equal(frozen.width, env.snapshot.width);
  assert.deepEqual(env.drawings, [["translate", 1920, 0], ["scale", -1, 1], ["drawImage", env.snapshot, 0, 0]]);
  assert.deepEqual(env.snapshot, { width: 1920, height: 1080 });
  assert.equal(layer.children[1].textContent, "Photo captured");
  assert.equal(layer.children[1].attributes.get("role"), "status");
  assert.equal(env.animations.length, 2);
  assert.equal(env.animations[0].frames[0].transform, "translateY(-101%)");
  assert.equal(env.animations[1].frames[0].transform, "translateY(101%)");
  assert.equal(env.animations[0].frames[1].transform, "translateY(0)");
  assert.equal([...env.timers.values()][0].delay, CAPTURE_FEEDBACK_MS);
  env.finish();
  await feedback;
  assert.equal(env.body.children.length, 0);
  assert.equal(env.timers.size, 0);
  assert.ok(env.animations.every((animation) => animation.cancelled));
});

test("back-camera feedback preserves the unmirrored source", async (t) => {
  const env = environment(t);
  const video = { classList: { contains: () => true } } as unknown as HTMLVideoElement;
  const feedback = showCaptureFeedback(env.snapshot, { frame: env.frame, video });
  assert.deepEqual(env.drawings, [["drawImage", env.snapshot, 0, 0]]);
  env.finish();
  await feedback;
});

test("reduced motion uses a brief frozen confirmation without moving curtains", async (t) => {
  const env = environment(t, true);
  const feedback = showCaptureFeedback(env.snapshot, { frame: env.frame });
  assert.equal(env.animations.length, 0);
  assert.equal(env.body.children[0].children.length, 2);
  assert.equal([...env.timers.values()][0].delay, CAPTURE_REDUCED_FEEDBACK_MS);
  env.finish();
  await feedback;
});

test("cancelling active feedback resolves and removes its frame, timers and animations", async (t) => {
  const env = environment(t);
  const controller = new AbortController();
  const feedback = showCaptureFeedback(env.snapshot, { frame: env.frame, signal: controller.signal });
  controller.abort();
  await feedback;
  assert.equal(env.body.children.length, 0);
  assert.equal(env.timers.size, 0);
  assert.ok(env.animations.every((animation) => animation.cancelled));
});

test("already cancelled, empty or detached captures produce no feedback", async (t) => {
  const env = environment(t);
  const controller = new AbortController();
  controller.abort();
  await showCaptureFeedback(env.snapshot, { frame: env.frame, signal: controller.signal });
  await showCaptureFeedback({ width: 0, height: 0 } as HTMLCanvasElement, { frame: env.frame });
  await showCaptureFeedback(env.snapshot, { frame: { ...env.frame, isConnected: false } as HTMLElement });
  assert.equal(env.body.children.length, 0);
  assert.equal(env.timers.size, 0);
});

test("a failed layout read cannot block photo review", async (t) => {
  const env = environment(t);
  const frame = { getBoundingClientRect() { throw new Error("detached viewport"); } } as unknown as HTMLElement;
  await showCaptureFeedback(env.snapshot, { frame });
  assert.equal(env.body.children.length, 0);
});

test("browsers without Web Animations still confirm and proceed to photo review", async (t) => {
  const env = environment(t, false, false);
  const feedback = showCaptureFeedback(env.snapshot, { frame: env.frame });
  assert.equal(env.animations.length, 0);
  assert.equal(env.body.children[0].children[1].textContent, "Photo captured");
  env.finish();
  await feedback;
  assert.equal(env.body.children.length, 0);
});

test("capture sounds degrade silently when audio is missing or refused", (t) => {
  globals(t, { window: { AudioContext: class { constructor() { throw new Error("blocked"); } } } });
  assert.doesNotThrow(() => primeCaptureAudio());
  assert.doesNotThrow(() => playCaptureTick(2));
  assert.doesNotThrow(() => playCaptureTick(1));
  assert.ok(CAPTURE_TICKS[1].frequency > CAPTURE_TICKS[2].frequency);
  assert.ok(CAPTURE_TICKS[1].gain > CAPTURE_TICKS[2].gain);
});

test("ticks play exactly two shaped notes; priming is silent and the shutter requires a snapshot", async (t) => {
  const env = environment(t);
  const frequencies: number[] = [];
  const peaks: number[] = [];
  const buffers: number[] = [];
  let oscillators = 0;
  let sources = 0;
  let resumes = 0;
  class Audio {
    static instances: Audio[] = [];
    state = "suspended";
    currentTime = 0;
    sampleRate = 1000;
    destination = {};
    constructor() { Audio.instances.push(this); }
    async resume() { resumes++; this.state = "running"; }
    createBuffer(_channels: number, length: number) { buffers.push(length); return { getChannelData: () => new Float32Array(length) }; }
    createBufferSource() { return { connect(node: unknown) { return node; }, disconnect() {}, start() { sources++; }, onended: null, buffer: null }; }
    createGain() { return {
      gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime(value: number) { peaks.push(value); }, exponentialRampToValueAtTime() {} },
      connect(node: unknown) { return node; }, disconnect() {},
    }; }
    createOscillator() { oscillators++; return {
      frequency: { setValueAtTime(value: number) { frequencies.push(value); } },
      connect(node: unknown) { return node; }, disconnect() {}, start() {}, stop() {}, onended: null, type: "sine",
    }; }
    createBiquadFilter() { return { frequency: { value: 0 }, type: "highpass", connect(node: unknown) { return node; }, disconnect() {} }; }
  }
  (window as unknown as { AudioContext: unknown }).AudioContext = Audio;
  t.after(() => Audio.instances.forEach((audio) => { audio.state = "closed"; }));
  primeCaptureAudio();
  assert.equal(resumes, 1);
  assert.deepEqual(buffers, [1]);
  await showCaptureFeedback({ width: 0, height: 0 } as HTMLCanvasElement, { frame: env.frame });
  assert.equal(sources, 1);
  playCaptureTick(3);
  playCaptureTick(2);
  playCaptureTick(1);
  playCaptureTick(0);
  assert.equal(oscillators, 2);
  assert.deepEqual(frequencies, [660, 880]);
  assert.deepEqual(peaks, [0.035, 0.065]);
  assert.equal(sources, 1);
  const feedback = showCaptureFeedback(env.snapshot, { frame: env.frame });
  assert.equal(sources, 2);
  assert.deepEqual(buffers, [1, 140]);
  env.finish();
  await feedback;
});

for (const initialState of ["suspended", "interrupted"] as const) {
  for (const rejectResume of [false, true]) {
    test(`${initialState} audio is resumed; ${rejectResume ? "rejected" : "successful"} recovery never blocks capture feedback`, async (t) => {
      const env = environment(t);
      let resumes = 0;
      class Audio {
        static instances: Audio[] = [];
        state: string = initialState;
        sampleRate = 1000;
        destination = {};
        constructor() { Audio.instances.push(this); }
        async resume() {
          resumes++;
          if (rejectResume) throw new Error("Audio recovery denied");
          this.state = "running";
        }
        createBuffer() { return {}; }
        createBufferSource() { return { connect() {}, disconnect() {}, start() {}, buffer: null, onended: null }; }
      }
      (window as unknown as { AudioContext: unknown }).AudioContext = Audio;
      t.after(() => Audio.instances.forEach((audio) => { audio.state = "closed"; }));
      assert.doesNotThrow(() => primeCaptureAudio());
      assert.equal(resumes, 1);
      assert.doesNotThrow(() => playCaptureTick(2));
      assert.equal(resumes, rejectResume ? 2 : 1);
      const feedback = showCaptureFeedback(env.snapshot, { frame: env.frame });
      assert.equal(resumes, rejectResume ? 3 : 1);
      assert.equal(env.body.children.length, 1);
      env.finish();
      await feedback;
      // Let rejected resume promises settle. An unhandled rejection fails the
      // test runner; feedback still completes and its transient layer is gone.
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(env.body.children.length, 0);
      assert.equal(env.timers.size, 0);
    });
  }
}
