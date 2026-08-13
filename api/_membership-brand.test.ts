import assert from "node:assert/strict";
import test from "node:test";
import { membershipBrand } from "../src/ui/membershipBrand.js";

test("a signed-out visitor always gets the disabled guest identity", () => {
  assert.equal(membershipBrand(false, false), "guest");
  assert.equal(membershipBrand(false, true), "guest");
});

test("a signed-in free member gets the green member identity", () => {
  assert.equal(membershipBrand(true, false), "member");
});

test("only a signed-in active Max entitlement gets the Max identity", () => {
  assert.equal(membershipBrand(true, true), "max");
});
