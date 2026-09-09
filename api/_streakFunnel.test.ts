import assert from "node:assert/strict";
import test from "node:test";
import { recordStreakFunnel } from "./_streakFunnel.js";

test("both Settings choices bump their aggregate event without identity or payload data", async () => {
  const calls: unknown[] = [];
  await recordStreakFunnel({ rpc: async (name, args) => {
    calls.push([name, args]);
    return { error: null };
  } }, ["streak-disabled", "streak-enabled"], () => assert.fail("no failure expected"));
  assert.deepEqual(calls, [
    ["bump_funnel_event", { p_event: "streak-disabled" }],
    ["bump_funnel_event", { p_event: "streak-enabled" }],
  ]);
});

test("returned database errors are reported without rejecting an already-saved setting", async () => {
  const failures: unknown[] = [];
  let calls = 0;
  await recordStreakFunnel({ rpc: async () => {
    calls++;
    return { error: { message: "counter unavailable" } };
  } }, ["streak-disabled"], (event, error) => failures.push([event, (error as Error).message]));
  assert.deepEqual(failures, [["streak-disabled", "counter unavailable"]]);
  assert.equal(calls, 1, "an uncertain counter write is not retried");
});

test("a rejected counter cannot suppress the independent ended-run event", async () => {
  const calls: string[] = [];
  const failures: string[] = [];
  await recordStreakFunnel({ rpc: async (_name, args) => {
    calls.push(args.p_event);
    if (args.p_event === "streak-day-counted") throw new Error("connection interrupted");
    return { error: null };
  } }, ["streak-day-counted", "streak-ended"], (event) => failures.push(event));
  assert.deepEqual(calls, ["streak-day-counted", "streak-ended"]);
  assert.deepEqual(failures, ["streak-day-counted"]);
});
