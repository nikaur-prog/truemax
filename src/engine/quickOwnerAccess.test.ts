import assert from "node:assert/strict";
import test from "node:test";
import { canUseOwnerTools, quickOwnerScopeTransition } from "./quickOwnerAccess.js";

const owner = { allowed: true, staff: true, owner: true, userId: "owner-id" };

test("only the current server-resolved owner admin can use calibration", () => {
  assert.equal(canUseOwnerTools(owner, "owner-id"), true);
  assert.equal(canUseOwnerTools(null, "owner-id"), false);
  assert.equal(canUseOwnerTools(owner, null), false);
  assert.equal(canUseOwnerTools(owner, "next-account"), false);
  assert.equal(canUseOwnerTools({ ...owner, allowed: false }, "owner-id"), false);
  assert.equal(canUseOwnerTools({ ...owner, owner: false }, "owner-id"), false, "ordinary staff are not owner admins");
  assert.equal(canUseOwnerTools({ ...owner, staff: false }, "owner-id"), false, "an inconsistent owner claim is refused");
  assert.equal(canUseOwnerTools({ ...owner, staff: false, owner: false }, "owner-id"), false, "approved creators do not get calibration");
});

test("same-account auth refresh keeps raw grant identity instead of a prefixed storage scope", () => {
  const initial = quickOwnerScopeTransition(undefined, "user:owner-id");
  assert.deepEqual(initial, { userId: "owner-id", changed: false });
  assert.equal(canUseOwnerTools(owner, initial.userId), true);
  const refreshed = quickOwnerScopeTransition("user:owner-id", "user:owner-id");
  assert.deepEqual(refreshed, initial);
  assert.equal(canUseOwnerTools(owner, refreshed.userId), true);
  assert.equal(canUseOwnerTools(owner, "user:owner-id"), false, "a storage key is never accepted as an Auth identity");
});

test("signout and account changes require draft clearing and cannot inherit the previous owner's grant", () => {
  for (const next of [null, "anonymous:next", "user:other-id"]) {
    const transition = quickOwnerScopeTransition("user:owner-id", next);
    assert.equal(transition.changed, true);
    assert.equal(canUseOwnerTools(owner, transition.userId), false);
  }
  for (const next of [null, "anonymous:owner-id", "owner-id", "user:"]) {
    assert.equal(quickOwnerScopeTransition(undefined, next).userId, null);
  }
});
