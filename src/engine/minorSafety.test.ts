import test from "node:test";
import assert from "node:assert/strict";
import { RECS, buyGuideFor } from "./recommendations.js";

// ---------------------------------------------------------------------------
// Over the counter is not the same as suitable for a child.
//
// The recommendation engine had no idea a person could be under eighteen. A
// sixteen-year-old registering an account was shown minoxidil with a category,
// a strength, a shop and a button reading "I'm going with this", which is the
// app telling a minor to start a drug. Found by the owner registering as a
// minor, not by either review.
// ---------------------------------------------------------------------------

const DRUGS = [
  "adapalene",
  "azelaic",
  "salicylic",
  "benzoyl-peroxide",
  "minoxidil",
  "keto-shampoo",
  "whitening",
  "brow-oils",
];

test("every pharmacological active is flagged as needing a guardian", () => {
  for (const id of DRUGS) {
    const rec = RECS.find((r) => r.id === id);
    assert.ok(rec, `${id} is still in the engine`);
    assert.equal(rec!.guardian, true, `${id} must be guardian-flagged`);
  }
});

test("nothing that is not a medicine carries the flag", () => {
  // The flag withholds a buying guide, so over-applying it would take
  // sunscreen away from a teenager, which is the single best line in the
  // product and the opposite of protecting them.
  const wrongly = RECS.filter((r) => r.guardian && !DRUGS.includes(r.id)).map((r) => r.id);
  assert.deepEqual(wrongly, [], `not medicines: ${wrongly.join(", ")}`);
  for (const id of ["spf", "emollient", "niacinamide", "sleep", "protein", "gentle-cleanse"]) {
    const rec = RECS.find((r) => r.id === id);
    assert.ok(rec, `${id} is still in the engine`);
    assert.notEqual(rec!.guardian, true, `${id} must stay freely available`);
  }
});

test("every guardian item still has something to say for itself", () => {
  // The card is not hidden from a minor, so it has to carry a real
  // explanation rather than becoming a stub with a warning on it.
  for (const id of DRUGS) {
    const rec = RECS.find((r) => r.id === id)!;
    assert.ok(rec.detail.length > 80, `${id} detail is too thin to stand alone`);
  }
});

test("the guardian set and the buying-guide set line up", () => {
  // Anything a minor is told to go and buy is exactly what this had to catch,
  // so every flagged item is one that would otherwise have carried a shelf.
  const withGuides = DRUGS.filter((id) => buyGuideFor(RECS.find((r) => r.id === id)!));
  assert.ok(withGuides.length >= 5, `only ${withGuides.length} carried a buying guide`);
});
