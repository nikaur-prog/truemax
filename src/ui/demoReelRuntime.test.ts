import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import type { ReelFace } from "./demoReelData.js";
import { reelPhotoRect } from "./demoReelLayout.js";
import { createReelCallouts, createReelImages, createReelValueWriter } from "./demoReelRuntime.js";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
class ImageStub {
  src = "";
  decoding = "";
  fetchPriority = "";
  complete = false;
  naturalWidth = 0;
  naturalHeight = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decoded = Promise.resolve();
  decode() { return this.decoded; }
  load() { this.complete = true; this.naturalWidth = 640; this.naturalHeight = 800; this.onload?.(); }
}

class ButtonStub extends EventTarget {
  disabled = false;
  textContent = "";
  title = "";
  private attributes = new Map<string, string>();
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string) { this.attributes.delete(name); }
  click() { if (!this.disabled) this.dispatchEvent(new Event("click")); }
}

test("portraits are requested only on demand and ready only after decode", async () => {
  const requested: ImageStub[] = [];
  let changes = 0, decode!: () => void;
  const images = createReelImages(["one.jpg", "two.jpg", "three.jpg"], () => { changes++; }, () => {
    const image = new ImageStub(); requested.push(image); return image as unknown as HTMLImageElement;
  });
  assert.equal(requested.length, 0);
  images.ensure(0); images.ensure(0);
  assert.equal(requested.length, 1);
  assert.equal(requested[0].fetchPriority, "low");
  requested[0].decoded = new Promise<void>((resolve) => { decode = resolve; });
  requested[0].load();
  await flush();
  assert.equal(images.ready(0), null);
  decode(); await flush();
  assert.equal(images.ready(0)?.width, 640);
  assert.equal(changes, 1);
  images.ensure(1); requested[1].onerror?.();
  assert.equal(images.next(0), 2, "one broken portrait does not strand the sequence");
  images.ensure(2);
  requested[2].load();
  images.stop();
  await flush();
  assert.equal(changes, 2, "late decode cannot wake a disposed reel");
  images.ensure(0);
  assert.equal(requested.length, 3);
});

test("callout sorting and placement are cached while unchanged geometry reuses the result", () => {
  const face = { regions: [
    { id: "eyes", score: 7, x: .4, y: .3 },
    { id: "jaw", score: 4, x: .7, y: .7 },
    { id: "chin", score: 5, x: .5, y: .8 },
  ] } as ReelFace;
  const before = JSON.stringify(face);
  const read = createReelCallouts();
  const first = read(face, 300, 250, 18);
  const placed = first.placed, outs = first.outs;
  assert.equal(read(face, 300, 250, 18).placed, placed);
  assert.deepEqual(outs.map((row) => row.id), ["eyes", "jaw"]);
  assert.notEqual(read(face, 320, 250, 18).placed, placed);
  assert.equal(read(face, 320, 250, 18).outs, outs);
  assert.equal(JSON.stringify(face), before);
});

test("callout cache invalidates for every cover-crop and zoom dimension", () => {
  const face = { regions: [
    { id: "eyes", score: 7, x: .4, y: .3 },
    { id: "jaw", score: 4, x: .7, y: .7 },
  ] } as ReelFace;
  const read = createReelCallouts();
  const rect = reelPhotoRect(640, 800, 300, 250, 1.02);
  const first = read(face, 300, 250, 18, rect).placed;
  assert.equal(read(face, 300, 250, 18, { ...rect }).placed, first);
  for (const key of ["dx", "dy", "dw", "dh"] as const) {
    const baseline = read(face, 300, 250, 18, rect).placed;
    const changedRect = { ...rect, [key]: rect[key] + 5 };
    const changed = read(face, 300, 250, 18, changedRect).placed;
    assert.notEqual(changed, baseline, `${key} must invalidate the placement cache`);
    assert.equal(changed[0].ax, changedRect.dx + .4 * changedRect.dw);
    assert.equal(changed[0].ay, changedRect.dy + .3 * changedRect.dh);
  }
});

test("short region lists do not duplicate a callout", () => {
  const read = createReelCallouts();
  const one = { regions: [{ id: "eyes", score: 7, x: .4, y: .3 }] } as ReelFace;
  const empty = { regions: [] } as unknown as ReelFace;
  assert.equal(read(one, 300, 250, 18).outs.length, 1);
  assert.equal(read(empty, 300, 250, 18).outs.length, 0);
});

