import test from "node:test";
import assert from "node:assert/strict";
import { SIDE_METRICS, SIDE_POINTS, computeSideMetrics, faceDirFromPoints } from "./sideMetrics.js";
import type { SidePointId, SidePoints } from "./sideMetrics.js";
import { TEMPLATE, headWidthFrom, keepSeedReachable } from "../ui/sideVerify.js";

// ---------------------------------------------------------------------------
// The guard may not reject our own reference head.
//
// TEMPLATE is the average profile the seeder places every estimated point
// from — where TrueMax says a landmark belongs before anybody drags anything.
// The plausibility bounds are what Confirm uses to REFUSE a placement as
// anatomically impossible. Those two are statements about the same anatomy, so
// if the second rejects the first, one of them is wrong and every user pays.
//
// It happened. The template placed condylion 26mm above the ear notch, on the
// temple, because the point was labelled "Jaw top" and that is where the top of
// the visible jaw region is. ramus : mandible is condylion->gonion over
// gonion->menton, so the top arm was inflated and nothing else was: the
// template scored 1.034 against a bound of 0.35-0.95.
//
// The consequence was not subtle and was still missed. Confirm refused three
// consecutive real profiles whose points were placed correctly, naming gonion,
// condylion and menton — and the operator, reasonably, believed the app. Two
// faces reached an export before anybody read the numbers.
//
// Nothing in the suite asked this question, because every other side test
// supplies its own hand-written fixture and therefore tests the code against a
// second opinion rather than against the shipped one. This asks it directly.
// ---------------------------------------------------------------------------

// Roughly 1px per mm on an adult head: nose tip to ear canal ~135mm, hairline
// to chin ~185mm. Any scale gives the same ratios; real millimetres just make a
// failure readable.
const U = 135;
const V = 185;

// headWidth defaults to a real one. placeBackPoints scales u by the ESTIMATED
// head width and v by the head height, so passing it explicitly is what lets
// the range test below walk every head the seeder is able to emit.
function templateHead(headWidth = U): SidePoints {
  const pts = {} as SidePoints;
  for (const { id } of SIDE_POINTS) {
    const [u, v] = TEMPLATE[id as SidePointId];
    pts[id as SidePointId] = { x: 400 + u * headWidth, y: 100 + v * V };
  }
  return pts;
}

test("the average head the seeder draws from is inside every plausibility bound", () => {
  const measured = computeSideMetrics(templateHead(), -1);
  const rejected = SIDE_METRICS.filter((def) => {
    if (!def.plausible) return false;
    const value = measured[def.id];
    return !Number.isFinite(value) || value < def.plausible[0] || value > def.plausible[1];
  }).map((def) => `${def.id} = ${measured[def.id].toFixed(3)} outside [${def.plausible!.join(", ")}]`);

  assert.deepEqual(
    rejected,
    [],
    `Confirm would refuse its own reference profile:\n  ${rejected.join("\n  ")}\n` +
      `Either the template puts a point somewhere a face does not have one, or the ` +
      `bound describes a quantity this construction does not measure. Both are bugs; ` +
      `widening the bound to silence this is only correct once the construction is ruled out.`,
  );
});

test("the jaw hinge sits at the ear canal, not up on the temple", () => {
  // The specific regression. Stated as anatomy rather than as a number: the
  // condyle is the joint the jaw pivots on and lives immediately in front of
  // the ear canal, so it cannot be far above the ear notch. The tolerance is
  // deliberately loose — this is here to catch centimetres, not millimetres.
  const [condU, condV] = TEMPLATE.condylion;
  const [tragU, tragV] = TEMPLATE.tragion;
  const above = (tragV - condV) * V;
  assert.ok(
    above >= -8 && above <= 18,
    `the jaw hinge sits ${above.toFixed(0)}mm above the ear notch, which is not where a jaw joint is`,
  );
  assert.ok(
    condU > tragU,
    "the jaw hinge must sit FORWARD of the ear notch — the condyle is anterior to the canal",
  );
});

