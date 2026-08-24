import test from "node:test";
import assert from "node:assert/strict";
import { CURRENT_SCORE_VERSION, comparableScans, ownScans } from "./history.js";
import type { StoredScan } from "./history.js";

// ---------------------------------------------------------------------------
// A friend's face is not a data point about yours.
//
// The screenshot that motivated this: an account whose history read
// "Aug 25 · 5.2 · −0.7 · VS WOMEN" at the top of a male trend — somebody else
// scanned on the owner's phone, stored as the owner, and handed a delta
// computed against the owner's own last scan. These pin the split: guest scans
// are RECORDS (kept, listed, labelled) and never PROGRESS (trend, average,
// streak, deltas, Max).
// ---------------------------------------------------------------------------

const scan = (overall: number, subject?: { name: string }): StoredScan => ({
  scanId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(Math.round(overall * 10)).padStart(12, "0")}`,
  date: "2026-08-20T10:00:00.000Z",
  sex: "male",
  overall,
  regions: { jaw: overall },
  scoreVersion: CURRENT_SCORE_VERSION,
  ...(subject ? { subject } : {}),
});

test("ownScans drops guests and nothing else", () => {
  const rows = [scan(5.5), scan(4.1, { name: "Sam" }), scan(6.2), scan(5.2, { name: "Ana" })];
  const own = ownScans(rows);
  assert.deepEqual(own.map((s) => s.overall), [5.5, 6.2]);
});

test("a guest row is still comparable AS A RECORD — the list must show it", () => {
  // comparableScans answers "is this row on the current calibration", not
  // "whose face is it". Filtering guests there would make four results vanish
  // for somebody who deliberately scanned four friends; the history list keeps
  // them and the progress readers apply ownScans on top.
  const rows = [scan(5.5), scan(4.1, { name: "Sam" })];
  assert.equal(comparableScans(rows).length, 2);
  assert.equal(ownScans(comparableScans(rows)).length, 1);
});

test("an absent subject means the owner — every pre-existing row is theirs", () => {
  // Every scan already on a device predates the field. If absence read as
  // anything but "the account holder", shipping this would erase everyone's
  // history from their own trend.
  const legacy = scan(5.5);
  delete (legacy as Record<string, unknown>).subject;
  assert.equal(ownScans([legacy]).length, 1);
});

test("the guest label is a plain string with no claim to being anyone", () => {
  // The name is what the person typing chose to call them — a label on a local
  // row. Nothing may treat it as an identity: no matching, no merging of two
  // guests who happen to share a name.
  const a = scan(4.1, { name: "Sam" });
  const b = scan(6.0, { name: "Sam" });
  assert.notEqual(a.scanId, b.scanId);
  assert.deepEqual(ownScans([a, b]), []);
});
