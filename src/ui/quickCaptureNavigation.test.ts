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

// The requirement this pins has not changed: nobody should reach the profile
// step believing it is compulsory. Where it is SAID moved. It used to live in
// the combined tutorial's blurb, which was shown before the front photograph
// and described both shots at once; the tutorials are now offered separately,
// each immediately before its own photograph, so the front one no longer
// mentions the profile at all. The promise now sits on the prompt that
// actually asks for the profile, which is a better place for it: it is read at
// the moment the choice is being made rather than several minutes earlier.
test("the side prompt says the profile is optional and offers a way past it", () => {
  const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
  // From the eyebrow, not the title: the eyebrow is the first line of the
  // options object and is part of what makes the step read as optional.
  const prompt = main.slice(
    main.indexOf('eyebrow: "OPTIONAL SECOND VIEW"'),
    main.indexOf('track("scan-side-skipped")'),
  );
  assert.notEqual(prompt, "");
  assert.match(prompt, /OPTIONAL SECOND VIEW/);
  assert.match(prompt, /you can skip it/);
  assert.match(prompt, /cancelLabel: "Skip side photo"/);
});

// The profile tutorial is offered on the far side of the prompt, not with the
// front one. Getting this backwards teaches the shot to everybody who skips it
// and nobody at the moment they need it.
test("the profile tutorial is offered only after the side photo is accepted", () => {
  const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
  const tutorial = readFileSync(new URL("./photoTutorial.ts", import.meta.url), "utf8");
  // No combined offer survives anywhere.
  assert.doesNotMatch(main, /offerBothTutorials/);
  assert.doesNotMatch(tutorial, /offerBothTutorials/);
  // The side offer sits between accepting the prompt and starting the capture.
  const branch = main.slice(main.indexOf("if (takeSide) {"), main.indexOf('track("scan-side-skipped")'));
  assert.match(branch, /offerTutorial\("side"/);
  assert.match(branch, /startSide\(\)/);
  assert.ok(branch.indexOf('offerTutorial("side"') < branch.indexOf("startSide()"));
});
