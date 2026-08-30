import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  placementPreviewBox,
  expandedPreviewLimits,
  PLACEMENT_PREVIEW_W,
  PLACEMENT_PREVIEW_H,
} from "./sideFlow.js";

// "Take these points, or place them yourself" moved out of a sheet pinned to
// the bottom of the photo frame and into a centred dialog over a blurred page,
// carrying its own small copy of the photograph. Two things about that are
// load-bearing enough to pin here.

test("the preview keeps the capture's aspect ratio", () => {
  // 7:6 portrait: shallow enough that the width is what binds.
  const box = placementPreviewBox(1200, 1400);
  assert.equal(box.w, PLACEMENT_PREVIEW_W);
  // 168 * (1400/1200) = 196
  assert.equal(box.h, 196);

  // The camera's own 3:4 is deep enough that the height binds instead, and
  // gives up width to stay inside the card. Same picture either way.
  const shot = placementPreviewBox(1200, 1600);
  assert.equal(shot.h, PLACEMENT_PREVIEW_H);
  assert.equal(shot.w, 150);
});

test("a tall capture is bounded by the height, not by the width", () => {
  // A phone gallery hands back 9:16. Capped on width alone that is 299px tall,
  // and the card stops fitting on the screen it is being read on.
  const box = placementPreviewBox(1080, 1920);
  assert.equal(box.h, PLACEMENT_PREVIEW_H);
  assert.ok(box.w < PLACEMENT_PREVIEW_W, "a tall capture gives up width, not height");
  // Still the same picture, not a crop.
  assert.ok(Math.abs(box.w / box.h - 1080 / 1920) < 0.01);
});

test("a capture narrower than the box is never blown up to fill it", () => {
  // The whole point of the preview is to answer "did those land on my face".
  // An upscaled, soft copy of an already-small photo answers it worse than a
  // small sharp one.
  const box = placementPreviewBox(90, 120);
  assert.equal(box.scale, 1);
  assert.equal(box.w, 90);
  assert.equal(box.h, 120);
});

test("a degenerate canvas gives an empty box rather than a NaN one", () => {
  assert.deepEqual(placementPreviewBox(0, 0), { w: 0, h: 0, scale: 1 });
});

// The review row below the frame offers the same two choices the dialog is
// asking about, so it is hidden while the dialog is up. Hidden, not removed:
// it keeps its height. The risk is not the hiding, it is the un-hiding — a
// class added on one path and dropped on another leaves a person looking at a
// photograph with no way to confirm it.
test("the class that hides the review row is both added and removed", () => {
  const src = readFileSync(new URL("./sideFlow.ts", import.meta.url), "utf8");
  assert.ok(
    src.includes('e.actions.classList.add("mode-pending")'),
    "the review row should be hidden while the placement dialog is up",
  );
  assert.ok(
    src.includes('e.actions.classList.remove("mode-pending")'),
    "the review row must come back on every path out of the dialog",
  );
  // Including the cancelled path: the dialog resolves null when the flow is
  // closed underneath it, and the removal has to sit before that early return.
  const removedAt = src.indexOf('e.actions.classList.remove("mode-pending")');
  const nullReturn = src.indexOf("if (mode === null) return;");
  assert.ok(removedAt > 0 && nullReturn > removedAt, "restore the row before the null early-return");
});

test("the stylesheet actually hides it", () => {
  const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /#side-actions\.mode-pending\s*\{\s*visibility:\s*hidden/);
});

// The account wall used to be centred on the blurred preview it floats over,
// which put half its overhang on the progress bar and the narration line above.
test("the account wall hangs from the top of the blur, not its middle", () => {
  const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const rule = css.slice(css.indexOf(".analysis-gate.over-preview"));
  const body = rule.slice(0, rule.indexOf("}"));
  assert.match(body, /top:\s*0/);
  assert.doesNotMatch(body, /top:\s*50%/);
  assert.doesNotMatch(body, /translate\(-50%,\s*-50%\)/);
});

// The preview enlarges on demand. At 168px the thirteen rings land within a
// few pixels of each other around the nose and mouth and read as one smudge,
// which answers "did those go on my face" and not "is that one on my lip".
test("the enlarged size is bounded by the screen it is read on", () => {
  const phone = expandedPreviewLimits(390, 844);
  // A phone gets most of its width and leaves room for the heading and both
  // buttons: a dialog whose answers are below the fold cannot be answered.
  assert.equal(phone.maxW, 390 - 76);
  assert.equal(phone.maxH, 844 - 320);

  const desktop = expandedPreviewLimits(1920, 1080);
  // And a large display does not get a 1.8-metre face: the caps hold.
  assert.equal(desktop.maxW, 560);
  assert.equal(desktop.maxH, 640);
});

test("a very short window still gets a preview, never a zero-height one", () => {
  // A phone in landscape, or a desktop window dragged short. Clamping to the
  // collapsed size is the floor; going negative would paint nothing and the
  // button would look broken rather than constrained.
  const squat = expandedPreviewLimits(700, 300);
  assert.equal(squat.maxH, PLACEMENT_PREVIEW_H);
  assert.ok(squat.maxW > 0);
  const box = placementPreviewBox(1200, 1600, squat.maxW, squat.maxH);
  assert.ok(box.w > 0 && box.h > 0);
});

test("enlarging actually enlarges, on any ordinary screen", () => {
  const small = placementPreviewBox(1200, 1600);
  const lim = expandedPreviewLimits(390, 844);
  const big = placementPreviewBox(1200, 1600, lim.maxW, lim.maxH);
  assert.ok(big.h > small.h * 2, `expected a real jump, got ${small.h} to ${big.h}`);
});
