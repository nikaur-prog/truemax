import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { AUTH_SETTINGS_DEADLINE_MS, withAuthDeadline } from "./authDeadline.js";
import { authStorageKey, authUrlCandidates } from "./auth.js";

test("a successful auth-settings probe returns its result and disarms the deadline", async () => {
  let signal: AbortSignal | undefined;
  const response = new Response("{}", { status: 200 });
  assert.equal(await withAuthDeadline(async (value) => { signal = value; return response; }, 15), response);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(signal?.aborted, false, "a completed probe must not fire its abort timer later");
  assert.equal(AUTH_SETTINGS_DEADLINE_MS, 3_000);
});

test("an unreachable branded host settles at the deadline even when fetch ignores abort", async () => {
  let signal: AbortSignal | undefined;
  await assert.rejects(withAuthDeadline((value) => {
    signal = value;
    return new Promise<Response>(() => {});
  }, 10), /Auth settings request timed out/);
  assert.equal(signal?.aborted, true);
});

test("network failures and synchronous request failures are preserved for the known-project fallback", async () => {
  const failure = new TypeError("Failed to fetch");
  await assert.rejects(withAuthDeadline(async () => { throw failure; }, 15), (error) => error === failure);
  await assert.rejects(withAuthDeadline(() => { throw failure; }, 15), (error) => error === failure);
});

test("a stalled provider-settings body is bounded, not only the response headers", async () => {
  let signal: AbortSignal | undefined;
  await assert.rejects(withAuthDeadline(async (value) => {
    signal = value;
    const response = { json: () => new Promise<unknown>(() => {}) };
    return response.json();
  }, 10), /Auth settings request timed out/);
  assert.equal(signal?.aborted, true);
});

test("a late probe completion cannot change the already-selected project fallback", async () => {
  let finish: ((ready: boolean) => void) | undefined;
  let selected = "branded";
  await withAuthDeadline(() => new Promise<boolean>((resolve) => { finish = resolve; }), 10)
    .catch(() => { selected = "project"; });
  finish?.(true);
  await Promise.resolve();
  assert.equal(selected, "project");
});

test("bounded readiness is wired without expanding fallback identities or moving session storage", () => {
  const source = readFileSync(new URL("./auth.ts", import.meta.url), "utf8");
  assert.match(source, /const response = await withAuthDeadline\(\(signal\) => fetch\(`\$\{primary\}\/auth\/v1\/settings`/);
  assert.match(source, /return \{ \.\.\.env, url: fallback \}/);
  assert.match(source, /return await withAuthDeadline\(async \(signal\) =>/);
  assert.match(source, /storageKey: authStorageKey\(env\.url\)/);
  const [branded, fallback] = authUrlCandidates("https://auth.truemax.app");
  assert.equal(fallback, "https://ruvgkrlfmixfnmnzqgap.supabase.co");
  assert.equal(authStorageKey(branded), authStorageKey(fallback));
  assert.deepEqual(authUrlCandidates("https://staging-example.supabase.co"), ["https://staging-example.supabase.co"]);
});
