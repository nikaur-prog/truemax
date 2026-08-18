import test from "node:test";
import assert from "node:assert/strict";
import { CURRENT_SCORE_VERSION, comparableScans } from "./history.js";
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