test("stable score and caption values do not repeat DOM writes", () => {
  const write = createReelValueWriter();
  let count = 0;
  for (let frame = 0; frame < 120; frame++) write("score", "7.0", () => { count++; });
  write("score", "7.1", () => { count++; });
  write("caption", "7.1", () => { count++; });
  assert.equal(count, 3);
});

function environment(t: TestContext, reduced: boolean) {
  let now = 100, sequence = 0, draws = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const timers = new Map<number, { at: number; callback: () => void }>();
  const setTimer = (callback: () => void, delay = 0) => {
    const id = ++sequence;
    timers.set(id, { at: now + delay, callback });
    return id;
  };
  const clearTimer = (id: number) => { timers.delete(id); };
  const images: ImageStub[] = [];
  const drawnImages: unknown[] = [];
  const controls = { pause: new ButtonStub(), replay: new ButtonStub() };
  const motion = Object.assign(new EventTarget(), { matches: reduced });
  const document = Object.assign(new EventTarget(), { hidden: false, querySelector: () => null });
  const window = Object.assign(new EventTarget(), {
    devicePixelRatio: 3, matchMedia: () => motion, setTimeout: setTimer, clearTimeout: clearTimer,
  });
  const gradient = { addColorStop() {} };
  const context = new Proxy<Record<string, unknown>>({
    drawImage: (image: unknown) => { draws++; drawnImages.push(image); },
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
  }, { get(target, key: string) { return target[key] ?? (() => {}); } });
  const canvas = { clientWidth: 300, clientHeight: 375, width: 300, height: 150, isConnected: true, getContext: () => context };
  const classes = new Set<string>();
  const score = { textContent: "", style: {}, parentElement: { style: {} }, classList: {
    toggle(name: string, force: boolean) { if (force) classes.add(name); else classes.delete(name); },
  } };
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const cleanup: Array<() => void> = [];
  const globals: Record<string, unknown> = {
    document, window, location: { search: "" }, performance: { now: () => now },
    Image: class extends ImageStub { constructor() { super(); images.push(this); } },
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; },
    cancelAnimationFrame: (id: number) => { frames.delete(id); },
    setTimeout: setTimer, clearTimeout: clearTimer,
    IntersectionObserver: undefined, ResizeObserver: undefined, MutationObserver: undefined,
  };
  for (const [key, value] of Object.entries(globals)) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  t.after(() => {
    cleanup.forEach((dispose) => dispose());
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const advance = (time: number) => {
    now = time;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now && timers.delete(id)) timer.callback();
    }
  };
  return { frames, timers, controls, drawnImages, images, motion, document, window, canvas, score, draws: () => draws,
    onCleanup(dispose: () => void) { cleanup.push(dispose); },
    advance,
    step(time: number) {
      advance(time);
      const pending = [...frames.values()]; frames.clear();
      pending.forEach((callback) => callback(now));
    },
  };
}

test("actual reduced-motion reel paints a sharp static result with only one portrait", async (t) => {
  const env = environment(t, true);
  const { mountDemoReel } = await import("./demoReel.js");
  const reel = mountDemoReel(env.canvas as unknown as HTMLCanvasElement, env.score as unknown as HTMLElement, {
    controls: env.controls as unknown as { pause: HTMLButtonElement; replay: HTMLButtonElement },
  });
  env.onCleanup(() => reel.stop());
  assert.equal(env.images.length, 1);
  assert.equal(env.controls.pause.disabled, true);
  assert.equal(env.controls.replay.disabled, true);
  assert.equal(env.frames.size, 0, "no polling before the first image is ready");
  env.images[0].load(); await flush(); env.step(100);
  assert.ok(env.draws() > 0);
  assert.notEqual(env.score.textContent, "");
  assert.equal(env.canvas.width, 900);
  assert.equal(env.canvas.height, 1125);
  assert.equal(env.frames.size, 0);
  assert.equal(env.timers.size, 0);
  assert.equal(env.images.length, 1);
  env.canvas.clientWidth = 320;
  env.window.dispatchEvent(new Event("resize")); env.step(200);
  assert.equal(env.canvas.width, 960);
  assert.equal(env.frames.size, 0, "resizing repaints once without restarting animation");
  env.motion.matches = false; env.motion.dispatchEvent(new Event("change"));
  assert.equal(env.controls.pause.disabled, false);
  assert.equal(env.controls.replay.disabled, false);
  assert.equal(env.images.length, 2);
  env.step(300);
  assert.equal(env.frames.size, 1);
  env.motion.matches = true; env.motion.dispatchEvent(new Event("change")); env.step(400);
  assert.equal(env.frames.size, 0);
  assert.equal(env.timers.size, 0);
  assert.equal(env.controls.pause.disabled, true);
  assert.equal(env.controls.replay.disabled, true);
});

