import assert from "node:assert/strict";
import test from "node:test";
import { payoutSetupAudience, staffPayoutSetupHTML } from "./payoutSetup.js";

test("a staff-only dashboard does not impersonate an approved creator for payouts", () => {
  assert.equal(payoutSetupAudience(true), "staff");
  assert.doesNotMatch(staffPayoutSetupHTML(), /could not be checked|reload/i);
  assert.match(staffPayoutSetupHTML(), /Approved creators/);
});

test("an approved creator still receives the payout setup flow", () => {
  assert.equal(payoutSetupAudience(false), "creator");
});
