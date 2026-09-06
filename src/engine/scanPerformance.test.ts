import test from "node:test";
import assert from "node:assert/strict";
import { createScanPerformanceRecorder, type ScanPerformanceStage } from "./scanPerformance.js";

test("records bounded durations and fixed stages without timestamps or personal fields", () => {
  let clock = 100;
  const recorder = createScanPerformanceRecorder(() => clock);
  const attempt = recorder.startAttempt();
  const finish = attempt.start("capture_review");
  clock = 145.6;
  finish();
  clock = 200;
  attempt.finish();
  assert.deepEqual(recorder.read(), [{
    attempt: 1, durationMs: 100, outcome: "success",
    stages: [{ stage: "capture_review", durationMs: 46, outcome: "success" }],
  }]);
  recorder.read()[0].stages[0].durationMs = 999;
  assert.equal(recorder.read()[0].stages[0].durationMs, 46, "snapshots do not expose mutable recorder state");
});

test("duplicate stages, rerenders, finished attempts and late continuations do not record twice", () => {
  let clock = 0;
  const recorder = createScanPerformanceRecorder(() => clock);
  const attempt = recorder.startAttempt();
  const end = attempt.start("front_inference");
  clock = 20;
  end("success");
  end("error");
  attempt.start("front_inference")();
  const abandoned = attempt.start("side_cloud");
  clock = 30;
  attempt.cancel();
  clock = 40;
  abandoned();
  attempt.start("report_paint")();
  attempt.finish();
  assert.deepEqual(recorder.read()[0], {
    attempt: 1, durationMs: 30, outcome: "cancelled", stages: [
      { stage: "front_inference", durationMs: 20, outcome: "success" },
      { stage: "side_cloud", durationMs: 10, outcome: "cancelled" },
    ],
  });
});

test("keeps only eight attempts and clearing invalidates all outstanding stage handles", () => {
  const recorder = createScanPerformanceRecorder(() => 0);
  const evicted = recorder.startAttempt();
  for (let index = 0; index < 8; index++) recorder.startAttempt().finish();
  evicted.start("download")();
  assert.equal(recorder.read().length, 8);
  assert.equal(recorder.read()[0].attempt, 2);
  const active = recorder.startAttempt();
  const end = active.start("side_cloud");
  recorder.clear();
  end();
  active.finish();
  assert.deepEqual(recorder.read(), []);
});

test("invalid runtime stages cannot smuggle data, and odd clocks cannot emit unbounded numbers", () => {
  let clock = 0;
  const recorder = createScanPerformanceRecorder(() => clock);
  const attempt = recorder.startAttempt();
  attempt.start("photo-data" as ScanPerformanceStage)();
  const download = attempt.start("download");
  clock = -50;
  download();
  const init = attempt.start("model_init");
  clock = Number.POSITIVE_INFINITY;
  init();
  clock = 90_000_000;
  attempt.finish();
  const [result] = recorder.read();
  assert.equal(result.stages.length, 2);
  assert.equal(result.stages[0].durationMs, 0);
  assert.ok(result.stages.every((stage) => Number.isFinite(stage.durationMs)));
  assert.equal(result.durationMs, 1_800_000);
});
