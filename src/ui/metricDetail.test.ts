import assert from "node:assert/strict";
import test from "node:test";
import { constructionCaveat, metricScoreLabel, overviewHTML, stageViewFor, stepIndex } from "./metricDetail.js";
import { sideMeasurementBounds } from "./sideMeasureOverlay.js";
import { SIDE_METRICS, computeSideMetrics, faceDirFromPoints } from "../engine/sideMetrics.js";
import type { SidePoints } from "../engine/sideMetrics.js";
import type { ScoredMetric } from "../engine/types.js";
import { METRICS } from "../engine/metrics.js";

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
  assert.equal(metricScoreLabel(8.1, "Eyebrow tilt"), "High model score for eyebrow tilt");
  assert.equal(metricScoreLabel(6.4, "Jaw angle"), "Above-reference score for jaw angle");
  assert.equal(metricScoreLabel(5.0, "Midface ratio"), "Mid-range model score for midface ratio");
  assert.equal(metricScoreLabel(3.8, "Chin projection"), "Below-reference score for chin projection");
  assert.equal(metricScoreLabel(2.7, "Lower lip"), "Below-reference score for lower lip");
  assert.equal(metricScoreLabel(Number.NaN, "Missing"), "Not scored");
});

test("indicative detail does not pair a caution with a confident trait or percentile", () => {
  const def = METRICS.find((d) => d.id === "nasalIndex")!;
  const m = { def, value: def.dist.male.mean + 3 * def.dist.male.sd, percentile: 3, conformance: 0.1, idealRange: [0.7, 0.8] } as ScoredMetric;
  const html = overviewHTML(m, "male");
  assert.match(html, /Indicative only/);
  assert.match(html, /no weight in the overall score/);
  assert.doesNotMatch(html, /mdx-pos|On your face:/);
});

test("unavailable hairline detail does not invent an anatomical fault", () => {
  const def = METRICS.find((d) => d.id === "foreheadRatio")!;
  const html = overviewHTML({ def, value: Number.NaN, implausible: true, idealRange: [0.1, 0.2] } as ScoredMetric, "male");
  assert.match(html, /required point or part of the geometry could not be read/);
  assert.doesNotMatch(html, /misplaced point|outside the range a face occupies/);
});

test("gonial detail distinguishes the photographed surface angle from its unvalidated skeletal reference", () => {
  const caveat = constructionCaveat("gonialAngle");
  assert.ok(caveat);
  assert.match(caveat, /photographic surface angle, not the skeletal gonial angle/);
  assert.match(caveat, /has not been validated for these surface points/);
  assert.match(caveat, /Point placement and head turn/);
});
