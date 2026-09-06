import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  sidePlacementDeadline,
  sidePlacementProtocolVersion,
  SIDE_PLACEMENT_SERVER_DURATION_MS,
  SIDE_PLACEMENT_MAX_TIMEOUT_MS,
} from "./sidePlacementRequest.js";

test("the side-placement cap stays below the actual deployed function budget", () => {
  const deployment = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
  assert.equal(deployment.functions["api/side-landmarks.ts"].maxDuration * 1000, SIDE_PLACEMENT_SERVER_DURATION_MS);
  assert.ok(SIDE_PLACEMENT_MAX_TIMEOUT_MS < SIDE_PLACEMENT_SERVER_DURATION_MS);
});

test("seeded and full-frame correction cohorts have distinct opaque version tags", () => {
  assert.equal(sidePlacementProtocolVersion("pass-v3", true), "pass-v3.seeded");
  assert.equal(sidePlacementProtocolVersion("pass-v3", false), "pass-v3.full");
});

test("a shared side deadline inherits retakes and disposes its listener and timer", async () => {
  const parent = new AbortController();
  const deadline = sidePlacementDeadline(10_000, parent.signal);
  parent.abort(new Error("New photo"));
  assert.equal(deadline.signal.aborted, true);
  assert.match(String(deadline.signal.reason), /New photo/);
  deadline.dispose();

  const nextParent = new AbortController();
  const next = sidePlacementDeadline(5, nextParent.signal);
  next.dispose();
  nextParent.abort();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(next.signal.aborted, false, "completed requests release both abort sources");
});

test("a side deadline fires once and preserves an already cancelled parent", async () => {
  const deadline = sidePlacementDeadline(5);
  await new Promise((resolve) => deadline.signal.addEventListener("abort", resolve, { once: true }));
  assert.equal(deadline.signal.aborted, true);
  deadline.dispose();
  const parent = new AbortController();
  parent.abort();
  const cancelled = sidePlacementDeadline(10_000, parent.signal);
  assert.equal(cancelled.signal.aborted, true);
  cancelled.dispose();
});
