import test from "node:test";
import assert from "node:assert/strict";
import { SIDE_METRICS, SIDE_POINTS, computeSideMetrics } from "./sideMetrics.js";
import type { SidePointId, SidePoints } from "./sideMetrics.js";
import { TEMPLATE } from "../ui/sideVerify.js";

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

function templateHead(): SidePoints {
  const pts = {} as SidePoints;
  for (const { id } of SIDE_POINTS) {
    const [u, v] = TEMPLATE[id as SidePointId];
    pts[id as SidePointId] = { x: 400 + u * U, y: 100 + v * V };
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
