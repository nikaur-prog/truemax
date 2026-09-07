import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import type { ReelFace } from "./demoReelData.js";
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
  assert.deepEqual(outs.map((row) => row.id), ["eyes", "chin", "jaw"]);
  assert.notEqual(read(face, 320, 250, 18).placed, placed);
  assert.equal(read(face, 320, 250, 18).outs, outs);
  assert.equal(JSON.stringify(face), before);
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
  const images: ImageStub[] = [];
  const motion = Object.assign(new EventTarget(), { matches: reduced });
  const document = Object.assign(new EventTarget(), { hidden: false, querySelector: () => null });
  const window = Object.assign(new EventTarget(), { devicePixelRatio: 3, matchMedia: () => motion });
  const gradient = { addColorStop() {} };
  const context = new Proxy<Record<string, unknown>>({
    drawImage: () => { draws++; },
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
  return { frames, images, motion, document, window, canvas, score, draws: () => draws,
    onCleanup(dispose: () => void) { cleanup.push(dispose); },
    step(time: number) {
      now = time;
      const pending = [...frames.values()]; frames.clear();
      pending.forEach((callback) => callback(now));
    },
  };
}

test("actual reduced-motion reel paints a sharp static result with only one portrait", async (t) => {
  const env = environment(t, true);
  const { mountDemoReel } = await import("./demoReel.js");
  const reel = mountDemoReel(env.canvas as unknown as HTMLCanvasElement, env.score as unknown as HTMLElement);
  env.onCleanup(() => reel.stop());
  assert.equal(env.images.length, 1);
  assert.equal(env.frames.size, 0, "no polling before the first image is ready");
  env.images[0].load(); await flush(); env.step(100);
  assert.ok(env.draws() > 0);
  assert.notEqual(env.score.textContent, "");
  assert.equal(env.canvas.width, 900);
  assert.equal(env.canvas.height, 1125);
  assert.equal(env.frames.size, 0);
  assert.equal(env.images.length, 1);
  env.canvas.clientWidth = 320;
  env.window.dispatchEvent(new Event("resize")); env.step(200);
  assert.equal(env.canvas.width, 960);
  assert.equal(env.frames.size, 0, "resizing repaints once without restarting animation");
  env.motion.matches = false; env.motion.dispatchEvent(new Event("change"));
  assert.equal(env.images.length, 2);
  env.step(300);
  assert.equal(env.frames.size, 1);
  env.motion.matches = true; env.motion.dispatchEvent(new Event("change")); env.step(400);
  assert.equal(env.frames.size, 0);
});

test("actual animated reel holds the current portrait until next decode and parks when hidden", async (t) => {
  const env = environment(t, false);
  const { mountDemoReel } = await import("./demoReel.js");
  const reel = mountDemoReel(env.canvas as unknown as HTMLCanvasElement, env.score as unknown as HTMLElement);
  env.onCleanup(() => reel.stop());
  env.images[0].load(); await flush();
  assert.equal(env.images.length, 2, "only the first and next image have been requested");
  env.step(100); env.step(7000);
  assert.equal(env.frames.size, 0, "no busy loop waiting for a network image");
  assert.notEqual(env.score.textContent, "");
  env.images[1].load(); await flush(); env.step(7100); env.step(7500);
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
