import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const quick = readFileSync(new URL("../quick.ts", import.meta.url), "utf8");

test("cancelled profile population choice returns to angle selection, not front capture", () => {
  const profile = quick.slice(quick.indexOf("function beginQuickProfileCapture"), quick.indexOf("function enterMode"));
  assert.match(profile, /withSex\(/);
  assert.match(profile, /\}, \(\) => openScanViewChoice\(\)\);/);
  const chooser = quick.slice(quick.indexOf("function withSex"), quick.indexOf("function paintSilhouette"));
  assert.match(chooser, /resetSexAsk\(\);\s+if \(onCancel\) \{\s+onCancel\(\);\s+return;/);
});

test("tutorials are view-specific and side capture remains an explicit optional step", () => {
  const tutorial = readFileSync(new URL("./photoTutorial.ts", import.meta.url), "utf8");
  const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
  assert.match(tutorial, /export function offerTutorial\(view: TutorialView,/);
  assert.doesNotMatch(tutorial, /offerBothTutorials/);
  assert.equal(main.match(/offerTutorial\("front",/g)?.length, 2, "upload and camera both start with the front guide only");
  const invitation = main.slice(main.indexOf("const takeSide = await confirmScanAction"), main.indexOf("function startSide()"));
  assert.match(invitation, /cancelLabel: "Use front only"/);
  assert.match(invitation, /if \(takeSide\) \{\s*startSide\(\);\s*return;\s*\}/);
  assert.match(invitation, /await gateAnalysis\(null, token\)/, "declining side capture still opens the front analysis");
});
