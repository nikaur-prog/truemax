import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { drawCalm, transitionRegion } from "./overlay.js";

function fixture(reduced = false) {
  const originals = ["document", "window", "requestAnimationFrame", "cancelAnimationFrame"].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const frames = new Map<number, FrameRequestCallback>();
  let serial = 0;
  class Canvas {
    resizes = 0;
    _width = 0;
    _height = 0;
    lines = 0;
    circles = 0;
    copies = 0;
    get width() { return this._width; }
    set width(n: number) { this.resizes++; this._width = n; }
    get height() { return this._height; }
    set height(n: number) { this.resizes++; this._height = n; }
    context = {
      reset() {}, clearRect() {}, beginPath() {}, moveTo() {}, stroke() {}, fill() {},
      lineTo: () => { this.lines++; },
      arc: () => { this.circles++; },
      drawImage: () => { this.copies++; },
    };
    getContext() { return this.context; }
  }
  const buffers: Canvas[] = [];
  const globals = {
    document: { createElement() { const canvas = new Canvas(); buffers.push(canvas); return canvas; } },
    window: { matchMedia: () => ({ matches: reduced }) },
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++serial, callback); return serial; },
    cancelAnimationFrame: (id: number) => { frames.delete(id); },
  };
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, value });
  const owner = new Canvas();
  return {
    owner, buffers, frames,
    canvas: owner as unknown as HTMLCanvasElement,
    tick(now: number) { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(now)); },
    restore() {
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

const landmarks = () => Array.from({ length: 478 }, (_, i) => ({ x: (i % 23) / 25, y: Math.floor(i / 23) / 25, z: 0 })) as NormalizedLandmark[];

test("calm mesh is cached across hovers, but invalidates on edited coordinates and resize", () => {
  const f = fixture();
  try {
    const points = landmarks();
    drawCalm(f.canvas, points, 1200, 1600, [1, 2]);
    assert.equal(f.buffers.length, 1);
    const mesh = f.buffers[0];
    const lines = mesh.lines;
    assert.ok(lines > 1000, "fixture exercised the real tessellation");
    for (let i = 0; i < 20; i++) drawCalm(f.canvas, points, 1200, 1600, [3, 4]);
    assert.equal(mesh.lines, lines, "stationary tessellation is not retraced per hover");
    assert.equal(f.owner.resizes, 2, "same-sized calm paints do not reallocate the visible canvas");
    points[1].x += .01;
    drawCalm(f.canvas, points, 1200, 1600);
    assert.equal(mesh.lines, 2 * lines, "in-place edits invalidate cached geometry");
    drawCalm(f.canvas, points, 600, 800);
    assert.equal(mesh.lines, 3 * lines);
    assert.equal(f.buffers.length, 1, "resize reuses the existing buffer");
  } finally { f.restore(); }
});

test("region frames reuse stationary mesh and dots instead of redrawing them", async () => {
  const f = fixture();
  try {
    const animation = transitionRegion(f.canvas, landmarks(), 1200, 1600, [1, 2], [3, 4]);
    const stationaryWork = f.buffers.map((canvas) => ({ lines: canvas.lines, circles: canvas.circles }));
    for (const now of [1, 80, 160, 240, 400]) f.tick(now);
    await animation.done;
    assert.deepEqual(f.buffers.map((canvas) => ({ lines: canvas.lines, circles: canvas.circles })), stationaryWork);
    assert.equal(f.owner.copies, 5, "one stationary-layer copy per frame");
    assert.equal(f.frames.size, 0);
  } finally { f.restore(); }
});

test("reduced-motion region is complete synchronously and never schedules frames", async () => {
  const f = fixture(true);
  try {
    const animation = transitionRegion(f.canvas, landmarks(), 1200, 1600, [1, 2], [3, 4]);
    assert.equal(f.frames.size, 0);
    assert.equal(f.owner.circles, 478);
    await animation.done;
    animation.cancel();
  } finally { f.restore(); }
});
