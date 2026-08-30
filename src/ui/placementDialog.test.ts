import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { placementPreviewBox, PLACEMENT_PREVIEW_W, PLACEMENT_PREVIEW_H } from "./sideFlow.js";

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
