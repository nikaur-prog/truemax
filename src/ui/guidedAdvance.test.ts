import test from "node:test";
import assert from "node:assert/strict";
import { GuidedAdvance } from "./guidedAdvance.js";
import { SIDE_POINTS } from "../engine/sideMetrics.js";

const TOTAL = SIDE_POINTS.length;

test("an untouched point asks once, then advances", () => {
  const a = new GuidedAdvance();
  a.step(0, TOTAL, false);
  assert.equal(a.view().ready, false);
  assert.equal(a.view().text, "In the right spot?");

  assert.equal(a.press(), "confirm");
  assert.equal(a.view().ready, true);
  assert.equal(a.view().text, `Next point: ${SIDE_POINTS[1].label}`);

  assert.equal(a.press(), "advance");
});

test("moving the point IS the answer — one press advances", () => {
  const a = new GuidedAdvance();
  a.step(0, TOTAL, false);
  a.step(0, TOTAL, true); // the point was dragged
  assert.equal(a.view().ready, true);
  assert.equal(a.view().text, `Next point: ${SIDE_POINTS[1].label}`);
  assert.equal(a.press(), "advance");
});

test("a nudge after confirming does not un-confirm the step", () => {
  // The two paths must never disagree about what the button means: having
  // said "yes that's right" and then adjusting it slightly still leaves you
  // on green, not back at the question.
  const a = new GuidedAdvance();
  a.step(3, TOTAL, false);
  a.press();
  a.step(3, TOTAL, true);
  assert.equal(a.view().ready, true);
  assert.equal(a.press(), "advance");
});

test("each new step asks again, including one you go back to", () => {
  const a = new GuidedAdvance();
  a.step(0, TOTAL, false);
  a.press(); // confirmed step 0
  a.step(1, TOTAL, false);
  assert.equal(a.view().ready, false, "step 1 must ask for itself");
  a.press();
  a.step(0, TOTAL, false); // navigated back
  assert.equal(a.view().ready, false, "a revisited point is being looked at again");
});

test("the last point finishes instead of naming a next one", () => {
  const a = new GuidedAdvance();
  a.step(TOTAL - 1, TOTAL, true);
  assert.equal(a.view().text, "Finish");
  // And the unmoved path reaches the same place through the question.
  const b = new GuidedAdvance();
  b.step(TOTAL - 1, TOTAL, false);
  assert.equal(b.view().text, "In the right spot?");
  b.press();
  assert.equal(b.view().text, "Finish");
});

test("every step but the last names a real landmark", () => {
  for (let i = 0; i < TOTAL - 1; i++) {
    const a = new GuidedAdvance();
    a.step(i, TOTAL, true);
    assert.equal(a.view().text, `Next point: ${SIDE_POINTS[i + 1].label}`);
    assert.ok(SIDE_POINTS[i + 1].label.length > 0);
  }
});
