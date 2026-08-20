import test from "node:test";
import assert from "node:assert/strict";
import { SIDE_METRICS, SIDE_POINTS, computeSideMetrics } from "./sideMetrics.js";
import type { SidePointId, SidePoints } from "./sideMetrics.js";
import { TEMPLATE, headWidthFrom } from "../ui/sideVerify.js";

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
