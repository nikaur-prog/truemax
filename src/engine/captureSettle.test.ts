import test from "node:test";
import assert from "node:assert/strict";
import { createSettler } from "./captureSettle.js";
import type { Reading } from "./captureSettle.js";

const r = (status: Reading["status"], hint = status): Reading => ({
  status,
  hint,
  detail: `${hint} detail`,
});

test("a single stray frame never reaches the screen", () => {
  // THE test for this module. The guide runs per camera frame, so a face on
  // the boundary between two checks produces a reading that flips every frame.
  // One frame of disagreement is noise, and showing it strobes the colour and
  // resizes the box at the same time.
  const s = createSettler(6);
  s.settle(r("amber"));
  for (let i = 0; i < 40; i++) {
    const shown = s.settle(i % 2 ? r("red") : r("amber"));
    assert.equal(shown.status, "amber", `frame ${i} let a flicker through`);
  }
});

test("a reading that persists does take over", () => {
  const s = createSettler(6);
  s.settle(r("amber"));
  let shown = r("amber");
  for (let i = 0; i < 6; i++) shown = s.settle(r("red"));
  assert.equal(shown.status, "red");
});

test("green is believed at once — a held pose must not wait", () => {
  // The readiness state means the shutter is armed. Making somebody hold a
  // good pose for an extra fifth of a second before the screen admits it is
  // the one delay here that costs a photo.
  const s = createSettler(6);
  s.settle(r("red"));
  assert.equal(s.settle(r("green")).status, "green", "green was made to wait");
});

test("dropping out of green still has to repeat", () => {
  // The mirror of the rule above: one dropped frame must not yank the shutter
  // away from someone holding still.
  const s = createSettler(6);
  s.settle(r("green"));
  assert.equal(s.settle(r("red")).status, "green", "a single bad frame unarmed the shutter");
  let shown = r("green");
  for (let i = 0; i < 6; i++) shown = s.settle(r("red"));
  assert.equal(shown.status, "red", "a sustained bad pose must eventually show");
});

test("the very first reading is shown immediately", () => {
  // Otherwise every session opens with a fifth of a second of blank coaching.
  const s = createSettler(6);
  assert.equal(s.settle(r("red")).status, "red");
});

test("the hint and the status change together", () => {
  // They are one reading, not three properties. Letting the text change while
  // the colour lags is how the box resizes under a colour it no longer matches.
  const s = createSettler(3);
  s.settle({ status: "amber", hint: "Come closer", detail: "a" });
  const mid = s.settle({ status: "amber", hint: "Turn a little", detail: "b" });
  assert.equal(mid.hint, "Come closer", "text moved ahead of its own settle");
  s.settle({ status: "amber", hint: "Turn a little", detail: "b" });
  const out = s.settle({ status: "amber", hint: "Turn a little", detail: "b" });
  assert.equal(out.hint, "Turn a little");
  assert.equal(out.detail, "b");
});

test("returning to what is already shown resets the count", () => {
  // Three frames of red, back to amber, then three more red must NOT total six
  // and flip: the run has to be consecutive or a slow oscillation still wins.
  const s = createSettler(6);
  s.settle(r("amber"));
  for (let i = 0; i < 3; i++) s.settle(r("red"));
  s.settle(r("amber"));
  let shown = r("amber");
  for (let i = 0; i < 3; i++) shown = s.settle(r("red"));
  assert.equal(shown.status, "amber", "a broken run was allowed to accumulate");
});
