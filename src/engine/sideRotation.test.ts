import test from "node:test";
import assert from "node:assert/strict";
import { computeSideMetrics } from "./sideMetrics.js";
import type { SidePoints } from "./sideMetrics.js";

// A plausible right-facing profile, the same fixture the integrity guard uses.
const PROFILE: SidePoints = {
  trichion: { x: 120, y: 50 },
  glabella: { x: 130, y: 90 },
  nasion: { x: 128, y: 110 },
  pronasale: { x: 180, y: 160 },
  subnasale: { x: 150, y: 190 },
  labialeSuperius: { x: 155, y: 215 },
  labialeInferius: { x: 153, y: 245 },
  pogonion: { x: 160, y: 290 },
  menton: { x: 145, y: 320 },
  gonion: { x: 70, y: 285 },
  condylion: { x: 72, y: 155 },
  cervicale: { x: 90, y: 330 },
  tragion: { x: 65, y: 170 },
};

function roll(p: SidePoints, deg: number): SidePoints {
  const t = (deg * Math.PI) / 180;
  const cx = 120;
  const cy = 190;
  const out = {} as SidePoints;
  for (const [k, v] of Object.entries(p) as Array<[keyof SidePoints, { x: number; y: number }]>) {
    const dx = v.x - cx;
    const dy = v.y - cy;
    out[k] = {
      x: cx + dx * Math.cos(t) - dy * Math.sin(t),
      y: cy + dx * Math.sin(t) + dy * Math.cos(t),
    };
  }
  return out;
}

// Established by reading every construction in computeSideMetrics, then pinned
// here. Three metrics measure against the IMAGE's vertical — fromVertical, or a
// synthetic point placed straight down the y axis — and the rest are angles
// between two landmark-defined segments or ratios of landmark distances, which
// a roll cannot touch.
const AXIS_DEPENDENT = ["submentalCervical", "mandibularPlane", "foreheadSlope"];

test("only three side metrics can be changed by levelling the photograph", () => {
  // This decides what a "level the profile" step is worth, and it is the reason
  // that step is not the fix for side repeatability. Rotating the image cannot
  // move a rotation-invariant quantity, so when nasolabial angle swings 21.9°
  // between two photographs of one person, image roll is not the cause — real
  // out-of-plane head pose, or point placement, is. Levelling a 2D photograph
  // cannot correct 3D pose.
  const base = computeSideMetrics(PROFILE, 1);
  const rolled = computeSideMetrics(roll(PROFILE, 8), 1);

  const moved: string[] = [];
  for (const id of Object.keys(base)) {
    if (Math.abs(rolled[id] - base[id]) > 1e-6) moved.push(id);
  }
  assert.deepEqual(moved.sort(), [...AXIS_DEPENDENT].sort());
});

test("the three that do move, move by the roll angle", () => {
  // Not merely "different" — different by exactly the rotation, which is what
  // makes levelling a complete fix for these three rather than a partial one.
  // Magnitudes compared, because the three do not agree on sign: a roll that
  // adds to mandibularPlane subtracts the same amount from foreheadSlope and
  // submentalCervical, which measure their angle from the opposite side of
  // vertical. The size is what matters — each is displaced by the roll exactly.
  const base = computeSideMetrics(PROFILE, 1);
  for (const deg of [5, -5, 12]) {
    const rolled = computeSideMetrics(roll(PROFILE, deg), 1);
    for (const id of AXIS_DEPENDENT) {
      const shift = Math.abs(rolled[id] - base[id]);
      assert.ok(
        Math.abs(shift - Math.abs(deg)) < 0.001,
        `${id} shifted ${(rolled[id] - base[id]).toFixed(3)} under a ${deg}° roll, expected ${Math.abs(deg)}`,
      );
    }
  }
});

test("the angles a profile is actually judged on survive any roll", () => {
  // The headline side measurements — the ones a user is told about and the ones
  // the benchmark compares — are all invariant. Levelling changes none of them.
  const base = computeSideMetrics(PROFILE, 1);
  const rolled = computeSideMetrics(roll(PROFILE, 15), 1);
  for (const id of [
    "gonialAngle",
    "nasolabialAngle",
    "nasofrontalAngle",
    "facialConvexity",
    "totalFacialConvexity",
    "nasalProjection",
    "chinProjection",
    "upperLipELine",
    "lowerLipELine",
  ]) {
    assert.ok(Math.abs(rolled[id] - base[id]) < 1e-6, `${id} moved under a pure image roll`);
  }
});
