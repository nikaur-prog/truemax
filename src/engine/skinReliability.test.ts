import test from "node:test";
import assert from "node:assert/strict";
import { SKIN_COVERAGE_MIN, skinReliable } from "./skin.js";

// ---------------------------------------------------------------------------
// coverage, finally consumed.
//
// analyzeSkin has always reported what fraction of the face was actually
// usable skin, and nothing ever read it — so blotchiness measured off a beard
// carried the same authority as blotchiness measured off skin. The flag makes
// the judgment inside the module that computes the evidence, where it belongs,
// instead of hoping each consumer remembers to make it.
// ---------------------------------------------------------------------------

test("a face that is mostly beard, hair or mask is not a skin reading", () => {
  assert.equal(skinReliable(0.0), false);
  assert.equal(skinReliable(0.03), false);
  assert.equal(skinReliable(SKIN_COVERAGE_MIN - 0.001), false);
});

test("an ordinary unobstructed face is", () => {
  // A clean face samples roughly 0.25-0.35 of its box after the eye, brow and
  // lip holes are cut, so the floor must sit well below that.
  assert.equal(skinReliable(SKIN_COVERAGE_MIN), true);
  assert.equal(skinReliable(0.25), true);
  assert.equal(skinReliable(0.35), true);
});

test("the floor stays between 'nothing' and 'a normal face'", () => {
  // Guards the constant: above ~0.15 it starts rejecting real bearded faces
  // whose visible cheeks and forehead are perfectly measurable; at zero the
  // flag is decoration.
  assert.ok(SKIN_COVERAGE_MIN > 0.02, `${SKIN_COVERAGE_MIN} would never fire`);
  assert.ok(SKIN_COVERAGE_MIN <= 0.15, `${SKIN_COVERAGE_MIN} rejects real faces`);
});
