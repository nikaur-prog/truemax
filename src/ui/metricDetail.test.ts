import assert from "node:assert/strict";
import test from "node:test";
import { metricScoreLabel, stageViewFor, stepIndex } from "./metricDetail.js";
import { sideMeasurementBounds } from "./sideMeasureOverlay.js";
import { SIDE_METRICS, computeSideMetrics, faceDirFromPoints } from "../engine/sideMetrics.js";
import type { SidePoints } from "../engine/sideMetrics.js";
import type { ScoredMetric } from "../engine/types.js";

// ---------------------------------------------------------------------------
// The detail view's decisions, minus the DOM.
//
// Which photograph a metric renders on, how the deck steps, and where the
// camera is allowed to frame a side construction are all plain functions, and
// each one has a failure mode that already shipped once elsewhere: a side
// metric drawn on the front photograph at front coordinates, a counter that
// wrapped and lied, a zoom that framed a region while the measurement ran out
// of frame.
// ---------------------------------------------------------------------------

const asMetric = (id: string, region = "jaw"): ScoredMetric =>
  ({ def: { id, region, decimals: 1, unit: "°" }, value: 100 }) as unknown as ScoredMetric;

test("a side construction renders on the profile whenever the profile exists", () => {
  const gonial = asMetric("gonialAngle");
  assert.equal(stageViewFor(gonial, true, true), "side");
  // Without the profile it falls back to the front's region lighting, the
  // same honest fallback the main pane uses, rather than rendering nothing.
  assert.equal(stageViewFor(gonial, false, true), "front");
  const fwhr = asMetric("fwhr", "midface");
  assert.equal(stageViewFor(fwhr, true, true), "front");
  assert.equal(stageViewFor(fwhr, false, false), null);
});

test("the deck steps without wrapping", () => {
  assert.equal(stepIndex(0, -1, 5), 0);
  assert.equal(stepIndex(4, 1, 5), 4);
  assert.equal(stepIndex(2, 1, 5), 3);
  assert.equal(stepIndex(2, -1, 5), 1);
});

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

test("every scored side metric's zoom bounds contain its own construction", () => {
  const raw = computeSideMetrics(PROFILE, faceDirFromPoints(PROFILE));
  for (const def of SIDE_METRICS) {
    const m = { def, value: raw[def.id] } as unknown as ScoredMetric;
    const b = sideMeasurementBounds(m, PROFILE, 240, 360);
    assert.ok(b, `${def.id} has no bounds, so its detail view cannot frame it`);
    assert.ok(b.x0 >= 0 && b.y0 >= 0 && b.x1 <= 1.05 && b.y1 <= 1.05, `${def.id} bounds leave the frame: ${JSON.stringify(b)}`);
    assert.ok(b.x1 > b.x0 && b.y1 > b.y0, `${def.id} bounds are degenerate`);
  }
});

test("the H angle's frame holds nasion, lip and chin", () => {
  const raw = computeSideMetrics(PROFILE, faceDirFromPoints(PROFILE));
  const def = SIDE_METRICS.find((d) => d.id === "chinRecession")!;
  const m = { def, value: raw.chinRecession } as unknown as ScoredMetric;
  const b = sideMeasurementBounds(m, PROFILE, 240, 360)!;
  for (const id of ["nasion", "labialeSuperius", "pogonion"] as const) {
    const p = PROFILE[id];
    assert.ok(
      p.x / 240 >= b.x0 - 1e-9 && p.x / 240 <= b.x1 + 1e-9 && p.y / 360 >= b.y0 - 1e-9 && p.y / 360 <= b.y1 + 1e-9,
      `${id} sits outside the chinRecession frame`,
    );
  }
});

test("a metric with no recipe returns no bounds rather than a wrong box", () => {
  const b = sideMeasurementBounds(asMetric("noSuchMetric"), PROFILE, 240, 360);
  assert.equal(b, undefined);
});

test("measurement detail grades climb with the score", () => {
  assert.equal(metricScoreLabel(8.1, "Eyebrow tilt"), "Excellent eyebrow tilt");
  assert.equal(metricScoreLabel(6.4, "Jaw angle"), "Good jaw angle");
  assert.equal(metricScoreLabel(5.0, "Midface ratio"), "Balanced midface ratio");
  assert.equal(metricScoreLabel(3.8, "Chin projection"), "Below range chin projection");
  assert.equal(metricScoreLabel(2.7, "Lower lip"), "Weak lower lip");
});
