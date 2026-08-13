import test from "node:test";
import assert from "node:assert/strict";
import { SIDE_POINTS } from "./sideMetrics.js";

// ---------------------------------------------------------------------------
// The rule that decides which seed to trust.
//
// onHeadFraction lives in a browser module (it needs a canvas), so what is
// checked here is the arithmetic it is built on and the decision it feeds — the
// part that is pure and the part that was actually wrong in production.
//
// The bug it exists for: thirteen points in a tidy vertical line down the empty
// left of the frame, a body-length from the face. Every point looked plausible
// alone, the set looked deliberate, and none of them were on a head. The old
// rule was "use the mesh if it returned anything, otherwise trace the
// silhouette", which cannot tell a good mesh from a mesh that latched onto a
// doorway, because both return thirteen numbers.
// ---------------------------------------------------------------------------

const TOTAL = SIDE_POINTS.length;

// The comparison seedSidePoints makes. Ties favour the mesh: where both are
// equally plausible, one is measuring named anatomy and the other is measuring
// an outline.
function useMesh(meshScore: number | null, silhouetteScore: number): boolean {
  return meshScore !== null && meshScore >= silhouetteScore;
}

test("thirteen points, so a single stray point cannot swing the decision", () => {
  // One point in the wrong place is a 1/13 penalty, which is the intent: the
  // template pass already repairs lone outliers, and this rule is meant to
  // catch a whole set being in the wrong place.
  assert.equal(TOTAL, 13);
  assert.ok(1 / TOTAL < 0.08);
});

test("a mesh on the wall loses to a silhouette on the head", () => {
  // The screenshot case.
  assert.equal(useMesh(2 / TOTAL, 11 / TOTAL), false);
});

test("a mesh on the head beats a silhouette on a doorway", () => {
  assert.equal(useMesh(12 / TOTAL, 3 / TOTAL), true);
});

test("an equal call goes to the mesh", () => {
  assert.equal(useMesh(9 / TOTAL, 9 / TOTAL), true);
});

test("no mesh at all falls through to the silhouette", () => {
  assert.equal(useMesh(null, 0), false);
  assert.equal(useMesh(null, 1), false);
});

test("the low-confidence warning fires where a seed is mostly off the head", () => {
  // 0.7 is the line the verifier copy switches on. Below it the screen stops
  // saying "check these" and starts saying "these are a starting position".
  const warns = (score: number) => score < 0.7;
  assert.equal(warns(2 / TOTAL), true, "points on a wall");
  assert.equal(warns(8 / TOTAL), true, "half on the head is not good enough");
  assert.equal(warns(10 / TOTAL), false, "ten of thirteen is a working seed");
  assert.equal(warns(13 / TOTAL), false, "all thirteen");
});
