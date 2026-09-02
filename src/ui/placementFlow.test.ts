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
  // to edit, where the row is the tool they asked for...
  assert.match(auto, /if \(edit\) \{[\s\S]*?showGuidedActions\(\);/);
  // ...or a confirm the engine refused. The furniture is never mounted under
  // the dialogs, so a refusal (a reading outside what a face can be) has to
  // put the editor up itself. Every showReviewActions here follows a
  // confirmPlacement that returned false, and nothing else.
  const mounts = [...auto.matchAll(/showReviewActions\(\)/g)].map((m) => m.index ?? -1);
  assert.equal(mounts.length, 2);
  for (const at of mounts) {
    const before = auto.slice(Math.max(0, at - 220), at);
    assert.match(before, /if \(!\(await confirmPlacement\(\{ auto: true/, "review row only after a refused confirm");
  }
});

test("the accuracy question is asked once, as a dialog, not in the panel", () => {
  // The in-panel version competed with Confirm and One by one for the same
  // decision. It is gone, and so is the flag that gated it.
  assert.doesNotMatch(src, /askedAccuracy/);
  assert.doesNotMatch(src, /side-accuracy/);
  assert.doesNotMatch(css, /\.side-accuracy/);
});

test("the primary confirmation is first in the review order and reads as success", () => {
  const review = src.indexOf("const showReviewActions");
  const rowStart = src.indexOf('e.actions.innerHTML = `', review);
  const row = src.slice(rowStart, src.indexOf("`;", rowStart));
  const confirm = row.indexOf('id="side-go"');
  const guided = row.indexOf('id="side-guided"');
  const wrong = row.indexOf('id="side-wrong"');
  assert.ok(confirm > 0 && confirm < guided && guided < wrong, "Confirm should be encountered before editing alternatives");
  assert.match(row, /class="btn side-confirm" id="side-go"/);
  assert.match(css, /\.btn\.side-confirm\s*\{[^}]*background:\s*var\(--up\)/s);
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
  assert.match(src, /const assessment = seedAssessment\(seed\.points, seed\.faceDir, ctx\.sex\)/);
  const ask = src.indexOf("const assessment = seedAssessment");
  const offer = src.indexOf("void askPlacementMode(", ask);
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
  const fn = src.slice(src.indexOf("function seedAssessment"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.match(body, /m\.def\.name/);
  assert.match(body, /m\.value\.toFixed\(m\.def\.decimals\)/);
  assert.match(body, /bound\[0\]/);
});

test("a seed that cannot be measured at all does not block the scan", () => {
  // Absence of evidence is not evidence of a bad seed, and this check must
  // never be the thing that stops somebody scanning.
  const fn = src.slice(src.indexOf("function seedAssessment"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.match(body, /catch \{[\s\S]*?return \{ hard: \[\], marginal: \[\] \};/);
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

// Double-tap on a control zoomed the page, which is what an impatient thumb
// does when a button seems not to have responded. It is the browser's legacy
// double-tap-to-zoom, and it is ours to switch off.
test("double-tap does not zoom, and pinch still does", () => {
  const live = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(live, /body \{ touch-action: manipulation; \}/);
  // `manipulation`, never `none` on the body: none would take pinch zoom away
  // from anybody who needs to enlarge text. The landmark editors set none on
  // their own layers, where a drag must not scroll the page.
  assert.doesNotMatch(live, /^body \{[^}]*touch-action: none/m);
});

// The seeder has three independent ways to place these thirteen points, and it
// used to hand over whichever put most of them on the head — a geometric proxy
// that is decent and is not the question. A placement can sit every point
// tidily on the head and still measure a nasolabial angle of 167 degrees.
const verify = readFileSync(new URL("./sideVerify.ts", import.meta.url), "utf8");

test("every seeding method is measured before anybody is told it failed", () => {
  // The validator is threaded from the flow, where the scoring engine lives, so
  // the seeder never has to import the thing it is estimating for.
  assert.match(src, /seedSidePointsSmart\(\s*e\.canvas,[\s\S]*?const assessment = seedAssessment\(points, faceDir, ctx\.sex\);[\s\S]*?assessment\.hard\.length === 0 && assessment\.marginal\.length === 0;/);
  // Candidates are ranked geometrically and then filtered, so a seed that is
  // both plausible AND well placed still wins.
  assert.match(verify, /candidates\.sort\(\(a, b\) => b\.score - a\.score\)/);
  assert.match(verify, /for \(const seed of finished\) \{\s*if \(validate\(seed\.points, seed\.faceDir\)\) return seed;/);
  // The plain template is a genuinely different construction, so it gets
  // measured too rather than assumed worse than the two that already failed.
  assert.match(verify, /const plain = seedSidePoints\(canvas\);\s*if \(validate\(plain\.points, plain\.faceDir\)\) return plain;/);
});

test("a seeder with no validator behaves exactly as it did", () => {
  // The calibration harnesses call it bare and must keep getting the
  // best-scoring seed, not a different one.
  assert.match(verify, /if \(!validate\) return finished\[0\];/);
});

test("total failure still returns something to look at", () => {
  // The dialog needs a picture to show while it explains that the placement
  // could not be made; returning null would leave it describing nothing.
  const fn = verify.slice(verify.indexOf("export async function seedSidePointsSmart"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  // The LAST statement, not merely a statement: whatever it tries in between,
  // the thing it hands back when everything failed is the best seed it had.
  assert.match(body, /return finished\[0\];\s*$/);
  assert.doesNotMatch(body, /return null/);
});

test("landmark dragging paints no faster than the display", () => {
  assert.match(verify, /queuedMove = \{ id: dragging,[\s\S]*requestAnimationFrame\(paintMove\)/);
  assert.match(verify, /const up = \(\) => \{[\s\S]*flushMove\(\);[\s\S]*dragging = null/);
  assert.match(verify, /const placeOne = \(id: SidePointId\)/);
});

test("guide lines are updated in place instead of reparsed during a drag", () => {
  const draw = src.slice(src.indexOf("function drawGuides"), src.indexOf("function loadImage"));
  assert.match(draw, /createElementNS/);
  assert.match(draw, /line\.setAttribute\("x1"/);
  assert.doesNotMatch(draw, /innerHTML/);
});

// The Cast door. The AI room was staff-only in two places, so Adrian could
// not use it without being made an admin of the whole product.
const quickSrc = readFileSync(new URL("../quick.ts", import.meta.url), "utf8");
const gateSrc = readFileSync(new URL("./quickGate.ts", import.meta.url), "utf8");

test("the AI room is a grant, not a staff key", () => {
  assert.match(quickSrc, /ai: "studio"/);
  assert.doesNotMatch(quickSrc, /STAFF_ONLY_MODES = \["ai"/);
  // Locked rather than removed, matching every other granted pillar: somebody
  // who can see what exists knows what to ask the owner for.
  assert.match(quickSrc, /const STAFF_ONLY_MODES = \["calibrate"\]/);
  // Staff hold every key, including the new one.
  assert.match(gateSrc, /grants: \{ cta: true, clips: true, polisher: true, studio: true \}/);
});

test("the League card's link opens the room rather than the menu", () => {
  // There was no `ai` hash, so the Tools card would have landed on the pillar
  // grid, which reads as a broken link.
  assert.match(quickSrc, /ai: "ai",/);
  assert.match(quickSrc, /if \(hash === "ai" \|\| hash === "studio"\)/);
  const league = readFileSync(new URL("../league/main.ts", import.meta.url), "utf8");
  // Asserted by GRANT and by DESTINATION, not by display name. What this test
  // is about is that card 04 opens the room instead of the pillar grid; the
  // name on the card is a copy decision and pinning it here made a rename look
  // like a broken link.
  assert.match(league, /id: "studio", n: "04"/);
  assert.match(league, /href: "\/league\/tools#ai"/);
});

test("the chips come from the catalogue, not from the markup", () => {
  // One entry in one file adds a chip, its before wording, its after wording
  // and its test coverage. A hand-written list in HTML would drift from the
  // prompts within a cycle.
  assert.match(quickSrc, /FACE_FLAWS\.map\(/);
  assert.match(quickSrc, /flaws: selectedFlawIds\(\)/);
  const html = readFileSync(new URL("../../quick.html", import.meta.url), "utf8");
  assert.match(html, /id="q-ai-flaws"/);
  // And the free box that invited "softer jawline" is no longer the main road.
  assert.doesNotMatch(html, /placeholder="Acne along the jaw, patchy stubble, tired eyes, softer jawline"/);
});
