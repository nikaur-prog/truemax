import assert from "node:assert/strict";
import test from "node:test";
import { CELEBS } from "../engine/celebs.js";
import type { CelebEntry } from "../engine/celebs.js";
import { regionIsScored, scoreFrontMeasurements } from "../engine/scoring.js";
import { celebrityReferenceEstimate } from "./celebrityReferenceScore.js";

const fixture = CELEBS[0];

test("reference estimates use the canonical current scorer with no celebrity overrides", () => {
  for (const celebrity of CELEBS) {
    const snapshot = structuredClone(celebrity);
    const actual = celebrityReferenceEstimate(celebrity);
    const expected = scoreFrontMeasurements(celebrity.metrics, celebrity.sex);
    assert.equal(actual.score, expected.overall, celebrity.name);
    assert.deepEqual(actual.regions, Object.fromEntries(expected.regions
      .filter(region => regionIsScored(region) && Number.isFinite(region.score))
      .map(region => [region.region, region.score])));
    assert.deepEqual(celebrity, snapshot);
    assert.deepEqual(celebrityReferenceEstimate({ ...celebrity, name: "Another reference" }), actual);
  }
});

test("reference estimates use the entry's explicit sex, not a name or inferred photo appearance", () => {
  for (const sex of ["male", "female"] as const) {
    const entry: CelebEntry = { ...fixture, sex };
    assert.equal(celebrityReferenceEstimate(entry).score, scoreFrontMeasurements(fixture.metrics, sex).overall);
  }
  assert.notEqual(celebrityReferenceEstimate({ ...fixture, sex: "male" }).score,
    celebrityReferenceEstimate({ ...fixture, sex: "female" }).score);
});

test("missing measurements remain missing rather than becoming averages or zeros", () => {
  const metrics = { ...fixture.metrics };
  delete metrics.canthalTilt;
  delete metrics.browTilt;
  delete metrics.browPosition;
  const actual = celebrityReferenceEstimate({ ...fixture, metrics });
  assert.equal(actual.score, scoreFrontMeasurements(metrics, fixture.sex).overall);
  assert.equal("canthalTilt" in metrics, false);
});

test("empty, unrecognized or invalid evidence cannot produce a reference score", () => {
  const cases: Record<string, number>[] = [{}, { unknownMetric: 9 }, { canthalTilt: NaN }, { canthalTilt: Infinity }, { cheekFullness: -9999 }];
  for (const metrics of cases) {
    assert.deepEqual(celebrityReferenceEstimate({ ...fixture, metrics }), { score: null, regions: {} });
  }
});

test("unreliable reference regions do not receive a numeric estimate", () => {
  const actual = celebrityReferenceEstimate(fixture);
  const expected = scoreFrontMeasurements(fixture.metrics, fixture.sex);
  for (const region of expected.regions.filter(region => !regionIsScored(region))) {
    assert.equal(actual.regions[region.region], undefined);
  }
  assert.ok(expected.regions.some(region => !regionIsScored(region)));
});
