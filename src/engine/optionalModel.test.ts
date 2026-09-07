import assert from "node:assert/strict";
import test from "node:test";
import { createOptionalModelLoader } from "./optionalModel.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("foreground wait is bounded while the shared warm-up remains reusable", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const model = deferred<object>();
  let calls = 0;
  const loader = createOptionalModelLoader(() => { calls++; return model.promise; }, () => {}, 100);
  const first = loader.load(10);
  await flush();
  t.mock.timers.tick(10);
  assert.equal(await first, null);
  const value = {};
  model.resolve(value);
  await flush();
  assert.equal(await loader.load(10), value);
  assert.equal(calls, 1);
});

test("a hanging initialization is retired and its late value cannot overwrite the retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const first = deferred<object>(), second = deferred<object>();
  const closed: object[] = [];
  let calls = 0;
  const loader = createOptionalModelLoader(() => (++calls === 1 ? first : second).promise, (value) => closed.push(value), 100);
  const expired = loader.load();
  await flush();
  t.mock.timers.tick(100);
  assert.equal(await expired, null);
  const retried = loader.load();
  await flush();
  const fresh = {}, stale = {};
  second.resolve(fresh);
  assert.equal(await retried, fresh);
  first.resolve(stale);
  await flush();
  assert.deepEqual(closed, [stale]);
  assert.equal(await loader.load(), fresh);
});

test("failed initialization retries and concurrent callers share one constructor", async () => {
  const pending = deferred<object>();
  let calls = 0;
  const loader = createOptionalModelLoader(() => ++calls === 1 ? Promise.reject(new Error("offline")) : pending.promise, () => {});
  assert.equal(await loader.load(), null);
  const a = loader.load(), b = loader.load();
  await flush();
  assert.equal(calls, 2);
  const value = {};
  pending.resolve(value);
  assert.equal(await a, value);
  assert.equal(await b, value);
});

test("abort settles the caller without publishing a late model to it", async () => {
  const pending = deferred<object>();
  let calls = 0;
  const loader = createOptionalModelLoader(() => { calls++; return pending.promise; }, () => {});
  const cancelled = new AbortController(); cancelled.abort();
  assert.equal(await loader.load(100, cancelled.signal), null);
  assert.equal(calls, 0);
  const controller = new AbortController();
  const waiting = loader.load(100, controller.signal);
  controller.abort();
  assert.equal(await waiting, null);
  const value = {};
  pending.resolve(value);
  await flush();
  assert.equal(await loader.load(), value, "a different live scan may use the shared warm-up");
});

test("cleanup failure on a retired resource does not reject the new attempt", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = deferred<object>();
  const loader = createOptionalModelLoader(() => pending.promise, () => { throw new Error("already closed"); }, 10);
  const run = loader.load();
  await flush();
  t.mock.timers.tick(10);
  assert.equal(await run, null);
  pending.resolve({});
  await flush();
});
