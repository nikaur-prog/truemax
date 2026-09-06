import assert from "node:assert/strict";
import test from "node:test";
import { previewDeadline } from "./previewDeadline.js";

test("the total budget settles a hanging operation even when it ignores abort", async () => {
  const budget = previewDeadline(undefined, 10, "Timed out");
  try {
    await assert.rejects(budget.run(() => new Promise(() => {})), { name: "TimeoutError" });
    assert.equal(budget.signal.aborted, true);
  } finally { budget.dispose(); }
});

test("successive operations share the same deadline and late results cannot restore it", async () => {
  const budget = previewDeadline(undefined, 10, "Timed out");
  try {
    assert.equal(await budget.run(async () => 1), 1);
    await assert.rejects(budget.run(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return 2;
    }), { name: "TimeoutError" });
    await assert.rejects(budget.run(async () => 3), { name: "TimeoutError" });
  } finally { budget.dispose(); }
});

test("owner cancellation prevents later work, and a disposed deadline cannot abort success", async () => {
  const owner = new AbortController();
  const cancelled = previewDeadline(owner.signal, 1000, "Timed out");
  owner.abort();
  await assert.rejects(cancelled.run(async () => { assert.fail("must not run"); }), { name: "AbortError" });
  cancelled.dispose();
  const done = previewDeadline(undefined, 10, "Timed out");
  assert.equal(await done.run(async () => true), true);
  done.dispose();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(done.signal.aborted, false);
});

test("a synchronous operation cannot publish after wall time expires but before the timer task runs", async () => {
  const budget = previewDeadline(undefined, 10, "Timed out");
  try {
    await assert.rejects(budget.run(async () => {
      const until = Date.now() + 20;
      while (Date.now() < until) { /* Synthetic main-thread blocking work. */ }
      return "too late";
    }), { name: "TimeoutError" });
  } finally { budget.dispose(); }
});
