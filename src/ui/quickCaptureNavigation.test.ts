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

test("the combined tutorial describes the side photo as optional", () => {
  const tutorial = readFileSync(new URL("./photoTutorial.ts", import.meta.url), "utf8");
  assert.match(tutorial, /optional side photo/);
  assert.match(tutorial, /or skip it/);
});
