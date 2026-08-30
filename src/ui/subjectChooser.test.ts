import test from "node:test";
import assert from "node:assert/strict";
import { selfLockFor } from "./subjectChooser.js";

// The gate's "Scan someone else instead" used to hand back the callback that
// runs the whole normal flow, and the chooser it landed on still offered
// "It's me". Two taps around the weekly limit, for any member.
test("arriving from the gate's guest offer closes the self option", () => {
  assert.equal(selfLockFor(false, true), "weekly");
});

test("an ordinary run leaves the self option open", () => {
  assert.equal(selfLockFor(false, false), null);
});

test("a decline closes it whatever the week says", () => {
  assert.equal(selfLockFor(true, false), "declined");
  // Both at once names the larger and more permanent fact. Telling somebody
  // their week is up when their own scans are closed indefinitely answers a
  // smaller question than the one they have.
  assert.equal(selfLockFor(true, true), "declined");
});