test("actual animated reel holds the current portrait until next decode and parks when hidden", async (t) => {
  const env = environment(t, false);
  const { mountDemoReel } = await import("./demoReel.js");
  const reel = mountDemoReel(env.canvas as unknown as HTMLCanvasElement, env.score as unknown as HTMLElement);
  env.onCleanup(() => reel.stop());
  env.images[0].load(); await flush();
  assert.equal(env.images.length, 2, "only the first and next image have been requested");
  env.step(100); env.step(9000);
  assert.equal(env.frames.size, 0, "no busy loop waiting for a network image");
  assert.notEqual(env.score.textContent, "");
  env.images[1].load(); await flush(); env.step(9100); env.step(9500);
  assert.equal(env.images.length, 3, "one further image is requested only after advancing");
  env.document.hidden = true; env.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(env.frames.size, 0);
  env.document.hidden = false; env.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(env.frames.size, 1);
  reel.stop();
  assert.equal(env.frames.size, 0);
  env.images[2].load(); await flush();
  assert.equal(env.frames.size, 0);
});

test("the readable result hold parks drawing on one timer until the next transition", async (t) => {
  const env = environment(t, false);
  const { mountDemoReel } = await import("./demoReel.js");
  const reel = mountDemoReel(env.canvas as unknown as HTMLCanvasElement, env.score as unknown as HTMLElement);
  env.onCleanup(() => reel.stop());
  env.images[0].load(); await flush();
  env.images[1].load(); await flush();
  env.step(100); env.step(5800);
  assert.equal(env.frames.size, 0, "a settled result does not repaint at display refresh rate");
  assert.equal(env.timers.size, 1);
  const before = env.draws();
  env.step(7000);
  assert.equal(env.draws(), before);
  assert.equal(env.timers.size, 1);
  env.step(8550);
  assert.ok(env.draws() > before);
  assert.equal(env.frames.size, 1, "the crossfade resumes when the reading time ends");
  assert.equal(env.timers.size, 0);
});

test("manual pause persists through visibility changes and resize repaints only once", async (t) => {
  const env = environment(t, false);
  const { mountDemoReel } = await import("./demoReel.js");
  const reel = mountDemoReel(env.canvas as unknown as HTMLCanvasElement, env.score as unknown as HTMLElement, {
    controls: env.controls as unknown as { pause: HTMLButtonElement; replay: HTMLButtonElement },
  });
  env.onCleanup(() => reel.stop());
  env.images[0].load(); await flush(); env.step(100); env.step(2000);
  assert.equal(env.controls.pause.getAttribute("aria-pressed"), "false");
  assert.equal(env.controls.pause.getAttribute("aria-label"), "Pause demo");
  env.controls.pause.click();
  assert.equal(env.controls.pause.getAttribute("aria-pressed"), "true");
  assert.equal(env.controls.pause.getAttribute("aria-label"), "Resume demo");
  assert.equal(env.frames.size, 0);
  env.document.hidden = true; env.document.dispatchEvent(new Event("visibilitychange"));
  env.advance(5000);
  env.document.hidden = false; env.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(env.frames.size, 0, "returning to a tab respects the user's Pause choice");
  assert.equal(env.timers.size, 0);
  const before = env.draws();
  env.canvas.clientWidth = 320;
  env.window.dispatchEvent(new Event("resize")); env.step(6000);
  assert.equal(env.draws(), before + 1);
  assert.equal(env.canvas.width, 960);
  assert.equal(env.frames.size, 0);
  assert.equal(env.controls.pause.getAttribute("aria-pressed"), "true");
  env.controls.pause.click();
  assert.equal(env.controls.pause.getAttribute("aria-pressed"), "false");
  assert.equal(env.frames.size, 1);
  env.step(6100);
  assert.equal(env.frames.size, 1);
});

