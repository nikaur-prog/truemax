import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { SidePoints } from "../engine/sideMetrics.js";
import type { ScoredMetric } from "../engine/types.js";
import { clearMeasurementPerformance, readMeasurementPerformance } from "../engine/measurementPerformance.js";
import { animateMeasurement } from "./measureOverlay.js";
import { animateSideMeasurement } from "./sideMeasureOverlay.js";

function fixture() {
  const originals = ["window", "performance", "requestAnimationFrame", "cancelAnimationFrame"].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  let now = 100;
  let serial = 0;
  let strokes = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const context = {
    clearRect() {}, save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
    stroke() { strokes++; }, arc() {}, fill() {}, setLineDash() {},
  };
  const canvas = { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
  const globals = {
    window: { matchMedia: () => ({ matches: false }) },
    performance: { now: () => now },
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++serial, callback); return serial; },
    cancelAnimationFrame: (id: number) => { frames.delete(id); },
  };
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, value });
  clearMeasurementPerformance();
  return {
    canvas, frames, strokes: () => strokes,
    tick(time: number) { now = time; const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(now)); },
    restore() {
      clearMeasurementPerformance();
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

const landmarks = Array.from({ length: 478 }, (_, i) => ({ x: .2 + (i % 5) * .1, y: .2 + (i % 7) * .05, z: 0 })) as NormalizedLandmark[];
const profile = { gonion: { x: 20, y: 70 }, condylion: { x: 22, y: 25 }, menton: { x: 65, y: 85 } } as SidePoints;

for (const view of ["front", "side"] as const) {
  test(`${view} animation draws new geometry on its first frame and records local delay`, () => {
    const f = fixture();
    try {
      const metric = { def: { id: view === "front" ? "canthalTilt" : "gonialAngle" }, score: 6, value: 5 } as ScoredMetric;
      const animation = view === "front"
        ? animateMeasurement(f.canvas, landmarks, 100, 100, metric)
        : animateSideMeasurement(f.canvas, profile, 100, 100, metric);
      f.tick(116);
      assert.ok(f.strokes() > 0, "first frame is not a zero-progress clear");
      assert.equal(readMeasurementPerformance().samples[0].firstDrawMs, 16);
      animation.cancel();
      assert.equal(f.frames.size, 0);
      assert.equal(readMeasurementPerformance().counts.cancelledOrSuperseded, 1);
    } finally { f.restore(); }
  });
}

test("cancelled queued measurement callback cannot paint or report a first frame", () => {
  const f = fixture();
  try {
    const animation = animateMeasurement(f.canvas, landmarks, 100, 100, { def: { id: "canthalTilt" }, score: 6, value: 5 } as ScoredMetric);
    const queued = [...f.frames.values()][0];
    animation.cancel(); queued(116);
    assert.equal(f.strokes(), 0);
    assert.equal(readMeasurementPerformance().samples[0].firstDrawMs, null);
    assert.equal(readMeasurementPerformance().counts.cancelledBeforeFirstDraw, 1);
  } finally { f.restore(); }
});
