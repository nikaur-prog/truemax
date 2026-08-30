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
// Sparse rather than a plain list, because the ids have to stay stable: a
// cancel has to remove the ONE callback it names, exactly as a browser does.
// This was a no-op, which is not what any browser does and is not a harmless
// simplification — a stub that never cancels cannot distinguish "the timer was
// stopped" from "the timer was asked to stop and ran anyway", which is the
// whole subject of the tests below.
const frames = new Map<number, (t: number) => void>();
let nextFrameId = 1;
(globalThis as unknown as { performance: { now(): number } }).performance = { now: () => now };
(globalThis as unknown as { requestAnimationFrame: (cb: (t: number) => void) => number })
  .requestAnimationFrame = (cb) => {
    const id = nextFrameId++;
    frames.set(id, cb);
    return id;
  };
(globalThis as unknown as { cancelAnimationFrame: (id: number) => void })
  .cancelAnimationFrame = (id) => void frames.delete(id);
(globalThis as unknown as { AudioContext?: unknown }).AudioContext = undefined;

/** Advance the clock and run whatever frame callback is pending. */
function advance(ms: number): void {
  now += ms;
  const pending = [...frames.entries()];
  frames.clear();
  for (const [, cb] of pending) cb(now);
}

function harness(seconds = 1.5) {
  // NOT zero. performance.now() is time since page load and the module treats
  // startedAt as falsy-means-idle, so a clock that begins at 0 would make the
  // very first tick look like "not counting". A real browser opens the camera
  // long after load, so this is a harness detail rather than a product one.
  now = 1000;
  frames.clear();
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

  // Something dips, and the clock stops on that frame. Held bad for 600ms.
  h.auto.update(false);
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

test("a single bad frame costs that frame and nothing more", () => {
  // This used to be titled "does not even pause it", and it passed under a
  // four-frame grace on the timer. It passes here too, and that is the point:
  // pausing on the first bad frame is CHEAP. A dip that is over by the next
  // readiness update costs the time between the two updates, which is zero
  // here and a few milliseconds on a phone. The grace bought nothing this
  // could not buy safely.
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

// THE RACE THE FOUR-FRAME GRACE LEFT OPEN.
//
// The pause used to wait for four bad frames before stopping the timer, so a
// single bad frame incremented a counter and left the animation frame
// scheduled. The count then completed and the shutter fired on framing every
// gate had already rejected — which is the one thing the pause exists to make
// impossible.
//
// The test that shipped alongside it called four update(false) in a row WITHOUT
// ADVANCING TIME, which trips the grace before any frame can run and therefore
// cannot see the race at all. Time advances here, once, exactly as it does on a
// phone.
test("ONE bad frame stops the clock, with no grace whatsoever", () => {
  const h = harness(1.5);
  h.auto.update(true);
  advance(1450); // 1.45 of 1.5 seconds banked, 50ms to go

  h.auto.update(false);
  advance(100); // more than enough to finish the count, had it still been running

  assert.equal(h.fired(), 0, "the shutter must not fire on a frame the gates rejected");
});

test("the paused count still holds its progress and completes on return", () => {
  // Pausing on the first frame must not have turned the pause into a reset:
  // the whole point is that a wobble costs the wobble.
  const h = harness(1.5);
  h.auto.update(true);
  advance(1450);
  h.auto.update(false);
  advance(100);
  assert.equal(h.fired(), 0);

  h.auto.update(true);
  advance(60); // the 50ms that were left, and a little over
  assert.equal(h.fired(), 1, "it resumes where it stopped rather than starting again");
});

test("a single dropped frame does not throw away a long count", () => {
  // The grace existed to protect against exactly this, and pausing covers it
  // without the race: one bad frame among good ones costs only itself.
  const h = harness(1.5);
  h.auto.update(true);
  advance(700);
  // Ten dips, each recovered before the next readiness update, over the 800ms
  // still owed. A reset rule would restart on every one of them and never get
  // there; pausing charges each dip only the gap it actually spans.
  for (let i = 0; i < 10; i++) {
    h.auto.update(false);
    h.auto.update(true);
    advance(100);
  }
  assert.equal(h.fired(), 1, "ten single-frame dips must not prevent a capture");
});
