import assert from "node:assert/strict";
import test from "node:test";
import { leagueEntry } from "./dashboardAccess.js";

test("staff can reach the admin toolroom without an approved creator application", () => {
  for (const status of [null, "applied", "paused", "rejected"]) {
    assert.equal(leagueEntry(true, status), "staff");
  }
  assert.equal(leagueEntry(true, "approved"), "creator", "retain a staff member's real approved creator dashboard");
});

test("ordinary applicants cannot gain staff access through a creator status", () => {
  assert.equal(leagueEntry(false, null), "apply");
  assert.equal(leagueEntry(false, "approved"), "creator");
  for (const status of ["applied", "paused", "rejected", "owner", "admin"]) {
    assert.equal(leagueEntry(false, status), "status");
  }
});
