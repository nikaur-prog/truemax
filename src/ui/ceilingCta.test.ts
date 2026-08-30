import test from "node:test";
import assert from "node:assert/strict";
import { ceilingCtaMarkup } from "./ceilingCta.js";

// The module's whole reason for existing is that it refuses to render a face
// somebody has not got. These pin the claims it makes about the images it does
// render, because the copy and the pictures have to agree.

test("the ceiling never states a gap it did not compute", () => {
  const html = ceilingCtaMarkup({ overall: 5.6, potential: 7.1, photo: null });
  assert.match(html, /1\.5 points higher/);
  assert.match(html, />5\.6</);
  assert.match(html, />7\.1</);
});

test("the honesty line is present whenever the two images are", () => {
  // It is the sentence that separates this from every competitor's generated
  // after-photo, so it is not optional decoration.
  const html = ceilingCtaMarkup({ overall: 5.6, potential: 7.1, photo: null });
  assert.match(html, /your own photo, out of focus/);
  assert.match(html, /We do not generate a face you have not got/);
});

test("the block claims no rarity the reference set cannot carry", () => {
  // Built through rankShort, so the tail rules apply here as everywhere. A
  // hand-rolled percentile in a sales block is exactly where an overclaim would
  // go unnoticed.
  for (const potential of [9.9, 9.99, 10]) {
    const html = ceilingCtaMarkup({ overall: 5, potential, photo: null });
    assert.doesNotMatch(html, /1 in \d/, `potential ${potential}`);
    assert.doesNotMatch(html, /top 0%/i, `potential ${potential}`);
  }
});

test("no em dash in the ceiling copy", () => {
  assert.doesNotMatch(ceilingCtaMarkup({ overall: 5.6, potential: 7.1, photo: null }), /—/);
});
