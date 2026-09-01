import assert from "node:assert/strict";
import test from "node:test";
import { ordinal } from "./ordinal.js";

test("percentile ordinals use the right English suffix", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 81, 92, 100].map(ordinal),
    ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "81st", "92nd", "100th"],
  );
});
