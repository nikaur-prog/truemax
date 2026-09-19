import assert from "node:assert/strict";
import test from "node:test";
import { createMeasurementPerformanceRecorder } from "./measurementPerformance.js";

test("interaction timing captures first actual drawing and cancellation idempotently", () => {
  let now = 100;
  const recorder = createMeasurementPerformanceRecorder(() => now);
  const first = recorder.start("front");
  now = 117.2; first.drawn();
  now = 133; first.drawn();
  now = 150; first.finish("cancelled"); first.finish("completed");
  const next = recorder.start("side");
  now = 151; next.finish("cancelled");
  const read = recorder.read();
  assert.deepEqual(read.samples, [
    { view: "front", firstDrawMs: 17.2, durationMs: 50, outcome: "cancelled" },
    { view: "side", firstDrawMs: null, durationMs: 1, outcome: "cancelled" },
  ]);
  assert.equal(read.counts.cancelledOrSuperseded, 2);
  assert.equal(read.counts.cancelledBeforeFirstDraw, 1);
});

test("timings are bounded, copied, clearable, and contain no measurement or identity data", () => {
  let now = 0;
  const recorder = createMeasurementPerformanceRecorder(() => now);
  for (let i = 0; i < 100; i++) {
    const interaction = recorder.start("front");
    now++; interaction.drawn(); interaction.finish("completed");
  }
  const copy = recorder.read();
  assert.equal(copy.samples.length, 64);
  assert.deepEqual(Object.keys(copy.samples[0]).sort(), ["durationMs", "firstDrawMs", "outcome", "view"]);
  copy.samples[0].durationMs = 999;
  assert.equal(recorder.read().samples[0].durationMs, 1);
  const pending = recorder.start("side");
  recorder.clear(); pending.finish("cancelled");
  assert.equal(recorder.read().samples.length, 0);
  assert.equal(recorder.read().counts.requested, 0);
  assert.equal(recorder.read().counts.cancelledOrSuperseded, 0);
});
