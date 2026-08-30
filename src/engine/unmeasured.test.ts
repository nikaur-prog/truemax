import test from "node:test";
import assert from "node:assert/strict";
import corpus from "./calibration/corpus.json" with { type: "json" };
import { METRICS } from "./metrics.js";
import { scoreFrontMeasurements } from "./scoring.js";
import { fmt, regionSummary, wasMeasured } from "../ui/templates.js";
import type { Sex } from "./types.js";

// ---------------------------------------------------------------------------
// A measurement that could not be taken must not reach the report.
//
// The validity check in scoreFrontMeasurements deliberately exempts the pixel
// metrics: hairline detection refuses rather than guesses when the contrast is
// weak — a fringe, hair the colour of skin, a receded hairline with no step to
// find — and refusing is the right behaviour. What was wrong was what happened
// next. The metric was scored anyway, with `raw[id]` undefined, and a
// ScoredMetric carrying `value: undefined` went into the report.
//
// `fmt()` is `m.value.toFixed(...)`, so the first screen that tried to print
// the number threw, and because the throw happened while the panel's innerHTML
// was being built the whole analysis pane rendered blank. foreheadRatio is a
// MIDFACE metric and the only exempted one, which is why the symptom was that
// single region tab: click Midface, get nothing, every other tab fine.
// ---------------------------------------------------------------------------

interface Face { id: string; sex: Sex; rating: number; measurements: Record<string, number> }
const FACES = (corpus as { faces: Face[] }).faces;
const FACE = FACES[0];

// Every front metric the engine will not refuse to score without.
const PIXEL = ["foreheadRatio"];

test("a face with no hairline reading still produces a printable report", () => {
  // THE test. Take a real corpus face, remove exactly what the detector refuses
  // to guess at, and walk the report the way the screen does.
  const measurements = { ...FACE.measurements };
  for (const id of PIXEL) delete measurements[id];

  const report = scoreFrontMeasurements(measurements, FACE.sex);
  for (const m of report.metrics) {
    // The call that actually threw, on the actual data.
    assert.doesNotThrow(() => fmt(m), `fmt(${m.def.id}) threw`);
    assert.doesNotMatch(fmt(m), /undefined|NaN/, m.def.id);
  }
  for (const r of report.regions) {
    for (const m of r.metrics) assert.doesNotThrow(() => fmt(m), `${r.region}/${m.def.id}`);
    assert.doesNotThrow(() => regionSummary(r, FACE.sex), `regionSummary(${r.region}) threw`);
  }
});

test("the unmeasured metric is reported as absent, never as a number", () => {
  // The tempting fix is to substitute a value, and it is the wrong one: a
  // hairline the app could not see would be scored as a hairline of zero
  // height, which is a fabricated measurement in a product whose whole claim is
  // that it does not fabricate them. It stays in the report, flagged — that is
  // what `implausible` is for and what calibration.test.ts already pins — and
  // it prints as an absence.
  const measurements = { ...FACE.measurements };
  delete measurements.foreheadRatio;
  const report = scoreFrontMeasurements(measurements, FACE.sex);
  const fr = report.metrics.find((m) => m.def.id === "foreheadRatio");
  assert.ok(fr, "the metric should still be in the report, flagged");
  assert.equal(fr.implausible, true, "an unmeasurable metric must be excluded from aggregates");
  assert.equal(wasMeasured(fr), false);
  assert.equal(fmt(fr), "–");
  // And it must not have poisoned anything around it.
  const midface = report.regions.find((r) => r.region === "midface")!;
  assert.ok(Number.isFinite(midface.score), "midface score went non-finite");
  assert.ok(midface.metrics.filter(wasMeasured).length > 0, "midface lost every measurement");
});

test("the report still carries every front metric", () => {
  // The fix must not have quietly become "score fewer things".
  const report = scoreFrontMeasurements(FACE.measurements, FACE.sex);
  assert.deepEqual(
    report.metrics.map((m) => m.def.id).sort(),
    METRICS.filter((m) => m.view === "front").map((m) => m.id).sort(),
  );
});

test("every corpus face survives the same walk", () => {
  // One face passing could be one lucky face. This is the whole corpus through
  // the same path, with and without the pixel metrics.
  for (const face of FACES) {
    for (const strip of [false, true]) {
      const measurements = { ...face.measurements };
      if (strip) for (const id of PIXEL) delete measurements[id];
      const report = scoreFrontMeasurements(measurements, face.sex);
      for (const m of report.metrics) {
        assert.doesNotThrow(() => fmt(m), `${face.id}${strip ? " (stripped)" : ""}: ${m.def.id}`);
      }
      for (const r of report.regions) {
        assert.doesNotThrow(() => regionSummary(r, face.sex), `${face.id}: ${r.region}`);
        assert.doesNotMatch(regionSummary(r, face.sex), /undefined|NaN/, `${face.id}: ${r.region}`);
      }
      assert.ok(Number.isFinite(report.overall), `${face.id}: overall went non-finite`);
    }
  }
});

test("an empty region is described rather than crashed on", () => {
  // regionSummary read sorted[0].percentile with no guard, which is the same
  // crash one line further along. A region CAN be empty now: the side view
  // scores no metric at all in several of them.
  const empty = { region: "midface" as const, score: 5, percentile: 50, z: 0, metrics: [], reliability: 0 };
  const said = regionSummary(empty, "male");
  // The PROPERTY, not the phrasing. This used to pin the exact sentence
  // ("Nothing in the midface could be measured"), so rewriting the summary in
  // a coach's voice failed a test that was not about voice at all. What has to
  // hold is that the region is named, the reader is told it is not scored, and
  // no placeholder leaks.
  assert.match(said, /midface/);
  assert.match(said, /not scoring it|not going to score it|not scored/);
  assert.doesNotMatch(said, /undefined|NaN/);
});
