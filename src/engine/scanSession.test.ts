import assert from "node:assert/strict";
import test from "node:test";
import { ScanSession } from "./scanSession.js";

const FIRST = "10000000-0000-4000-8000-000000000001";
const SECOND = "20000000-0000-4000-8000-000000000002";

test("a scan has an immutable ID and explicit lifecycle", () => {
  const session = new ScanSession();
  const token = session.begin("anonymous:tab-a", "upload", FIRST);
  assert.ok(Object.isFrozen(token));
  assert.deepEqual(session.snapshot(), {
    phase: "front",
    scanId: FIRST,
    owner: "anonymous:tab-a",
    source: "upload",
    epoch: 1,
  });
  assert.equal(session.transition(token, "side"), true);
  assert.equal(session.transition(token, "gate"), true);
  assert.equal(session.transition(token, "analyzing"), true);
  assert.equal(session.transition(token, "results"), true);
  assert.equal(session.snapshot().scanId, FIRST);
});

test("invalid transitions are rejected without mutating the scan", () => {
  const session = new ScanSession();
  const token = session.begin("user:one", "camera", FIRST);
  assert.equal(session.transition(token, "results"), false);
  assert.equal(session.snapshot().phase, "front");
});

test("cancelling a result-side edit returns to the same result", () => {
  const session = new ScanSession();
  const token = session.begin("user:one", "camera", FIRST);
  session.transition(token, "side");
  session.transition(token, "analyzing");
  session.transition(token, "results");
  assert.equal(session.transition(token, "side"), true);
  assert.equal(session.transition(token, "results"), true);
  assert.equal(session.snapshot().scanId, FIRST);
});

test("reset and a new scan invalidate every stale callback token", () => {
  const session = new ScanSession();
  const stale = session.begin("user:one", "upload", FIRST);
  session.reset();
  assert.equal(session.isCurrent(stale), false);

  const current = session.begin("user:one", "camera", SECOND);
  assert.equal(session.isCurrent(stale), false);
  assert.equal(session.isCurrent(current, "user:one"), true);
});

test("an in-tab anonymous claim preserves the scan and changes its owner only", () => {
  const session = new ScanSession();
  const token = session.begin("anonymous:tab-a", "upload", FIRST);
  assert.deepEqual(session.claim(token, "user:account-a"), token);
  assert.equal(session.isCurrent(token, "anonymous:tab-a"), false);
  assert.equal(session.isCurrent(token, "user:account-a"), true);
  assert.equal(session.snapshot().scanId, FIRST);
});

test("a restored scan keeps its persisted ID but gets a fresh epoch", () => {
  const session = new ScanSession();
  const beforeNavigation = session.begin("anonymous:tab-a", "upload", FIRST);
  const restored = session.resume("user:account-a", FIRST);
  assert.equal(session.isCurrent(beforeNavigation), false);
  assert.equal(session.isCurrent(restored, "user:account-a"), true);
  assert.equal(session.snapshot().source, "restored");
  assert.equal(session.snapshot().phase, "gate");
});
