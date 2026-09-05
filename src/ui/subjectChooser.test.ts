import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selfLockFor } from "./subjectChooser.js";

const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
const gate = readFileSync(new URL("./scanGate.ts", import.meta.url), "utf8");

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

test("the signed-in chooser waits for access and staff keeps guest testing", () => {
  assert.match(main, /await refreshMaxAccess\(\);[\s\S]{0,300}?openSubjectChooser/);
  assert.match(main, /owner !== activeScanOwner\(\) \|\| generation !== scanGeneration/);
  assert.match(main, /guestScansLeft\(lastKnownTier, declinedNow\(\), lastKnownAdmin\)/);
  assert.match(main, /guestAllowance\(lastKnownTier, declinedNow\(\), lastKnownAdmin\)/);
});

test("zero plan allowance is not described as already used", () => {
  const chooser = readFileSync(new URL("./subjectChooser.ts", import.meta.url), "utf8");
  assert.match(chooser, /guestLimit === 0[\s\S]{0,140}?included with Starter and Max/);
});

test("reopening one immutable scan cannot consume another guest slot", () => {
  assert.match(main, /const existingScan = historyBefore\.some[\s\S]{0,900}?if \(!existingScan\) recordScanRun/);
});

test("the personal gate calls every account's scan weekly", () => {
  assert.match(gate, /const title = "You've used your weekly scan\."/);
  assert.doesNotMatch(gate, /const title[\s\S]{0,140}?free scan/);
  assert.match(gate, /uses your separate plan allowance/);
  assert.doesNotMatch(gate, /Scanning a friend is always free/);
});
