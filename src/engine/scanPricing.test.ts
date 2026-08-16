import assert from "node:assert/strict";
import test from "node:test";
import {
  SCAN_PRICE_MEMBER,
  SCAN_PRICE_STANDARD,
  isMemberPricing,
  scanPrice,
  setMemberPricing,
} from "./scanPricing.js";

// The default is the one that matters. Everything else in this module is a
// setter, but the starting value decides what somebody is quoted before any
// entitlement has come back, and quoting the member price to a non-member is
// a promise the checkout will not keep.
test("quotes the standard price until an entitlement says otherwise", () => {
  assert.equal(isMemberPricing(), false);
  assert.equal(scanPrice(), SCAN_PRICE_STANDARD);
});

test("quotes the member price to members", () => {
  setMemberPricing(true);
  assert.equal(scanPrice(), SCAN_PRICE_MEMBER);
  setMemberPricing(false);
  assert.equal(scanPrice(), SCAN_PRICE_STANDARD);
});

// A failed entitlement read calls setMemberPricing(false), so this has to be
// able to come back DOWN as well as up. A one-way flag would leave a member
// price on screen for an account whose subscription had lapsed.
test("membership can be revoked as well as granted", () => {
  setMemberPricing(true);
  setMemberPricing(false);
  assert.equal(isMemberPricing(), false);
  assert.equal(scanPrice(), SCAN_PRICE_STANDARD);
});

// The two prices must differ, or the member surface is quietly pointless.
test("the two prices are different numbers", () => {
  assert.notEqual(SCAN_PRICE_STANDARD, SCAN_PRICE_MEMBER);
});
