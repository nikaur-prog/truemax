import assert from "node:assert/strict";
import test from "node:test";
import { runSideCloudAttempt } from "./sideCloudAttempt.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const input = () => ({
  enabled: true,
  mode: "calibration" as const,
  signal: new AbortController().signal,
  getAccessToken: async () => "token",
  request: async () => ({ source: "cloud" }),
});

test("device-only public and admin attempts skip authentication and upload", async () => {
  for (const mode of [undefined, "calibration"] as const) {
    let calls = 0;
    const result = await runSideCloudAttempt({
      ...input(), enabled: false, mode,
      getAccessToken: async () => { calls++; return "token"; },
      request: async () => { calls++; return { source: "cloud" }; },
    });
    assert.deepEqual(result, { status: "disabled", placement: null });
    assert.equal(calls, 0);
  }
});

test("failed authentication and null cloud responses are unavailable, not disabled", async () => {
  for (const getAccessToken of [async () => null, async () => { throw new Error("session unavailable"); }]) {
    let uploads = 0;
    const result = await runSideCloudAttempt({
      ...input(), getAccessToken,
      request: async () => { uploads++; return { source: "cloud" }; },
    });
    assert.deepEqual(result, { status: "unavailable", placement: null });
    assert.equal(uploads, 0);
  }
  const result = await runSideCloudAttempt({ ...input(), request: async () => null });
  assert.deepEqual(result, { status: "unavailable", placement: null });
});

test("successful placement keeps the exact cloud result", async () => {
  const placement = { source: "cloud", points: { nose: [12, 34] } };
  const result = await runSideCloudAttempt({ ...input(), request: async () => placement });
  assert.equal(result.status, "success");
  assert.equal(result.placement, placement);
});

test("admin deadline covers a hung token lookup and a late token cannot upload", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const token = deferred<string | null>();
  let uploads = 0;
  const pending = runSideCloudAttempt({
    ...input(), timeoutMs: 50, getAccessToken: () => token.promise,
    request: async () => { uploads++; return { source: "cloud" }; },
  });
  t.mock.timers.tick(50);
  assert.deepEqual(await pending, { status: "unavailable", placement: null });
  token.resolve("late token");
  await token.promise;
  await Promise.resolve();
  assert.equal(uploads, 0);
});

test("authentication and request share one admin deadline and abort the request", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const token = deferred<string | null>();
  const entered = deferred<AbortSignal>();
  const response = deferred<{ source: string } | null>();
  const pending = runSideCloudAttempt({
    ...input(), timeoutMs: 50, getAccessToken: () => token.promise,
    request: async (_token, signal) => { entered.resolve(signal); return response.promise; },
  });
  t.mock.timers.tick(40);
  token.resolve("token");
  const requestSignal = await entered.promise;
  assert.equal(requestSignal.aborted, false);
  t.mock.timers.tick(10);
  const result = await pending;
  assert.deepEqual(result, { status: "unavailable", placement: null });
  assert.equal(requestSignal.aborted, true);
  response.resolve({ source: "late cloud" });
  await response.promise;
  assert.deepEqual(result, { status: "unavailable", placement: null });
});

test("retake cancels a hung token lookup without an unavailable warning or late upload", async () => {
  const controller = new AbortController();
  const token = deferred<string | null>();
  let uploads = 0;
  const pending = runSideCloudAttempt({
    ...input(), signal: controller.signal, getAccessToken: () => token.promise,
    request: async () => { uploads++; return { source: "cloud" }; },
  });
  controller.abort();
  assert.deepEqual(await pending, { status: "cancelled", placement: null });
  token.resolve("late token");
  await token.promise;
  await Promise.resolve();
  assert.equal(uploads, 0);
});

test("retake aborts an in-flight request and discards a late successful result", async () => {
  const controller = new AbortController();
  const entered = deferred<AbortSignal>();
  const response = deferred<{ source: string } | null>();
  const pending = runSideCloudAttempt({
    ...input(), signal: controller.signal,
    request: async (_token, signal) => { entered.resolve(signal); return response.promise; },
  });
  const requestSignal = await entered.promise;
  controller.abort();
  const result = await pending;
  assert.deepEqual(result, { status: "cancelled", placement: null });
  assert.equal(requestSignal.aborted, true);
  response.resolve({ source: "late cloud" });
  await response.promise;
  assert.deepEqual(result, { status: "cancelled", placement: null });
});

test("an already-cancelled attempt does not read the session", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const result = await runSideCloudAttempt({
    ...input(), signal: controller.signal,
    getAccessToken: async () => { calls++; return "token"; },
  });
  assert.deepEqual(result, { status: "cancelled", placement: null });
  assert.equal(calls, 0);
});

test("public capture does not inherit the admin total deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const token = deferred<string | null>();
  const pending = runSideCloudAttempt({ ...input(), mode: undefined, timeoutMs: 5, getAccessToken: () => token.promise });
  t.mock.timers.tick(10_000);
  token.resolve("token");
  assert.deepEqual(await pending, { status: "success", placement: { source: "cloud" } });
});

test("unexpected request errors recover in admin mode and preserve public failure behavior", async () => {
  const request = async () => { throw new Error("request failed"); };
  assert.deepEqual(await runSideCloudAttempt({ ...input(), request }), { status: "unavailable", placement: null });
  await assert.rejects(runSideCloudAttempt({ ...input(), mode: undefined, request }), /request failed/);
});
