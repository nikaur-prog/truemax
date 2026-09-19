import assert from "node:assert/strict";
import test from "node:test";
import { createStagePaint } from "./stagePaint.js";

function fixture() {
  let hidden = false;
  const jobs = new Map<number, () => void>();
  let next = 0;
  const stage = createStagePaint((value) => { hidden = value; }, (callback) => {
    jobs.set(++next, callback); return next;
  }, (timer) => { jobs.delete(timer); });
  const flush = () => {
    const pending = [...jobs.values()]; jobs.clear();
    pending.forEach((callback) => callback());
  };
  return { stage, jobs, flush, hidden: () => hidden };
}

test("returning to the displayed view cancels both the deferred swap and its opacity", () => {
  const { stage, jobs, hidden } = fixture();
  let sidePaints = 0;
  stage.run(() => { sidePaints++; }, 150);
  const stale = [...jobs.values()][0];
  assert.equal(hidden(), true);
  stage.cancel(); // showAt returns to the front that is already painted
  assert.equal(hidden(), false);
  assert.equal(jobs.size, 0);
  stale(); // Even a queued callback must not paint over the latest request.
  assert.equal(sidePaints, 0);
});

test("rapid swaps paint only the last request and closing settles the state", () => {
  const { stage, jobs, flush, hidden } = fixture();
  const painted: string[] = [];
  stage.run(() => painted.push("side-a"), 150);
  stage.run(() => painted.push("side-b"), 150);
  assert.equal(jobs.size, 1);
  flush();
  assert.deepEqual(painted, ["side-b"]);
  assert.equal(hidden(), false);
  stage.run(() => painted.push("after-close"), 150);
  stage.cancel();
  assert.equal(hidden(), false);
  assert.equal(jobs.size, 0);
  flush();
  assert.deepEqual(painted, ["side-b"]);
});

test("reduced motion paints synchronously without a hidden frame or timer", () => {
  const { stage, jobs, hidden } = fixture();
  let painted = 0;
  stage.run(() => { painted++; assert.equal(hidden(), false); }, 0);
  assert.equal(painted, 1);
  assert.equal(jobs.size, 0);
});