test("a pause-only landing control needs no replay button", async (t) => {
  const env = environment(t, false);
  const { mountDemoReel } = await import("./demoReel.js");
  const reel = mountDemoReel(env.canvas as unknown as HTMLCanvasElement, env.score as unknown as HTMLElement, {
    controls: { pause: env.controls.pause as unknown as HTMLButtonElement },
  });
  env.onCleanup(() => reel.stop());
  env.images[0].load(); await flush(); env.step(100); env.step(2000);
  env.controls.pause.click();
  assert.equal(env.controls.pause.getAttribute("aria-pressed"), "true");
  assert.equal(env.frames.size, 0);
  env.controls.pause.click();
  assert.equal(env.frames.size, 1);
});

test("replay restarts the same portrait's scan instead of advancing to another face", async (t) => {
  const env = environment(t, false);
  const { mountDemoReel } = await import("./demoReel.js");
  const reel = mountDemoReel(env.canvas as unknown as HTMLCanvasElement, env.score as unknown as HTMLElement, {
    controls: env.controls as unknown as { pause: HTMLButtonElement; replay: HTMLButtonElement },
  });
  env.onCleanup(() => reel.stop());
  env.images[0].load(); await flush(); env.step(100); env.step(5800);
  assert.notEqual(env.score.textContent, "");
  assert.equal(env.timers.size, 1);
  env.controls.pause.click();
  env.controls.replay.click();
  assert.equal(env.timers.size, 0);
  assert.equal(env.controls.pause.getAttribute("aria-pressed"), "false");
  env.step(6000);
  assert.equal(env.score.textContent, "");
  assert.equal(env.drawnImages[env.drawnImages.length - 1], env.images[0]);
  assert.equal(env.images.length, 2, "replaying does not request another portrait");
  assert.equal(env.frames.size, 1);
});

test("hold timers are removed while hidden, manually paused and after disposal", async (t) => {
  const env = environment(t, false);
  const { mountDemoReel } = await import("./demoReel.js");
  const reel = mountDemoReel(env.canvas as unknown as HTMLCanvasElement, env.score as unknown as HTMLElement, {
    controls: env.controls as unknown as { pause: HTMLButtonElement; replay: HTMLButtonElement },
  });
  env.onCleanup(() => reel.stop());
  env.images[0].load(); await flush(); env.step(100); env.step(5800);
  assert.equal(env.timers.size, 1);
  env.document.hidden = true; env.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(env.timers.size, 0);
  env.advance(20_000);
  assert.equal(env.frames.size, 0);
  env.document.hidden = false; env.document.dispatchEvent(new Event("visibilitychange")); env.step(20_000);
  assert.equal(env.timers.size, 1, "resume retains remaining reading time instead of skipping the result");
  env.controls.pause.click();
  assert.equal(env.timers.size, 0);
  env.controls.pause.click(); env.step(20_000);
  assert.equal(env.timers.size, 1);
  reel.stop();
  assert.equal(env.frames.size, 0);
  assert.equal(env.timers.size, 0);
  env.controls.replay.click(); env.controls.pause.click(); env.advance(40_000);
  assert.equal(env.frames.size, 0, "disposed controls cannot revive animation");
  assert.equal(env.timers.size, 0);
});

test("enabling reduced motion during the result hold removes the scheduled transition", async (t) => {
  const env = environment(t, false);
  const { mountDemoReel } = await import("./demoReel.js");
  const reel = mountDemoReel(env.canvas as unknown as HTMLCanvasElement, env.score as unknown as HTMLElement, {
    controls: env.controls as unknown as { pause: HTMLButtonElement; replay: HTMLButtonElement },
  });
  env.onCleanup(() => reel.stop());
  env.images[0].load(); await flush(); env.step(100); env.step(5800);
  assert.equal(env.timers.size, 1);
  env.motion.matches = true;
  env.motion.dispatchEvent(new Event("change")); env.step(6000);
  assert.equal(env.timers.size, 0);
  assert.equal(env.frames.size, 0);
  assert.equal(env.controls.pause.disabled, true);
  assert.equal(env.controls.replay.disabled, true);
  assert.notEqual(env.score.textContent, "");
  const before = env.draws();
  env.controls.pause.click(); env.controls.replay.click(); env.step(20_000);
  assert.equal(env.draws(), before, "disabled controls cannot restart motion");
});
