import test from "node:test";
import assert from "node:assert/strict";
import { CURRENT_SCORE_VERSION, comparableScans, scanStorageKey } from "./history.js";
import type { StoredScan } from "./history.js";

const scan = (overall: number, scoreVersion?: number): StoredScan => ({
  date: new Date(1_700_000_000_000 + overall * 1000).toISOString(),
  sex: "male",
  overall,
  regions: {},
  ...(scoreVersion === undefined ? {} : { scoreVersion }),
});

test("legacy scores are never mixed into the current calibration trend", () => {
  const current = scan(5.8, CURRENT_SCORE_VERSION);
  assert.deepEqual(
    comparableScans([scan(7.1), scan(6.4, CURRENT_SCORE_VERSION - 1), current]),
    [current],
  );
});

test("photo storage uses the immutable scan ID with a legacy date fallback", () => {
  const legacy = scan(5.1, CURRENT_SCORE_VERSION);
  assert.equal(scanStorageKey(legacy), legacy.date);
  assert.equal(scanStorageKey({
    ...legacy,
    scanId: "10000000-0000-4000-8000-000000000001",
  }), "10000000-0000-4000-8000-000000000001");
});
