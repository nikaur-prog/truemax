import test from "node:test";
import assert from "node:assert/strict";
import { createSideAttemptOwner } from "./sideAttempt.js";

test("retaking replaces the side attempt and aborts the previous reader", () => {
  const owner = createSideAttemptOwner();
  const first = owner.begin();
  const second = owner.begin();
  assert.equal(first.aborted, true);
  assert.equal(owner.current(first), false);
  assert.equal(owner.current(second), true);
});

test("skipping or closing prevents a late side result from mounting", () => {
  const owner = createSideAttemptOwner();
  const first = owner.begin();
  owner.cancel();
  owner.cancel();
  assert.equal(first.aborted, true);
  assert.equal(owner.current(first), false);
  assert.equal(owner.current(owner.begin()), true);
});