test("no head width the estimator can return produces a rejected head", () => {
  // THE TEST THAT WAS MISSING, and the reason a real fix did not fix anything.
  //
  // The check above scores the template at ONE head width — a realistic one —
  // and passed while the app went on refusing correct placements. The template
  // is only half of a seeded head: placeBackPoints scales the u axis by an
  // ESTIMATED head width, so the shape that reaches the guard depends on a
  // number measured per photo, and that estimate can fail. Squash the width and
  // the mandibular body shortens while the ramus does not.
  //
  // Testing one point in a range says nothing about the range. So this walks
  // every width headWidthFrom is capable of returning, including from estimates
  // that are degenerate, absent or absurd, and requires the whole span to
  // survive the same guard the operator meets.
  const estimates = [
    0, 1, -50, Number.NaN, Number.POSITIVE_INFINITY,
    ...Array.from({ length: 40 }, (_, i) => V * (0.05 + i * 0.05)),
  ];
  const failures: string[] = [];
  for (const estimate of estimates) {
    const width = headWidthFrom(estimate, V);
    const measured = computeSideMetrics(templateHead(width), -1);
    for (const def of SIDE_METRICS) {
      if (!def.plausible) continue;
      const value = measured[def.id];
      if (!Number.isFinite(value) || value < def.plausible[0] || value > def.plausible[1]) {
        failures.push(
          `estimate ${estimate} -> width ${(width / V).toFixed(2)}x height: ` +
            `${def.id} = ${value.toFixed(3)} outside [${def.plausible.join(", ")}]`,
        );
      }
    }
  }
  assert.deepEqual(failures.slice(0, 6), [], failures.slice(0, 6).join("\n  "));
});

test("a head width that no head has is refused, not clamped to the edge", () => {
  // Clamping a degenerate estimate to the boundary is what made the failure
  // silent: 0.3x height is not a narrow head, it is not a head, and reshaping
  // the template to it produced a confident measurement of nothing. Anything
  // outside the range real heads occupy must come back as the population
  // figure instead.
  for (const nonsense of [0, V * 0.1, V * 3, Number.NaN]) {
    const ratio = headWidthFrom(nonsense, V) / V;
    assert.ok(
      ratio >= 0.62 && ratio <= 0.88,
      `an estimate of ${nonsense} produced ${ratio.toFixed(2)}x head height`,
    );
  }
  // A believable estimate is still respected — this must not flatten every
  // head to the average.
  assert.equal(headWidthFrom(V * 0.8, V), V * 0.8);
});

// ---------------------------------------------------------------------------
// The bounds, against faces we KNOW were placed correctly.
//
// Everything above tests the template. This tests the bounds, and it is the
// check whose absence let a guard reject its own ground truth three times in
// front of an operator who was doing nothing wrong.
//
// The other plausibility test uses a hand-authored profile. That fixture was
// drawn to satisfy the bounds, so it can only confirm they agree with the
// drawing — it cannot notice that real faces disagree. These are the actual
// hand-corrected exports from docs/SIDE_FIXTURES.md: thirteen points dragged
// into place on real photographs by a person looking at them.
//
// The coordinates are normalised against each photo's own width and height,
// and those dimensions were not recorded, so the aspect has to be recovered
// before the geometry means anything — at 1:1 a fixture reads 0.77 and at 9:16
// the same numbers read 1.29. It is recovered from the one proportion
// anthropometry pins down: hairline-to-chin over nose-tip-to-ear-canal, about
// 18.5cm to 13.5cm on an adult head.
// ---------------------------------------------------------------------------

const GROUND_TRUTH: Record<string, Record<string, [number, number]>> = {
  E: {"trichion":[0.3486,0.3469],"glabella":[0.3406,0.4212],"nasion":[0.3405,0.4594],"pronasale":[0.2995,0.5484],"subnasale":[0.3254,0.562],"labialeSuperius":[0.3094,0.5857],"labialeInferius":[0.3139,0.6352],"pogonion":[0.341,0.6926],"menton":[0.3517,0.7045],"gonion":[0.5836,0.6551],"condylion":[0.6216,0.477],"cervicale":[0.477,0.7036],"tragion":[0.6159,0.5222]},
  F: {"trichion":[0.3392,0.3217],"glabella":[0.2958,0.3916],"nasion":[0.3047,0.433],"pronasale":[0.2456,0.4889],"subnasale":[0.277,0.5293],"labialeSuperius":[0.2606,0.5579],"labialeInferius":[0.2599,0.6124],"pogonion":[0.2733,0.6683],"menton":[0.3454,0.697],"gonion":[0.5482,0.6357],"condylion":[0.5641,0.4633],"cervicale":[0.4728,0.6983],"tragion":[0.5833,0.5178]},
  G: {"trichion":[0.2794,0.4203],"glabella":[0.2727,0.4823],"nasion":[0.2824,0.5103],"pronasale":[0.2433,0.5929],"subnasale":[0.278,0.6134],"labialeSuperius":[0.2683,0.6418],"labialeInferius":[0.2898,0.6874],"pogonion":[0.3024,0.7405],"menton":[0.3585,0.7549],"gonion":[0.5468,0.6891],"condylion":[0.5024,0.4911],"cervicale":[0.4677,0.745],"tragion":[0.6045,0.5846]},
};

