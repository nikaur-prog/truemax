import test from "node:test";
import assert from "node:assert/strict";
import { GUIDE_POINTS, guideCrop } from "./sideGuidePhoto.js";
import { SIDE_POINTS } from "../engine/sideMetrics.js";

// ---------------------------------------------------------------------------
// The photographic guide's data, whenever it exists.
//
// GUIDE_POINTS is hand-placed by eye on a generated reference, which is
// exactly the kind of data that acquires a typo. These checks cost nothing
// while it is null and pin the invariants the moment it is filled in.
// ---------------------------------------------------------------------------

test("guide points, when present, cover every landmark and stay inside the image", () => {
  if (!GUIDE_POINTS) return; // wiring shipped ahead of the artwork — nothing to check yet
  for (const { id } of SIDE_POINTS) {
    const point = GUIDE_POINTS[id];
    assert.ok(point, `${id} is missing from the photographic guide`);
    const [x, y] = point;
    assert.ok(x > 0 && x < 1 && y > 0 && y < 1, `${id} at [${x}, ${y}] is outside the image`);
  }
  // The reference faces image-right, so the nose tip must be the most forward
  // point and the ear notch must sit behind every front-of-face landmark.
  assert.ok(
    GUIDE_POINTS.pronasale[0] > GUIDE_POINTS.tragion[0],
    "the reference must face image-right: nose ahead of ear",
  );
});

test("the guide points run down the face in anatomical order", () => {
  if (!GUIDE_POINTS) return;
  // A transposed pair is the failure mode hand-placed data actually has, and
  // it is invisible in a diff of thirteen number pairs. Down the profile:
  const order = [
    "trichion", "glabella", "nasion", "pronasale", "subnasale",
    "labialeSuperius", "labialeInferius", "pogonion", "menton",
  ] as const;
  for (let i = 1; i < order.length; i++) {
    const above = GUIDE_POINTS[order[i - 1]];
    const below = GUIDE_POINTS[order[i]];
    assert.ok(below[1] > above[1], `${order[i]} must sit below ${order[i - 1]}`);
  }
  assert.ok(GUIDE_POINTS.cervicale[1] > GUIDE_POINTS.menton[1], "the neck point is below the chin");
});

test("the jaw joint sits in front of the ear notch, at about its height", () => {
  if (!GUIDE_POINTS) return;
  const [tx, ty] = GUIDE_POINTS.tragion;
  const [cx, cy] = GUIDE_POINTS.condylion;
  assert.ok(cx > tx, "the condyle is forward of the notch, not behind it");
  // "Level with the ear canal" — the whole point of the renamed label. A
  // condylion up on the temple is the bug that made ramus : mandible reject
  // real faces, so the reference must not teach it.
  assert.ok(Math.abs(cy - ty) < 0.03, `condylion sits ${(cy - ty).toFixed(3)} off the notch's height`);
  assert.ok(GUIDE_POINTS.gonion[1] > cy, "the jaw corner is below the hinge");
  assert.ok(GUIDE_POINTS.gonion[0] > cx, "the jaw corner is forward of the hinge");
});

test("a crop is clamped inside the image and never degenerate", () => {
  for (const point of [[0.5, 0.5], [0.02, 0.03], [0.98, 0.97]] as Array<[number, number]>) {
    const { x, y, size } = guideCrop(point, 900, 1200);
    assert.ok(size > 0);
    assert.ok(x >= 0 && y >= 0 && x + size <= 900 && y + size <= 1200, `crop escapes at ${point}`);
  }
});

test("an edge landmark's ring position stays inside its crop", () => {
  // The old magnifier bug, pinned against recurrence in this code path: near an
  // edge the crop cannot centre, so the RING must move within the patch rather
  // than the patch lying about where the point is.
  const point: [number, number] = [0.02, 0.5];
  const { x, size } = guideCrop(point, 900, 1200);
  const ringFrac = (point[0] * 900 - x) / size;
  assert.ok(ringFrac >= 0 && ringFrac <= 1, "ring left the patch");
  assert.ok(ringFrac < 0.5, "an edge point must sit off-centre in its patch, not be recentred");
});
