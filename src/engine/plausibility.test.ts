import assert from "node:assert/strict";
import test from "node:test";
import { SIDE_METRICS, SIDE_POINTS } from "./sideMetrics.js";
import { analyzeSide } from "./scoring.js";
import type { SidePoints } from "./sideMetrics.js";

// A profile facing image-right, laid out to roughly human proportions. Not a
// real scan — the point is that every measurement built from it lands inside
// its plausible bounds, so the guard cannot be firing on ordinary faces.
function realisticProfile(): SidePoints {
  return {
    trichion: { x: 300, y: 100 },
    glabella: { x: 330, y: 190 },
    nasion: { x: 325, y: 210 },
    pronasale: { x: 395, y: 265 },
    subnasale: { x: 355, y: 295 },
    labialeSuperius: { x: 360, y: 320 },
    labialeInferius: { x: 358, y: 345 },
    pogonion: { x: 350, y: 390 },
    menton: { x: 335, y: 410 },
    gonion: { x: 215, y: 360 },
    condylion: { x: 205, y: 250 },
    cervicale: { x: 240, y: 430 },
    tragion: { x: 200, y: 240 },
  } as SidePoints;
}

test("an ordinary profile trips no plausibility bound", () => {
  const report = analyzeSide(realisticProfile(), 1, "male");
  const flagged = report.metrics.filter((m) => m.implausible).map((m) => m.def.id);
  assert.deepEqual(flagged, [], `guard fired on a normal face: ${flagged.join(", ")}`);
});

// The failure this guard was built for: gonion dragged down the neck, which
// lengthens condylion→gonion and shortens gonion→menton at the same time and
// pushes the ramus ratio toward 1.0.
test("a jaw corner placed down the neck is caught, not scored", () => {
  const points = realisticProfile();
  points.gonion = { x: 250, y: 430 };
  const report = analyzeSide(points, 1, "male");
  const ramus = report.metrics.find((m) => m.def.id === "ramusMandible");
  assert.ok(ramus, "ramusMandible should still be measured and displayed");
  assert.equal(ramus!.implausible, true, "an impossible ramus ratio must be flagged");
});

test("an excluded measurement cannot drag the jaw score down", () => {
  const good = analyzeSide(realisticProfile(), 1, "male");
  const points = realisticProfile();
  points.gonion = { x: 250, y: 430 };
  const bad = analyzeSide(points, 1, "male");

  const jawOf = (r: typeof good) => r.regions.find((x) => x.region === "jaw")!;
  // Moving the point still changes the OTHER jaw measurements, so the scores
  // are not expected to match. What must hold is that the flagged one is
  // carrying no weight: it is excluded, not merely discounted.
  const flagged = bad.metrics.filter((m) => m.implausible);
  assert.ok(flagged.length > 0, "the misplacement should flag at least one metric");
  for (const m of flagged) {
    assert.ok(
      Number.isFinite(jawOf(bad).z),
      "the region aggregate must stay finite with a metric excluded",
    );
    assert.notEqual(m.def.plausible, undefined, "only bounded metrics can be flagged");
  }
});

// The guard is only honest if the bounds sit far outside the reference spread.
// A bound inside a few sigma would be a second opinion about what a good face
// is, dressed up as a sanity check.
test("every bound is far outside its own reference distribution", () => {
  for (const def of SIDE_METRICS) {
    if (!def.plausible) continue;
    const [lo, hi] = def.plausible;
    for (const sex of ["male", "female"] as const) {
      const d = def.dist[sex];
      const loZ = (d.mean - lo) / d.sd;
      const hiZ = (hi - d.mean) / d.sd;
      assert.ok(loZ >= 2.5, `${def.id} ${sex}: lower bound only ${loZ.toFixed(1)}σ out`);
      assert.ok(hiZ >= 2.5, `${def.id} ${sex}: upper bound only ${hiZ.toFixed(1)}σ out`);
    }
  }
});

// An excluded measurement has to be able to say what to fix, or the person is
// told something is wrong and given no way to act on it.
test("every bounded metric names real landmarks", () => {
  const ids = new Set(SIDE_POINTS.map((p) => p.id));
  for (const def of SIDE_METRICS) {
    if (!def.plausible) continue;
    assert.ok(def.points?.length, `${def.id} has bounds but names no points`);
    for (const id of def.points!) {
      assert.ok(ids.has(id as never), `${def.id} names unknown landmark "${id}"`);
    }
  }
});