function atRecoveredAspect(set: Record<string, [number, number]>): SidePoints {
  const build = (aspect: number): SidePoints => {
    const p = {} as SidePoints;
    for (const [id, [x, y]] of Object.entries(set)) {
      p[id as SidePointId] = { x: x * 1000, y: y * 1000 * aspect };
    }
    return p;
  };
  let best = { aspect: 1, err: Infinity };
  for (let aspect = 0.5; aspect <= 3; aspect += 0.005) {
    const p = build(aspect);
    const height = Math.hypot(p.trichion.x - p.menton.x, p.trichion.y - p.menton.y);
    const depth = Math.hypot(p.pronasale.x - p.tragion.x, p.pronasale.y - p.tragion.y);
    const err = Math.abs(height / depth - 18.5 / 13.5);
    if (err < best.err) best = { aspect, err };
  }
  return build(best.aspect);
}

test("no bound rejects a profile a human placed correctly", () => {
  const rejected: string[] = [];
  for (const [name, set] of Object.entries(GROUND_TRUTH)) {
    const measured = computeSideMetrics(atRecoveredAspect(set), faceDirFromPoints(atRecoveredAspect(set)));
    for (const def of SIDE_METRICS) {
      if (!def.plausible) continue;
      const value = measured[def.id];
      if (!Number.isFinite(value) || value < def.plausible[0] || value > def.plausible[1]) {
        rejected.push(
          `set ${name}: ${def.id} = ${value.toFixed(3)} outside [${def.plausible.join(", ")}]`,
        );
      }
    }
  }
  assert.deepEqual(
    rejected,
    [],
    `a bound rejects hand-placed ground truth, so it does not describe this ` +
      `construction:\n  ${rejected.join("\n  ")}\n` +
      `Hold the metric out of scoring until its norm can be re-derived from our ` +
      `own measurements. Do NOT widen the bound to a number that makes this pass.`,
  );
});

test("a seeded point can never start outside reach", () => {
  // The failure: a misread facing hands sanitizeSeed's robust fit a negative
  // slope, the fit rightly declines, and its clamp — which lived inside the
  // fit — declined with it. Points seeded past the border were then clipped
  // by the frame's overflow: hidden, so the operator could watch Confirm name
  // a point as outside the photo and had no way to touch it. Every seed now
  // passes through keepSeedReachable unconditionally; this pins what it
  // guarantees, including that a point ON the border is pulled in far enough
  // for the whole ring to be a tap target.
  const wild = templateHead();
  wild.tragion = { x: 5000, y: -300 };
  wild.gonion = { x: 1000, y: 640 }; // exactly on the right border
  wild.cervicale = { x: -80, y: 9000 };
  const reachable = keepSeedReachable(wild, 1000, 640);
  for (const { id } of SIDE_POINTS) {
    const p = reachable[id];
    assert.ok(p.x >= 10 && p.x <= 990, `${id} x=${p.x} is not grabbable in a 1000-wide frame`);
    assert.ok(p.y >= 10 && p.y <= 630, `${id} y=${p.y} is not grabbable in a 640-tall frame`);
  }
  // A point already well inside moves not at all — this is containment, not
  // a layout pass.
  assert.deepEqual(reachable.pronasale, wild.pronasale);
});

test("the template's jaw proportions read as a jaw", () => {
  // Ramus shorter than body is not a preference, it is what a mandible is: the
  // published figures are roughly 50mm of ramus against 75mm of body. A
  // template that inverts that will teach the seeder to invert it on every
  // face, and the resulting metric is then wrong in a fixed direction on all of
  // them — the hardest kind of error to notice from inside the data.
  const p = templateHead();
  const d = (a: SidePointId, b: SidePointId) => Math.hypot(p[a].x - p[b].x, p[a].y - p[b].y);
  assert.ok(
    d("condylion", "gonion") < d("gonion", "menton"),
    "the ramus came out longer than the mandibular body, which no jaw is",
  );
});
