import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The automatic placement used to cost exactly as many taps as the manual one:
// "Use these points" set a flag and dropped you on the same all-thirteen review
// screen, with the same One by one / Points are wrong / Confirm row underneath.
// An automatic placement that still requires a manual confirmation is not an
// automatic placement.
//
// sideFlow.ts drives the DOM from a mounted verifier and cannot be imported
// here, so these are source assertions on the shape of the flow. That shape is
// what would rot: each piece keeps working if the questions drift back onto the
// review screen, and the only symptom is a flow nobody notices is redundant.
const src = readFileSync(new URL("./sideFlow.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");

test("taking the automatic placement never reaches a confirm screen", () => {
  const auto = src.slice(src.indexOf("const afterAutomatic"), src.indexOf("if (startInGuidedMode)"));
  // Both terminal branches go straight to confirmPlacement with auto set.
  assert.match(auto, /confirmPlacement\(\{ auto: true, verified: true, consented \}\)/);
  assert.match(auto, /confirmPlacement\(\{ auto: true, verified: false, consented \}\)/);
  // And the only path back to the review row is the one where a person chose
  // to edit, where the row is the tool they asked for.
  assert.match(auto, /if \(edit\) \{[\s\S]*?showGuidedActions\(\);/);
  assert.doesNotMatch(auto, /showReviewActions\(\)/);
});

test("the accuracy question is asked once, as a dialog, not in the panel", () => {
  // The in-panel version competed with Confirm and One by one for the same
  // decision. It is gone, and so is the flag that gated it.
  assert.doesNotMatch(src, /askedAccuracy/);
  assert.doesNotMatch(src, /side-accuracy/);
  assert.doesNotMatch(css, /\.side-accuracy/);
});

test("consent is asked on every terminal branch", () => {
  // Whether the points were right, wrong-and-fixed, or wrong-and-left, the
  // correction is the thing that teaches the seeder. Missing the ask on any
  // branch loses exactly the cases worth learning from.
  const auto = src.slice(src.indexOf("const afterAutomatic"), src.indexOf("if (startInGuidedMode)"));
  const asks = auto.match(/askSideFeedbackConsent\(\)/g) ?? [];
  assert.equal(asks.length, 2, "both non-editing branches must ask");
});

// The engine has always known when a placement is impossible. It just said so
// too late: after the person had been offered the points and accepted them.
test("a seed the engine can disprove is never offered", () => {
  assert.match(src, /const broken = seedReadings\(seed\.points, seed\.faceDir, ctx\.sex\)/);
  const ask = src.indexOf("const broken = seedReadings");
  const offer = src.indexOf("askPlacementMode(e.canvas", ask);
  assert.ok(offer > ask, "the seed must be measured before the dialog is built");

  // And when it is broken there is no "use these points" button at all.
  const dialog = src.slice(src.indexOf("function askPlacementMode"));
  const body = dialog.slice(0, dialog.indexOf("\n}\n"));
  assert.match(body, /\$\{blocked \? "" : `<button[^`]*data-mode="manual"/);
  assert.match(body, /data-mode="\$\{blocked \? "manual" : "auto"\}"/);
});

test("the refusal names the reading that broke, not just that something did", () => {
  // "Something is wrong" is not actionable. "The nasolabial angle came out at
  // 167.5 and a face is 55 to 145" tells somebody what they are looking at.
  const fn = src.slice(src.indexOf("function seedReadings"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.match(body, /m\.def\.name/);
  assert.match(body, /m\.value\.toFixed\(m\.def\.decimals\)/);
  assert.match(body, /bound\[0\]/);
});

test("a seed that cannot be measured at all does not block the scan", () => {
  // Absence of evidence is not evidence of a bad seed, and this check must
  // never be the thing that stops somebody scanning.
  const fn = src.slice(src.indexOf("function seedReadings"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.match(body, /catch \{[\s\S]*?return \[\];/);
});

test("the untouched guard is skipped only on the path that replaced it", () => {
  // That guard exists because untouched seeds produced measurements
  // disagreeing with an independent product by 22, 12 and 48 degrees. It is
  // skipped only where an explicit "yes, these look right" has been given,
  // which is a stronger form of the same protection than a second button press.
  assert.match(src, /if \(!opts\.auto && !movedSidePointIds\(/);
});

// The scan takeover painted a near-black room in an otherwise light product,
// so it read as a different application arriving mid-sequence.
test("the scan stage keeps the product's palette", () => {
  // Comments stripped first: the rule explains what it replaced, and the old
  // near-black value is named in that explanation. A comment is not a paint.
  const live = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const stage = live.slice(live.indexOf("body:has(#frame.scanning) #v-main"));
  const body = stage.slice(0, stage.indexOf("}"));
  assert.match(body, /background:\s*var\(--bg\)/);
  assert.doesNotMatch(body, /background:\s*rgba\(12/);
  // And the light-on-dark overrides that only existed for the dark ground are
  // gone with it, or the caption would be white ink on a white stage.
  assert.doesNotMatch(css, /body:has\(#frame\.scanning\) \.scan-status \{ color: rgba\(255/);
  assert.doesNotMatch(css, /body:has\(#frame\.scanning\) \.bar \{ background: rgba\(255/);
});

// Scored, but never printed as though it were a confirmed placement.
test("a side the person called wrong says so on the report", () => {
  const results = readFileSync(new URL("./results.ts", import.meta.url), "utf8");
  assert.match(results, /function unverifiedBanner\(\)/);
  // `=== false`, not a truthiness check: a restored scan predates the question
  // and carries undefined, which must read as "never asked", not "said no".
  assert.match(results, /ctx\?\.sideVerified !== false/);
  // Rendered on the side view, and offering the thirty seconds again.
  assert.match(results, /\$\{unverifiedBanner\(\)\}/);
  assert.match(results, /on\("unver-redo", \(\) => ctx\?\.onRedoSide\?\.\(\)\)/);
});
