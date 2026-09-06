import test from "node:test";
import assert from "node:assert/strict";
import { createPreviewCadence, createPreviewLoop, previewIsVisible } from "./previewLoop.js";

test("returning to a tab does not resume an offscreen or covered preview", () => {
  assert.equal(previewIsVisible(true, true, true, false), true);
  assert.equal(previewIsVisible(false, true, true, false), false);
  assert.equal(previewIsVisible(true, false, true, false), false);
  assert.equal(previewIsVisible(true, true, true, true), false);
  assert.equal(previewIsVisible(true, true, false, false), false);
});

test("fast guidance samples at most ten times per second", () => {
  const cadence = createPreviewCadence();
  let samples = 0;
  for (let now = 0; now < 1000; now += 1000 / 60) {
    if (!cadence.due(now)) continue;
    cadence.measured(now, now + 12);
    samples++;
  }
  assert.ok(samples >= 9 && samples <= 10);
});

test("slow inference leaves a matching idle interval for touch and paint", () => {
  const cadence = createPreviewCadence();
  cadence.measured(0, 140);
  assert.equal(cadence.due(279), false);
  assert.equal(cadence.due(280), true);
  cadence.reset();
  assert.equal(cadence.due(0), true);
});

function clock() {
  let id = 0;
  const pending = new Map<number, FrameRequestCallback>();
  return {
    pending,
    request(callback: FrameRequestCallback) { pending.set(++id, callback); return id; },
    cancel(id: number) { pending.delete(id); },
    step() {
      const batch = [...pending.values()];
      pending.clear();
      batch.forEach((callback) => callback(0));
    },
  };
}

test("stopping from inside a readiness callback cannot resurrect the loop", () => {
  const frames = clock();
  let called = 0;
  const loop = createPreviewLoop(() => { called++; loop.pause(); }, frames);
  loop.resume();
  frames.step();
  assert.equal(called, 1);
  assert.equal(frames.pending.size, 0);
  frames.step();
  assert.equal(called, 1);
});

test("background pause cancels work and repeated resume keeps one chain", () => {
  const frames = clock();
  let called = 0;
  const loop = createPreviewLoop(() => { called++; }, frames);
  loop.resume();
  loop.resume();
  assert.equal(frames.pending.size, 1);
  loop.pause();
  frames.step();
  assert.equal(called, 0);
  loop.resume();
  frames.step();
  assert.equal(called, 1);
  assert.equal(frames.pending.size, 1);
  loop.pause();
});
