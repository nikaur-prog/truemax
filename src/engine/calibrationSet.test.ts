import test from "node:test";
import assert from "node:assert/strict";
import { corpusJSON, measurementsOf, splitByProvenance } from "./calibrationSet.js";
import type { RatedFace } from "./calibrationSet.js";
import type { Report } from "./types.js";

// Only `metrics` is read, so the rest of a Report is noise here.
const reportWith = (metrics: Array<[string, "front" | "side", number]>): Report =>
  ({
    metrics: metrics.map(([id, view, value]) => ({ def: { id, view }, value })),
  }) as unknown as Report;

test("merges front and side into one row", () => {
  const front = reportWith([["fwhr", "front", 1.9], ["lipRatio", "front", 0.5]]);
  const side = reportWith([["chinProjection", "side", 12], ["gonialAngle", "side", 121]]);
  assert.deepEqual(measurementsOf(front, side), {
    fwhr: 1.9,
    lipRatio: 0.5,
    chinProjection: 12,
    gonialAngle: 121,
  });
});

test("a front-only face is still a full front row", () => {
  const front = reportWith([["fwhr", "front", 1.9]]);
  assert.deepEqual(measurementsOf(front), { fwhr: 1.9 });
});

// The property the corpus format depends on: an absent view contributes
// nothing rather than nulls, which is the same shape as a metric that
// postdates the face. One absence mechanism, not two.
test("an unmeasurable metric is omitted, never written as null", () => {
  const front = reportWith([
    ["fwhr", "front", 1.9],
    ["foreheadRatio", "front", Number.NaN],
    ["midfaceRatio", "front", Number.POSITIVE_INFINITY],
  ]);
  const out = measurementsOf(front);
  assert.deepEqual(out, { fwhr: 1.9 });
  assert.ok(!("foreheadRatio" in out));
  assert.ok(!("midfaceRatio" in out));
});

test("no reports is an empty row, not a crash", () => {
  assert.deepEqual(measurementsOf(), {});
});

// ---------------------------------------------------------------------------
// Rating provenance.
//
// These exist because the failure they describe already happened once and left
// no trace in the data. A competing product's score for a face was typed into
// the rating box while its analysis of that same face was open in another tab.
// The row that came out was indistinguishable from an honest one, and had it
// reached the corpus it would have made the fit a regression onto that
// product's formula — reverse-engineering its scoring with arithmetic.
// ---------------------------------------------------------------------------

const face = (id: string, ratedBy?: RatedFace["ratedBy"]): RatedFace => ({
  id,
  sex: "male",
  rating: 7.8,
  scored: 5.5,
  ...(ratedBy ? { ratedBy } : {}),
  measurements: { fwhr: 1.97 },
});

test("a borrowed rating never reaches the corpus export", () => {
  const out = JSON.parse(corpusJSON([face("m1", "external"), face("m2", "self")]));
  assert.deepEqual(out.faces.map((f: { id: string }) => f.id), ["m2"]);
});

test("a row written before provenance existed is held out, not assumed honest", () => {
  // The direction that matters. The one row known to be contaminated carries no
  // ratedBy, so treating an absent field as "self" would wave through exactly
  // the case this was built to catch.
  const out = JSON.parse(corpusJSON([face("m1")]));
  assert.deepEqual(out.faces, []);
});

test("the split keeps withheld rows rather than dropping them", () => {
  // A held row is still a scan and a measurement set. It stays in the set so it
  // can be seen, corrected or removed on purpose — silently vanishing would
  // read as data loss.
  const faces = [face("m1"), face("m2", "external"), face("m3", "self")];
  const { own, withheld } = splitByProvenance(faces);
  assert.deepEqual(own.map((f) => f.id), ["m3"]);
  assert.deepEqual(withheld.map((f) => f.id), ["m1", "m2"]);
});

test("the export carries no provenance field of its own", () => {
  // Everything that survives the filter is `self` by construction, so writing
  // the field into every exported row would say nothing — and corpus.json has
  // no place to put it.
  const out = JSON.parse(corpusJSON([face("m1", "self")]));
  assert.deepEqual(Object.keys(out.faces[0]).sort(), ["id", "measurements", "rating", "sex"]);
});
