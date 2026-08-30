import test from "node:test";
import assert from "node:assert/strict";
import { createAutoCapture } from "./autoCapture.js";

// A countdown that restarts on every wobble never completes. Reported from a
// real run: three, four, five restarts before a photo landed, with nothing on
// screen saying why. Every blocking gate is a live measurement of a moving
// person, so on a hand-held phone something dips every second or so.

// requestAnimationFrame and performance.now do not exist in node, and the
// point of these tests is to control time rather than wait for it.
let now = 0;
const frames: Array<(t: number) => void> = [];
(globalThis as unknown as { performance: { now(): number } }).performance = { now: () => now };
(globalThis as unknown as { requestAnimationFrame: (cb: (t: number) => void) => number })
  .requestAnimationFrame = (cb) => frames.push(cb);
(globalThis as unknown as { cancelAnimationFrame: (id: number) => void })
  .cancelAnimationFrame = () => {};
(globalThis as unknown as { AudioContext?: unknown }).AudioContext = undefined;

/** Advance the clock and run whatever frame callback is pending. */
function advance(ms: number): void {
  now += ms;
  const pending = frames.splice(0, frames.length);
  for (const cb of pending) cb(now);
}

function harness(seconds = 1.5) {
  // NOT zero. performance.now() is time since page load and the module treats
  // startedAt as falsy-means-idle, so a clock that begins at 0 would make the
  // very first tick look like "not counting". A real browser opens the camera
  // long after load, so this is a harness detail rather than a product one.
  now = 1000;
  frames.length = 0;
  let fired = 0;
  const ticks: (number | null)[] = [];
  const auto = createAutoCapture({
    seconds,
    onTick: (r) => ticks.push(r),
    onFire: () => { fired++; },
  });
  return { auto, ticks, fired: () => fired };
}

test("a clean run fires after the full countdown", () => {
  const h = harness(1.5);
  h.auto.update(true);
  for (let i = 0; i < 10; i++) advance(200);
  assert.equal(h.fired(), 1);
});

test("a wobble costs the wobble, not the whole countdown", () => {
  const h = harness(1.5);
  h.auto.update(true);
  advance(1000); // 1.0s banked, 0.5s to go

  // Something dips: four frames to trip the grace, then held bad for 600ms.
  for (let i = 0; i < 4; i++) h.auto.update(false);
  now += 600;
  h.auto.update(false);

  // Back to good. The remaining 0.5s should still be 0.5s, not 1.5s.
  h.auto.update(true);
  advance(400);
  assert.equal(h.fired(), 0, "not yet: about 0.1s of the original count remains");
  advance(200);
  assert.equal(h.fired(), 1, "fires on the ORIGINAL remainder, not a restarted one");
});

test("three wobbles still complete, where a reset rule would never", () => {
  const h = harness(1.5);
  h.auto.update(true);
  for (let wobble = 0; wobble < 3; wobble++) {
    advance(400);
    for (let i = 0; i < 4; i++) h.auto.update(false);
    now += 300;
    h.auto.update(false);
    h.auto.update(true);
  }
  advance(600);
  assert.equal(h.fired(), 1);
});

test("the shutter never fires while the frame is bad", () => {
  const h = harness(1.5);
  h.auto.update(true);
  advance(1400); // 0.1s left
  for (let i = 0; i < 4; i++) h.auto.update(false);
  // Time passes with the frame still bad. Nothing may fire.
  now += 2000;
  h.auto.update(false);
  assert.equal(h.fired(), 0, "a paused timer cannot reach zero");
});

test("a long absence abandons the count rather than resuming it", () => {
  const h = harness(1.5);
  h.auto.update(true);
  advance(1400);
  for (let i = 0; i < 4; i++) h.auto.update(false);
  // Phone put down, person leaves frame.
  now += 5000;
  h.auto.update(false);
  assert.equal(h.ticks[h.ticks.length - 1], null, "the ring clears");
  // Coming back starts a fresh count, so it cannot fire the instant they return.
  h.auto.update(true);
  advance(100);
  assert.equal(h.fired(), 0);
  advance(1500);
  assert.equal(h.fired(), 1);
});

test("a single bad frame does not even pause it", () => {
  // The hint text has this hysteresis already; the countdown needs the same or
  // one dropped frame stalls a count that is about to complete.
  const h = harness(1.5);
  h.auto.update(true);
  advance(1000);
  h.auto.update(false);
  h.auto.update(true);
  advance(600);
  assert.equal(h.fired(), 1);
});

test("cancel forgets everything", () => {
  const h = harness(1.5);
  h.auto.update(true);
  advance(1000);
  h.auto.cancel();
  assert.equal(h.auto.armed(), false);
  h.auto.update(true);
  advance(600);
  assert.equal(h.fired(), 0, "a cancelled count starts from the top");
});
