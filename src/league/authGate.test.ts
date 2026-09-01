import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the League auth request remains single-flight while its fields change", () => {
  const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
  const gate = source.slice(source.indexOf("function renderGate"), source.indexOf("function renderApply"));
  assert.match(gate, /const ready = !authWorking/);
  assert.match(gate, /if \(authWorking\) return;/);
  assert.match(gate, /authWorking = true;\s*authButton\.disabled = true;/);
});
