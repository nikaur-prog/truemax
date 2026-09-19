import assert from "node:assert/strict";
import test from "node:test";
import { finishPilotRecords, sharePilotStartup, waitForPilotStage } from "./calibrationPilotLifecycle.js";
import type { PilotRecord } from "./calibrationPilotData.js";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("an already-cancelled run never starts a startup stage", async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  await assert.rejects(waitForPilotStage("Test", async () => { calls++; }, controller.signal), { name: "AbortError" });
  assert.equal(calls, 0);
});

test("cancelling a hung stage promptly aborts its fetch signal", async () => {
  const controller = new AbortController();
  const reached = deferred<AbortSignal>();
  const waiting = waitForPilotStage("Provenance", (signal) => { reached.resolve(signal); return new Promise(() => {}); }, controller.signal);
  const workSignal = await reached.promise;
  controller.abort();
  await assert.rejects(waiting, { name: "AbortError" });
  assert.equal(workSignal.aborted, true);
});

test("a hung startup has a bounded deadline and aborts cancellable work", async () => {
  const reached = deferred<AbortSignal>();
  const waiting = waitForPilotStage("Provenance", (signal) => { reached.resolve(signal); return new Promise(() => {}); }, new AbortController().signal, 10);
  const signal = await reached.promise;
  await assert.rejects(waiting, /Provenance timed out after 10 ms/);
  assert.equal(signal.aborted, true);
});

test("settled stages remove their parent cancellation listener", async () => {
  const controller = new AbortController();
  let workSignal: AbortSignal | undefined;
  assert.equal(await waitForPilotStage("Test", async (signal) => { workSignal = signal; return 42; }, controller.signal), 42);
  controller.abort();
  assert.equal(workSignal!.aborted, false);
});

test("stage failures propagate, including an undefined rejection", async () => {
  const error = new Error("Failed startup");
  await assert.rejects(waitForPilotStage("Test", () => Promise.reject(error), new AbortController().signal), error);
  let rejected = false;
  await waitForPilotStage("Test", () => Promise.reject(undefined), new AbortController().signal).catch((reason) => { rejected = true; assert.equal(reason, undefined); });
  assert.equal(rejected, true);
});

test("a retry joins uncancellable detector startup after the first caller cancels", async () => {
  const attempt = deferred<number>();
  let starts = 0;
  const startup = sharePilotStartup(() => { starts++; return attempt.promise; });
  const firstController = new AbortController();
  const first = waitForPilotStage("Detector", startup, firstController.signal);
  await Promise.resolve(); await Promise.resolve();
  firstController.abort();
  await assert.rejects(first, { name: "AbortError" });
  const retry = waitForPilotStage("Detector", startup, new AbortController().signal);
  await Promise.resolve();
  assert.equal(starts, 1);
  attempt.resolve(7);
  assert.equal(await retry, 7);
});

test("timeout does not release the real detector promise and permit overlapping initialization", async () => {
  const attempt = deferred<number>();
  let starts = 0;
  const startup = sharePilotStartup(() => { starts++; return attempt.promise; });
  await assert.rejects(waitForPilotStage("Detector", startup, new AbortController().signal, 10), /timed out/);
  const retry = waitForPilotStage("Detector", startup, new AbortController().signal);
  await Promise.resolve();
  assert.equal(starts, 1);
  attempt.resolve(9);
  assert.equal(await retry, 9);
});

test("a truly failed startup can retry after its promise settles", async () => {
  let starts = 0;
  const startup = sharePilotStartup(async () => { if (++starts === 1) throw new Error("First failure"); return 4; });
  await assert.rejects(startup(), /First failure/);
  assert.equal(await startup(), 4);
  assert.equal(starts, 2);
});

test("late rejection after cancellation is handled without reviving the caller", async () => {
  const attempt = deferred<void>();
  const controller = new AbortController();
  const waiting = waitForPilotStage("Late", () => attempt.promise, controller.signal);
  await Promise.resolve(); controller.abort();
  await assert.rejects(waiting, { name: "AbortError" });
  attempt.reject(new Error("Too late"));
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test("cancellation and startup failure preserve completed diagnostics and missing records", () => {
  for (const cancelled of [true, false]) {
    const statuses: PilotRecord["status"][] = ["complete", "missing", "failed", "queued", "processing"];
    const records: PilotRecord[] = statuses.map((status) => ({
      personId: "m01", key: "m01-front", sex: "male", view: "front", filenames: [], warnings: [],
      status, failure: "original", diagnostics: { marker: status },
    }));
    const originals = records.slice(0, 3).map((record) => JSON.stringify(record));
    finishPilotRecords(records, cancelled, "Startup timeout");
    assert.deepEqual(records.slice(0, 3).map((record) => JSON.stringify(record)), originals);
    assert.equal(records[3].status, cancelled ? "cancelled" : "failed");
    assert.equal(records[4].status, cancelled ? "cancelled" : "failed");
    assert.match(records[4].failure!, cancelled ? /cancelled/ : /Startup timeout/);
  }
});
