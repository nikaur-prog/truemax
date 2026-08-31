import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scanConfirmPreviewSize } from "./scanConfirm.js";

test("the front review copy is bounded instead of duplicating a full phone canvas", () => {
  assert.deepEqual(scanConfirmPreviewSize(2160, 2880), { width: 780, height: 1040 });
  assert.deepEqual(scanConfirmPreviewSize(720, 960), { width: 720, height: 960 });
  assert.deepEqual(scanConfirmPreviewSize(0, 0), { width: 0, height: 0 });
});

test("a captured front is accepted before the side flow can begin", () => {
  const src = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
  const captured = src.indexOf('title: "Happy with this front photo?"');
  const armed = src.lastIndexOf('armLeaveGuard("scan")', captured);
  const accepted = src.indexOf("if (!accepted)", captured);
  const side = src.indexOf('scanSession.transition(token, "side")', accepted);
  assert.ok(armed > 0 && captured > armed && accepted > captured && side > accepted);
  assert.match(src.slice(captured, side), /preview: frontShot/);
});

test("mobile scan exits use app UI, while refresh keeps the browser guard", () => {
  const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
  const results = readFileSync(new URL("./results.ts", import.meta.url), "utf8");
  assert.doesNotMatch(main, /window\.confirm\("Leave this report/);
  assert.doesNotMatch(results, /window\.confirm\("Start over with a new photo/);
  assert.match(main, /window\.addEventListener\("beforeunload"/);
  assert.match(main, /closeScanConfirm\(\);\s*disarmLeaveGuard\(\);/);
});
