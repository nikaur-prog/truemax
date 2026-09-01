import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./results.ts", import.meta.url), "utf8");

test("the pathway has one action, whose label follows the live state", () => {
  assert.match(source, /actionButton\("btn-continue", pathwayLabel\(\), "pathway", "lead"\)/);
  assert.match(source, /paintPathwayLabels\(\)/);
  assert.doesNotMatch(source, /actionButton\("btn-plan"|actionButton\("sn-plan"/);
});
