import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canLearnSidePrior } from "./sidePrior.js";

test("a side placement rejected by the person never becomes their next seed", () => {
  assert.equal(canLearnSidePrior(false, false), false);
  assert.equal(canLearnSidePrior(false, true), true);
  assert.equal(canLearnSidePrior(false, undefined), true, "keep legacy confirmed scans compatible");
});

test("another person's scan never teaches the account owner's prior", () => {
  for (const verified of [true, false, undefined]) assert.equal(canLearnSidePrior(true, verified), false);
});

test("the report persistence path supplies the actual placement verification flag", () => {
  const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
  assert.match(main, /if \(canLearnSidePrior\(guest, lastSide\?\.verified\) && sidePoints && sideDims\) writeSidePrior/);
});
