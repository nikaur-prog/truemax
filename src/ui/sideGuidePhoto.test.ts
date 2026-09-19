import test from "node:test";
import assert from "node:assert/strict";
import { GUIDE_POINTS, GUIDE_ZOOM, guideCrop, guideMarkerPosition, earGuideCompanion } from "./sideGuidePhoto.js";
import { SIDE_POINTS, SIDE_EAR_GUIDANCE } from "../engine/sideMetrics.js";

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

test("the illustrated surface hinge stays near the ear, not on the temple", () => {
  if (!GUIDE_POINTS) return;
  const [tx, ty] = GUIDE_POINTS.tragion;
  const [cx, cy] = GUIDE_POINTS.condylion;
  assert.ok(cx > tx, "the condyle is forward of the notch, not behind it");
  // This checks our illustration, not a universal anatomical distance or
  // height rule. Other photos may have different ear-to-hinge spacing.
  assert.ok(Math.abs(cy - ty) < 0.03, `condylion sits ${(cy - ty).toFixed(3)} off the notch's height`);
  assert.ok(GUIDE_POINTS.gonion[1] > cy, "the jaw corner is below the hinge");
  assert.ok(GUIDE_POINTS.gonion[0] > cx, "the jaw corner is forward of the hinge");
});

test("hinge and ear-notch guidance distinguishes a surface estimate from a visible notch", () => {
  assert.match(SIDE_POINTS.find((point) => point.id === "condylion")!.label, /estimate/);
  assert.match(SIDE_EAR_GUIDANCE.condylion, /exact joint inside cannot be seen/);
  assert.match(SIDE_EAR_GUIDANCE.condylion, /not on the sideburn or cheekbone/);
  assert.match(SIDE_EAR_GUIDANCE.tragion, /notch at its top/);
  assert.doesNotMatch(SIDE_EAR_GUIDANCE.condylion, /same height|one fiftieth|level with/);
});

test("both ear close-ups retain the companion point and mirror coordinates without moving it", () => {
  assert.ok(GUIDE_POINTS);
  for (const id of ["condylion", "tragion"] as const) {
    const companion = earGuideCompanion(id)!;
    const crop = guideCrop(GUIDE_POINTS[id], 1000, 1153, GUIDE_ZOOM[id]);
    for (const current of [id, companion]) {
      const right = guideMarkerPosition(GUIDE_POINTS[current], crop, 1000, 1153, 400, 1);
      const left = guideMarkerPosition(GUIDE_POINTS[current], crop, 1000, 1153, 400, -1);
      assert.ok(right.x > 0 && right.x < 400 && right.y > 0 && right.y < 400);
      assert.equal(left.x, 400 - right.x);
      assert.equal(left.y, right.y);
    }
  }
  assert.equal(earGuideCompanion("pronasale"), null);
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
