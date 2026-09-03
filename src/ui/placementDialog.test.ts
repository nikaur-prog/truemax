import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  placementPreviewBox,
  expandedPreviewLimits,
  PLACEMENT_EXPANDED_RING,
  PLACEMENT_PREVIEW_W,
  PLACEMENT_PREVIEW_H,
  PLACEMENT_PREVIEW_RING,
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

// Nothing is mounted under the placement question. The review row used to be
// built first and hidden with a class, which kept Confirm, One by one and the
// thirteen draggable rings in the accessibility tree beneath a dialog offering
// the same choices. Now the row stays empty and hidden and the whole section
// is inert until a branch hands the screen back to the person.
test("the review furniture is not mounted before the placement question", () => {
  const src = readFileSync(new URL("./sideFlow.ts", import.meta.url), "utf8");
  const assessed = src.indexOf("const assessment = seedAssessment(seed.points, seed.faceDir, ctx.sex);");
  const asked = src.indexOf("void askPlacementMode(", assessed);
  assert.ok(assessed > 0 && asked > assessed);
  const between = src.slice(assessed, asked);
  assert.doesNotMatch(between, /showReviewActions\(\)/, "no review row under the dialog");
  assert.ok(between.includes('e.actions.classList.add("mode-pending")'), "the empty row is hidden too");
  assert.ok(between.includes("e.section.inert = true"), "the section is inert under the dialog");
});

test("every way out of the dialogs hands the section back", () => {
  const src = readFileSync(new URL("./sideFlow.ts", import.meta.url), "utf8");
  const release = src.indexOf("const releaseFurniture = () => {");
  assert.ok(release > 0);
  const body = src.slice(release, src.indexOf("};", release));
  assert.ok(body.includes("e.section.inert = false"));
  assert.ok(body.includes('e.actions.classList.remove("mode-pending")'));
  // The finally is what makes a cancelled dialog safe: whatever branch was
  // running, the section comes back before the promise settles.
  const then = src.indexOf(").then(async (mode) => {", src.indexOf("void askPlacementMode("));
  const finallyAt = src.indexOf("} finally {", then);
  assert.ok(finallyAt > then, "the placement branch releases in a finally");
  assert.ok(src.slice(finallyAt, finallyAt + 120).includes("releaseFurniture();"));
  // And the two branches that put a person to work release before they do.
  for (const marker of ['if (mode === "manual") {', "if (!useAnyway) {"]) {
    const at = src.indexOf(marker);
    assert.ok(at > 0, marker);
    const next = src.slice(at, at + 400);
    assert.ok(next.indexOf("releaseFurniture();") < next.indexOf("showGuidedActions();"), `${marker} releases before the walkthrough`);
  }
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

test("the teaser rings stay separate around the dense nose and mouth points", () => {
  assert.ok(PLACEMENT_PREVIEW_RING <= 1, "the thumbnail marks should be pinpoint small");
  assert.ok(PLACEMENT_EXPANDED_RING > PLACEMENT_PREVIEW_RING, "the inspection view can use larger rings");
  assert.ok(PLACEMENT_EXPANDED_RING <= 1.35, "the inspection marks should remain pinpoints, not targets");
});

test("placement evidence opens enlarged instead of hiding behind a zoom action", () => {
  const src = readFileSync(new URL("./sideFlow.ts", import.meta.url), "utf8");
  assert.match(src, /paintPlacementPreview\(shot, photo, points, true\)/);
  assert.match(src, /paintPlacementPreview\(previewCanvas, opts\.preview\.photo, opts\.preview\.points, true\)/);
  assert.doesNotMatch(src, /data-zoom/, "the inspection view should not start as a zoomable thumbnail");
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
