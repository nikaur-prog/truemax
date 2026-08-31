import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./results.ts", import.meta.url), "utf8");

test("a recalled report can omit the plan button without breaking overview wiring", () => {
  assert.match(source, /const planBtn = document\.getElementById\("btn-plan"\);\s+if \(planBtn\) planBtn\.onclick/);
  assert.doesNotMatch(source, /getElementById\("btn-plan"\)!\.onclick/);
});
