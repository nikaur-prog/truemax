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
