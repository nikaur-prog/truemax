import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scanConfirmPreviewSize } from "./scanConfirm.js";

test("the front review copy is bounded instead of duplicating a full phone canvas", () => {
  assert.deepEqual(scanConfirmPreviewSize(2160, 2880), { width: 780, height: 1040 });
  assert.deepEqual(scanConfirmPreviewSize(720, 960), { width: 720, height: 960 });
  assert.deepEqual(scanConfirmPreviewSize(0, 0), { width: 0, height: 0 });
});

test("a captured front is accepted before the optional side decision", () => {
  const src = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
  const captured = src.indexOf('title: "Happy with this front photo?"');
  const armed = src.lastIndexOf('armLeaveGuard("scan")', captured);
  const accepted = src.indexOf("if (!accepted)", captured);
  const optional = src.indexOf('title: "And now the side photo"', accepted);
  const side = src.indexOf("if (takeSide) {", optional);
  const frontOnly = src.indexOf("await gateAnalysis(null, token)", side);
  assert.ok(armed > 0 && captured > armed && accepted > captured && optional > accepted);
  assert.ok(side > optional && frontOnly > side);
  assert.match(src.slice(captured, optional), /preview: frontShot/);
});

test("backing out of the profile step never strands a completed front scan", () => {
  const src = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
  const review = src.indexOf("function showFrontReview()");
  const skip = src.indexOf('id="front-skip-side"', review);
  const skipHandler = src.indexOf('getElementById("front-skip-side")', skip);
  const frontOnly = src.indexOf("void gateAnalysis(null, token)", skipHandler);
  const permission = src.indexOf("await prepareSidePlacementChoice()", frontOnly);
  const cancelledConsentFallback = src.indexOf("await gateAnalysis(null, token)", permission);

  assert.ok(review > 0 && skip > review && skipHandler > skip && frontOnly > skipHandler);
  assert.ok(permission > frontOnly && cancelledConsentFallback > permission);
});

test("mobile scan exits use app UI, while refresh keeps the browser guard", () => {
  const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
  const results = readFileSync(new URL("./results.ts", import.meta.url), "utf8");
  assert.doesNotMatch(main, /window\.confirm\("Leave this report/);
  assert.doesNotMatch(results, /window\.confirm\("Start over with a new photo/);
  assert.match(main, /window\.addEventListener\("beforeunload"/);
  assert.match(main, /closeScanConfirm\(\);\s*disarmLeaveGuard\(\);/);
});
