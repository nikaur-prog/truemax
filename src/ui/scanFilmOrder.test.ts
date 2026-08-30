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
  assert.match(src, /measuredOnScreenFor = token\.scanId/);
  assert.match(src, /if \(measuredOnScreenFor === token\.scanId\)/);
});

test("a reset clears it, so the next capture gets its own film", () => {
  const reset = src.indexOf("function resetToUpload()");
  const cleared = src.indexOf("measuredOnScreenFor = null;", reset);
  assert.ok(reset > 0 && cleared > reset, "resetToUpload should clear measuredOnScreenFor");
  // Inside resetToUpload, not somewhere after it.
  const nextFn = src.indexOf("\nfunction ", reset + 10);
  assert.ok(cleared < nextFn, "the clear belongs inside resetToUpload");
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

// The dim exists so measurement lines read as light on dark. It was also being
// applied to the front capture during detection, when there is no overlay at
// all — a photograph going dark under the word SCANNING with nothing on it.
test("every screen that raises the scan stage decides about the dim", () => {
  const adds = [...src.matchAll(/el\.frame\.classList\.add\("scanning"[^)]*\)/g)].map((m) => m[0]);
  // Two, and only two: the front capture and the measurement pass. A third
  // would raise the stage without saying whether it has anything to show.
  assert.equal(adds.length, 2, `expected 2 scanning-stage entries, found ${adds.length}`);
  assert.ok(
    adds.some((a) => a.includes('"prescan"')),
    "the front capture raises the stage before there is an overlay, so it must set prescan",
  );
  assert.match(src, /el\.frame\.classList\.remove\("prescan"\)/);
});

test("prescan is inert on its own", () => {
  // It is written so a stale one cannot silently leave a measurement pass
  // undimmed: the rule only fires alongside `scanning`.
  const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /#frame\.scanning\.prescan #photo-canvas \{ filter: none; \}/);
  assert.doesNotMatch(css, /^#frame\.prescan/m);
});
