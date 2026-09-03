import assert from "node:assert/strict";
import test from "node:test";
import { profileScorecardRegions } from "./quickProfileExport.js";

test("profile scorecards keep the same four regions when scores reorder", () => {
  const before = profileScorecardRegions([
    { name: "Nose", score: 8.1 },
    { name: "Jaw", score: 3.2 },
    { name: "Lips", score: 7.4 },
    { name: "Chin", score: 4.1 },
    { name: "Midface", score: 9.2 },
  ]);
  const after = profileScorecardRegions([
    { name: "Chin", score: 8.6 },
    { name: "Lips", score: 5.2 },
    { name: "Jaw", score: 9.1 },
    { name: "Nose", score: 6.7 },
    { name: "Midface", score: 2.8 },
  ]);

  assert.deepEqual(before.map((region) => region.name), ["Jaw", "Chin", "Nose", "Lips"]);
  assert.deepEqual(after.map((region) => region.name), ["Jaw", "Chin", "Nose", "Lips"]);
});
