import assert from "node:assert/strict";
import test from "node:test";
import { ageOnDate, isAdult } from "./age.js";

const TODAY = new Date("2026-08-12T12:00:00Z");

test("age calculation handles the eighteenth birthday exactly", () => {
  assert.equal(ageOnDate("2008-08-12", TODAY), 18);
  assert.equal(isAdult("2008-08-12", TODAY), true);
  assert.equal(isAdult("2008-08-13", TODAY), false);
});

test("age calculation rejects impossible and future dates", () => {
  assert.equal(ageOnDate("2026-02-30", TODAY), null);
  assert.equal(ageOnDate("2027-01-01", TODAY), null);
  assert.equal(ageOnDate("not-a-date", TODAY), null);
});
