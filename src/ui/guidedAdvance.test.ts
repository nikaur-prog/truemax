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
  assert.equal(a.view().text, `Next point: ${SIDE_POINTS[1].label} »`);

  assert.equal(a.press(), "advance");
});

test("moving the point IS the answer — one press advances", () => {
  const a = new GuidedAdvance();
  a.step(0, TOTAL, false);
  a.step(0, TOTAL, true); // the point was dragged
  assert.equal(a.view().ready, true);
  assert.equal(a.view().text, `Next point: ${SIDE_POINTS[1].label} »`);
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
  assert.equal(a.view().text, "Finish »");
  // And the unmoved path reaches the same place through the question.
  const b = new GuidedAdvance();
  b.step(TOTAL - 1, TOTAL, false);
  assert.equal(b.view().text, "In the right spot?");
  b.press();
  assert.equal(b.view().text, "Finish »");
});

test("every step but the last names a real landmark", () => {
  for (let i = 0; i < TOTAL - 1; i++) {
    const a = new GuidedAdvance();
    a.step(i, TOTAL, true);
    assert.equal(a.view().text, `Next point: ${SIDE_POINTS[i + 1].label} »`);
    assert.ok(SIDE_POINTS[i + 1].label.length > 0);
  }
});

test("a drag replaces the question with the busy dots", () => {
  // Mid-drag is the one moment "in the right spot?" is guaranteed to be wrong,
  // and a button that looks pressable under a finger already doing something
  // invites a second thumb.
  const a = new GuidedAdvance();
  a.step(0, TOTAL, false);
  a.setDragging(true);
  assert.equal(a.view().busy, true);
  assert.equal(a.view().ready, false);
  assert.equal(a.view().text, "", "a busy button carries no label to misread");
});

test("letting go of a dragged point leaves it answered and advancing", () => {
  const a = new GuidedAdvance();
  a.step(0, TOTAL, false);
  a.setDragging(true);
  a.step(0, TOTAL, true); // the drag moved it
  a.setDragging(false);
  const v = a.view();
  assert.equal(v.busy, false);
  assert.equal(v.ready, true);
  assert.equal(v.text, `Next point: ${SIDE_POINTS[1].label} »`);
  assert.equal(a.answered(), true);
});

test("a press cannot slip through mid-drag", () => {
  const a = new GuidedAdvance();
  a.step(2, TOTAL, true); // already answered, so a press would normally advance
  a.setDragging(true);
  assert.equal(a.press(), "confirm", "must not advance while a finger is down");
});

test("answered() tracks what turns the marker green", () => {
  const a = new GuidedAdvance();
  a.step(0, TOTAL, false);
  assert.equal(a.answered(), false);
  a.press();
  assert.equal(a.answered(), true, "confirming answers it");
  const b = new GuidedAdvance();
  b.step(0, TOTAL, true);
  assert.equal(b.answered(), true, "moving answers it");
  b.step(1, TOTAL, false);
  assert.equal(b.answered(), false, "a new step is unanswered again");
});

test("every label the button can show is either empty or ends in a chevron", () => {
  // The chevron is what says "this is the way onward". A label that loses it
  // reads as a statement about the point instead of a control.
  const a = new GuidedAdvance();
  for (let i = 0; i < TOTAL; i++) {
    a.step(i, TOTAL, true);
    assert.match(a.view().text, /»$/, `step ${i} lost its chevron`);
  }
});
