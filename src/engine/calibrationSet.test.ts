import test from "node:test";
import assert from "node:assert/strict";
import { corpusJSON, measurementsOf, setHealth, splitByProvenance } from "./calibrationSet.js";
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

test("the thumbnail and the suspect flag never reach the corpus export", () => {
  // The thumbnail is a photograph of a real face and the suspect count is an
  // internal audit flag; the corpus is a file that gets pasted into a public
  // repository. The export picks its fields by name, and this pins that a
  // future "just spread the row" refactor cannot quietly start shipping faces.
  const rich: RatedFace = {
    ...face("m1", "self"),
    thumb: "data:image/jpeg;base64,AAAA",
    suspect: 2,
  };
  const out = corpusJSON([rich]);
  assert.ok(!out.includes("data:image"), "the export carries a photograph");
  assert.ok(!out.includes("suspect"), "the export carries the audit flag");
  assert.ok(!out.includes("thumb"), "the export carries the thumb field");
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

test("an unrated face is stored but never exported", () => {
  // Skipping is a real answer. The measurements and any side corrections are
  // exactly as valuable as they were — what is missing is the thing being
  // fitted TO, so the row cannot join the fit and must not silently do so.
  const out = JSON.parse(corpusJSON([{ ...face("m1", "self"), rating: null }]));
  assert.deepEqual(out.faces, []);
});

test("unrated rows are held, not treated as borrowed", () => {
  const faces = [
    { ...face("m1", "self"), rating: null },
    face("m2", "self"),
    face("m3", "external"),
  ];
  const { own, withheld } = splitByProvenance(faces);
  assert.deepEqual(own.map((f) => f.id), ["m2"]);
  // Both land outside `own`, for different reasons — one has no number, the
  // other has the wrong one. The set list tells them apart in its own copy.
  assert.deepEqual(withheld.map((f) => f.id), ["m1", "m3"]);
});

test("spread ignores unrated faces rather than reading them as zero", () => {
  // The trap: a null rating coerces to 0 in arithmetic, which would have made
  // any set containing a skipped face look like it spanned the whole scale.
  const rated = (id: string, rating: number | null): RatedFace => ({ ...face(id, "self"), rating });
  const health = setHealth([rated("m1", 4), rated("m2", 6), rated("m3", null)], "male");
  assert.equal(health.spread, 2);
});

// ---------------------------------------------------------------------------
// Ids after a deletion.
//
// Deleting is how the set is actually kept clean — scan a face, notice the
// photo was turned or the seed was wrong, remove it, carry on. So the id
// scheme has to survive it, and counting rows does not.
// ---------------------------------------------------------------------------

test("a deleted row does not hand its id to the next face", () => {
  // The trap, in the sequence that produces it: three men, remove the middle
  // one, add a fourth. Counting gives the newcomer m3, which the surviving m3
  // already answers to — two faces, one id, in the file that gets fitted.
  const remaining: RatedFace[] = [face("m1", "self"), face("m3", "self")];
  const nextId = (faces: RatedFace[], sex: "male" | "female") => {
    const prefix = sex === "male" ? "m" : "w";
    const used = faces
      .filter((f) => f.sex === sex)
      .map((f) => Number.parseInt(f.id.slice(1), 10))
      .filter((value) => Number.isFinite(value));
    return `${prefix}${(used.length ? Math.max(...used) : 0) + 1}`;
  };
  const assigned = nextId(remaining, "male");
  assert.equal(assigned, "m4", "the next id must clear the highest in use, not the count");
  assert.ok(
    !remaining.some((f) => f.id === assigned),
    "an id already in the set was handed out a second time",
  );
});

test("an empty set starts at one", () => {
  const used: number[] = [];
  assert.equal((used.length ? Math.max(...used) : 0) + 1, 1);
});

// ---------------------------------------------------------------------------
// Revising a rating that is already stored.
//
// By the time a row exists the verdict screen has printed the engine's number
// beside the human one, so every edit happens with that number known. An edit
// that moved toward it is the engine marking its own homework: agreement would
// improve while nothing about the measurements got better.
// ---------------------------------------------------------------------------

test("a rating changed after seeing the score is kept but never fitted", () => {
  const revised: RatedFace = { ...face("m1", "self"), rating: 5.4, ratedBy: "revised" };
  const { own, withheld } = splitByProvenance([revised, face("m2", "self")]);
  assert.deepEqual(own.map((f) => f.id), ["m2"], "a revised rating must not reach the fit");
  assert.deepEqual(withheld.map((f) => f.id), ["m1"], "and must not vanish either");
  assert.deepEqual(JSON.parse(corpusJSON([revised])).faces, []);
});

test("a mistyped rating stays fittable, because nothing was learned from the engine", () => {
  // The distinction the edit screen asks about. Same act mechanically, opposite
  // meaning: the intended answer was always this one.
  const corrected: RatedFace = { ...face("m1", "self"), rating: 5.4 };
  assert.deepEqual(splitByProvenance([corrected]).own.map((f) => f.id), ["m1"]);
});

test("spread still reads a revised row, which is a set-health question not a fit one", () => {
  // setHealth describes what has been COLLECTED, so a row held out of the
  // export still counts toward whether the ends of the scale are covered.
  const at = (id: string, rating: number, ratedBy: RatedFace["ratedBy"]): RatedFace =>
    ({ ...face(id, ratedBy), rating });
  const health = setHealth([at("m1", 3, "revised"), at("m2", 8, "self")], "male");
  assert.equal(health.spread, 5);
});
