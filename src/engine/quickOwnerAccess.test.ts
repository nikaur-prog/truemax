import assert from "node:assert/strict";
import test from "node:test";
import { canUseOwnerTools } from "./quickOwnerAccess.js";

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
