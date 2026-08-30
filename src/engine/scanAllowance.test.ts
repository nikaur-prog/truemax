import test from "node:test";
import assert from "node:assert/strict";
import {
  SCAN_WINDOW_MS,
  mergeScanTimes,
  nextScanSlotAt,
  guestAllowance,
  scansInWindow,
  weeklyAllowance,
} from "./scanAllowance.js";

const NOW = 1_756_100_000_000;
const DAY = 24 * 60 * 60 * 1000;

test("the allowance matches what the plan cards sell", () => {
  // These numbers ARE the promise — a change here must change the cards, and
  // this one did: Max's card sold "Two scans a week" and now sells "Scan up to
  // 50 other people a week".
  //
  // One personal scan on every tier. The tiers differ on other people's faces
  // instead, which is the axis Max is actually sold on and the one where
  // "unlimited" was quietly giving Starter and Max the same product.
  assert.equal(weeklyAllowance("free"), 1);
  assert.equal(weeklyAllowance("starter"), 1);
  assert.equal(weeklyAllowance("max"), 1);
});

test("guest scans are where the tiers actually differ", () => {
  assert.equal(guestAllowance("starter"), 3);
  assert.equal(guestAllowance("max"), 50);
  // Free is zero, and states it rather than leaving it implied: the subject
  // chooser is member-gated, so a free account cannot declare a guest at all.
  assert.equal(guestAllowance("free"), 0);
});

test("only scans inside the trailing week count, newest first", () => {
  const times = [NOW - 8 * DAY, NOW - 2 * DAY, NOW - 6 * DAY, NOW - 1 * DAY];
  assert.deepEqual(scansInWindow(times, NOW), [NOW - 1 * DAY, NOW - 2 * DAY, NOW - 6 * DAY]);
});

test("a corrupted stored date is dropped, not compared", () => {
  assert.deepEqual(scansInWindow([NaN, NOW - DAY, Infinity], NOW), [NOW - DAY]);
});

test("a scan exactly a week old has left the window", () => {
  assert.equal(scansInWindow([NOW - SCAN_WINDOW_MS], NOW).length, 0);
});

test("one allowance, one recent scan: locked until that scan is a week old", () => {
  const at = nextScanSlotAt([NOW - 3 * DAY], 1, NOW);
  assert.equal(at, NOW - 3 * DAY + SCAN_WINDOW_MS);
});

test("one allowance, no recent scans: open now", () => {
  assert.equal(nextScanSlotAt([NOW - 9 * DAY], 1, NOW), null);
});

// The Max case this module exists for: the second scan of the week passes.
test("two allowance, one scan held: the second scan is open now", () => {
  assert.equal(nextScanSlotAt([NOW - 2 * DAY], 2, NOW), null);
});

// And the slot frees when the OLDER scan leaves the window. Keying off the
// newest would turn two-a-week into two-then-a-week-of-famine.
test("two allowance, both held: unlocks when the older scan is a week old", () => {
  const older = NOW - 5 * DAY;
  const newer = NOW - 1 * DAY;
  assert.equal(nextScanSlotAt([newer, older], 2, NOW), older + SCAN_WINDOW_MS);
});

test("a downgraded allowance still unlocks off the right scan", () => {
  // Three scans held from a Max week; the account is now Starter (allowance
  // 1). The slot is held by the most recent scan alone.
  const t = [NOW - 1 * DAY, NOW - 2 * DAY, NOW - 3 * DAY];
  assert.equal(nextScanSlotAt(t, 1, NOW), NOW - 1 * DAY + SCAN_WINDOW_MS);
});

test("the completion stamp and its own history entry count once", () => {
  const scanAt = NOW - 2 * DAY;
  // The stamp is written moments after the history entry, same completion.
  const merged = mergeScanTimes(scanAt + 40_000, [scanAt]);
  assert.equal(merged.length, 1);
});

test("a stamp with no matching history entry is a real scan", () => {
  // History can miss a scan (storage raced, a guest cleanup); the stamp is
  // then the only witness and must still hold its slot.
  const merged = mergeScanTimes(NOW - 3 * DAY, [NOW - 6 * DAY]);
  assert.equal(merged.length, 2);
});
