import assert from "node:assert/strict";
import test from "node:test";
import { createCalibrationCaptureChoice } from "./calibrationCaptureChoice.js";

test("each new unpaired capture starts without the previous person's reference choice", () => {
  const choice = createCalibrationCaptureChoice();
  const first = choice.begin();
  assert.equal(choice.read(first), null);
  assert.equal(choice.choose(first, "female"), true);
  assert.equal(choice.read(first), "female");
  const second = choice.begin();
  assert.equal(choice.read(second), null);
  assert.equal(choice.read(first), null);
  assert.equal(choice.choose(first, "female"), false, "a stale chooser cannot select for the next file");
  choice.choose(second, "male");
  assert.equal(choice.read(second), "male");
});

test("cancel and back invalidate both selected and outstanding choices", () => {
  const choice = createCalibrationCaptureChoice();
  const cancelled = choice.begin();
  choice.choose(cancelled, "female");
  choice.cancel();
  assert.equal(choice.read(), null);
  assert.equal(choice.current(cancelled), false);
  assert.equal(choice.choose(cancelled, "male"), false);
  assert.equal(choice.read(choice.begin()), null);
});

test("a paired capture uses the pending face's explicit reference, not an earlier attempt", () => {
  const choice = createCalibrationCaptureChoice();
  choice.choose(choice.begin(), "male");
  const paired = choice.begin("female");
  assert.equal(choice.read(paired), "female");
  choice.cancel();
  assert.equal(choice.read(choice.begin("female")), "female", "cancelling an attempt does not mutate its pending pair");
  assert.equal(choice.read(choice.begin()), null, "the next person still has no default");
});
