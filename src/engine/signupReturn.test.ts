import test from "node:test";
import assert from "node:assert/strict";
import { createSignupReturnTracker } from "./signupReturn.js";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test("ordinary login does not count as a guest signup return", () => {
  const local = storage(), session = storage(), events: string[] = [];
  const tracker = createSignupReturnTracker(() => local, () => session, (event) => events.push(event));
  tracker.finish(false);
  tracker.finish(true, "scan-one");
  assert.deepEqual(events, []);
});

test("a wall attempt records exactly one outcome and no identifiers", () => {
  const local = storage(), session = storage(), events: unknown[][] = [];
  const tracker = createSignupReturnTracker(() => local, () => session, (...args) => events.push(args));
  tracker.begin("private-local-scan-id");
  tracker.finish(true, "other-scan");
  assert.equal(events.length, 0);
  tracker.finish(true, "private-local-scan-id");
  tracker.finish(false);
  assert.deepEqual(events, [["signup-return-analysis"]]);
});

test("same-tab redirect survives reload but expires after thirty minutes", () => {
  const local = storage(), session = storage(), events: string[] = [];
  let now = 1000;
  const create = () => createSignupReturnTracker(() => local, () => session, (event) => events.push(event), () => now);
  create().begin("scan-one");
  create().finish(false);
  assert.deepEqual(events, ["signup-return-lost"]);
  create().begin("scan-two");
  now += 31 * 60 * 1000;
  create().finish(false);
  assert.equal(events.length, 1);
});

test("another tab requires the verified matching scan claim", () => {
  const local = storage(), originalSession = storage(), newSession = storage(), events: string[] = [];
  const emit = (event: string) => events.push(event);
  const original = createSignupReturnTracker(() => local, () => originalSession, emit);
  original.begin("scan-one");
  const returning = createSignupReturnTracker(() => local, () => newSession, emit);
  returning.finish(false);
  returning.bindClaim("wrong-scan");
  returning.finish(true);
  assert.deepEqual(events, []);
  returning.bindClaim("scan-one");
  returning.finish(true, "scan-one");
  original.finish(false);
  createSignupReturnTracker(() => local, () => originalSession, emit).finish(false);
  assert.deepEqual(events, ["signup-return-analysis"]);
});

test("failed auth clears its intent and blocked storage cannot break auth", () => {
  const broken = () => { throw new Error("denied"); };
  const events: string[] = [];
  const tracker = createSignupReturnTracker(broken, broken, (event) => events.push(event));
  tracker.begin("scan-one");
  tracker.clear();
  tracker.finish(false);
  assert.deepEqual(events, []);
  tracker.begin("scan-two");
  tracker.finish(true, "scan-two");
  assert.deepEqual(events, ["signup-return-analysis"]);
});
