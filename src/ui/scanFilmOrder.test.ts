import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The measurement film now runs BEFORE the account wall rather than after it,
// so somebody is asked to sign up having watched their own face measured
// rather than having only taken two photographs.
//
// main.ts is the application entry and drives the DOM from module scope, so it
// cannot be imported here. These are source assertions on the ordering, which
// is exactly what would rot: every individual piece keeps working if the calls
// drift back into the wrong sequence, and the only symptom is a flow nobody
// notices until they run it on a phone.
const src = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
const passSrc = readFileSync(new URL("measurePass.ts", import.meta.url), "utf8");

test("the film plays before the wall goes up", () => {
  const plays = src.indexOf("await playMeasurePass(front, sideReport, token, generation)");
  const wall = src.indexOf('track("gate-shown")');
  assert.ok(plays > 0, "the gate path should play the measurement pass");
  assert.ok(wall > 0, "the gate should still be instrumented");
  assert.ok(plays < wall, "the pass must run before the gate is shown, not after it");
});

test("one capture is never measured on screen twice", () => {
  // Signing in at the wall re-enters runFullAnalysis for the same scan. Without
  // the guard it would replay the whole film a second time.
  assert.match(src, /markMeasuredOnScreen\(token\.scanId\)/);
  assert.match(src, /if \(measuredOnScreen\(token\.scanId\)\)/);
});

test("the wall's thumbnails come from the capture, not from the pane", () => {
  // The pass leaves the PROFILE on #photo-canvas for a two-view scan. The
  // teaser used to thumbnail the pane, which after this reorder would put the
  // side capture in the teaser's front slot.
  assert.match(src, /front: toThumb\(pending\.photo\)/);
  assert.doesNotMatch(src, /front: toThumb\(el\.photoCanvas\)/);
});

test("the wall reads one score, computed the same way the report will be", () => {
  // analyzeFrames, not analyze: a single-frame reading would show one set of
  // numbers during the pass, blur a different score behind the wall, and print
  // a third after sign-in, for one face.
  const wall = src.indexOf('track("gate-shown")');
  const frames = src.lastIndexOf("front = analyzeFrames(", wall);
  assert.ok(frames > 0, "the gate path should use the multi-frame median");
});

test("the signed-out film draws real constructions without disclosing values", () => {
  assert.equal(
    (passSrc.match(/\{ labels: false \}/g) ?? []).length,
    2,
    "both front and side overlays must suppress their value chips",
  );
  assert.match(passSrc, /say\(step\.label, step\.metric\.def\.name\)/);
  assert.doesNotMatch(passSrc, /say\([^\n]*step\.metric\.value/);
});

// The photograph is no longer dimmed while the pass runs, at the owner's call
// after watching it. The lines carry their own dark halo and the scan stage is
// already a dark room, so turning the face down was solving at the scale of the
// photograph a contrast problem already solved at the scale of the stroke. It
// also read as a fault: the face went dark mid-sequence for no visible cause.
test("the scan stage never turns the photograph down", () => {
  const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  // Any brightness filter on the photo pane, under any state class, is the
  // thing that was removed. The comment naming the old value is allowed; a
  // live declaration is not.
  const declarations = css
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("/*"))
    .join("\n");
  assert.doesNotMatch(declarations, /#photo-canvas\s*\{[^}]*filter:\s*brightness/);
  assert.doesNotMatch(declarations, /#frame\.(scanning|measuring)[^{]*\{[^}]*brightness/);
});

test("the stage is raised in exactly two places", () => {
  const adds = [...src.matchAll(/el\.frame\.classList\.add\("scanning"[^)]*\)/g)].map((m) => m[0]);
  // The front capture and the measurement pass. A third would be a screen
  // taking over the display without anyone deciding what it shows.
  assert.equal(adds.length, 2, `expected 2 scanning-stage entries, found ${adds.length}`);
  // And the un-dimming machinery that existed only to work around the dim is
  // gone with it, rather than left behind as a class nothing reads.
  assert.doesNotMatch(src, /prescan/);
  assert.doesNotMatch(readFileSync(new URL("../style.css", import.meta.url), "utf8"), /\.prescan/);
});

// The film is keyed by scan ID, and that key has to outlive the document.
//
// Module memory alone covers the password sign-in, which never leaves the page.
// It does not cover Google or the emailed link: both navigate away and come
// back to a fresh document, where resumePendingAfterAuth re-enters the analysis
// with the variable back at null and replays the whole pass on somebody who
// watched it a minute ago. Found by review, and the review was right.
test("the already-measured mark survives a redirect", () => {
  // A mirror in storage, not a bare module variable.
  assert.match(src, /localStorage\.setItem\(MEASURED_KEY/);
  assert.match(src, /localStorage\.getItem\(MEASURED_KEY\) === scanId/);
  // Read through the helper, never off the variable directly, or the OAuth
  // path silently goes back to reading module memory.
  assert.match(src, /if \(measuredOnScreen\(token\.scanId\)\)/);
  assert.doesNotMatch(src, /measuredOnScreenFor === token\.scanId/);
});

test("the mark is NOT identity-scoped", () => {
  // It is written signed out and read signed in. scopedStorageKey would look
  // for it under a scope that did not exist when it was written, so the flag
  // would never be found on the exact path it exists for.
  const block = src.slice(src.indexOf("const MEASURED_KEY"), src.indexOf("function measuredOnScreen"));
  assert.doesNotMatch(block, /scopedStorageKey/);
});

test("a storage failure replays rather than skips", () => {
  // This flag gates an animation, not an entitlement. A false negative costs a
  // repeat; a false positive would cost somebody the only demonstration the
  // product gives them, so the catch resolves to false.
  const read = src.slice(src.indexOf("function measuredOnScreen"));
  const body = read.slice(0, read.indexOf("\n}"));
  assert.match(body, /catch \{\s*return false;\s*\}/);
});

test("a new scan clears it; a finished one does not", () => {
  // The finished scan's flag has to survive the redirect that finishes it, so
  // clearing at the end of runFullAnalysis would delete it on the way past the
  // moment it exists for.
  const reset = src.indexOf("function resetToUpload()");
  const cleared = src.indexOf("clearMeasuredOnScreen();", reset);
  const nextFn = src.indexOf("\nfunction ", reset + 10);
  assert.ok(cleared > reset && cleared < nextFn, "resetToUpload should clear the mark");
});
