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

test("a completed countdown cannot start 2-1 again while capture is slow or rejected", () => {
  const h = harness();
  h.auto.update(true);
  advance(1600);
  for (let i = 0; i < 30; i++) {
    h.auto.update(i % 4 !== 0);
    advance(200);
  }
  assert.equal(h.fired(), 1);
  assert.deepEqual(h.ticks, [2, null]);
  assert.equal(h.auto.armed(), false);
});

test("cancel during handoff cannot re-arm the spent camera attempt", () => {
  const h = harness();
  h.auto.update(true);
  advance(800);
  advance(800);
  h.auto.cancel();
  h.auto.update(true);
  advance(2000);
  assert.equal(h.fired(), 1);
});

test("a throwing capture handoff is still spent, rather than repeating the countdown", () => {
  now = 1000;
  frames.clear();
  let calls = 0;
  const auto = createAutoCapture({ onTick() {}, onFire() { calls++; throw new Error("no frame"); } });
  auto.update(true);
  assert.throws(() => advance(1600), /no frame/);
  auto.update(true);
  advance(1600);
  assert.equal(calls, 1);
});

test("a paused countdown exposes live coaching, then resumes without restarting its number", () => {
  const h = harness();
  h.auto.update(true);
  advance(800);
  h.auto.update(false);
  assert.equal(h.auto.armed(), false);
  assert.equal(h.auto.hasProgress(), true, "paused countdown retains its framing lock");
  assert.equal(h.ticks[h.ticks.length - 1], null);
  now += 300;
  h.auto.update(true);
  assert.equal(h.auto.armed(), true);
  assert.equal(h.ticks[h.ticks.length - 1], 1);
  advance(750);
  assert.equal(h.fired(), 1);
  assert.equal(h.auto.hasProgress(), false);
  assert.equal(h.ticks.filter(tick => tick === 2).length, 1);
});

test("a brief camera stall preserves 1 even without intermediate readiness callbacks", () => {
  const h = harness();
  h.auto.update(true);
  advance(800);
  h.auto.update(false); // Camera onPause, not cancellation.
  now += 650;
  h.auto.update(true);
  assert.equal(h.ticks[h.ticks.length - 1], 1);
  assert.equal(h.ticks.filter(t => t === 2).length, 1);
  advance(710);
  assert.equal(h.fired(), 1);
});

test("a camera returning after four seconds restarts safely even if it reported its stall only once", () => {
  const h = harness();
  h.auto.update(true);
  advance(1400);
  h.auto.update(false);
  now += 4500;
  h.auto.update(true);
  assert.equal(h.ticks[h.ticks.length - 1], 2);
  advance(150);
  assert.equal(h.fired(), 0);
  advance(1400);
  assert.equal(h.fired(), 1);
});

test("identical countdown labels are not repainted on every animation frame", () => {
  const h = harness(1.5);
  h.auto.update(true);
  for (let i = 0; i < 100; i++) advance(16);
  assert.deepEqual(h.ticks, [2, 1, null]);
  assert.equal(h.fired(), 1);
});

test("a queued frame cannot fire the shutter while the page is hidden", () => {
  const h = harness(1.5);
  h.auto.update(true);
  advance(1400);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  const page = { visibilityState: "hidden" };
  Object.defineProperty(globalThis, "document", { configurable: true, value: page });
  try {
    advance(5000);
    assert.equal(h.fired(), 0);
    assert.equal(h.auto.armed(), false);
    page.visibilityState = "visible";
    h.auto.update(true);
    advance(100);
    assert.equal(h.fired(), 0, "returning needs the whole countdown again");
    advance(1500);
    assert.equal(h.fired(), 1);
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("readiness frames advance the count when animation frames are starved", () => {
  const h = harness(1.5);
  h.auto.update(true);
  // Simulate the iPhone camera/landmarker monopolising paint callbacks while
  // it continues to produce usable readiness measurements.
  now += 800;
  h.auto.update(true);
  assert.equal(h.ticks[h.ticks.length - 1], 1);
  now += 800;
  h.auto.update(true);
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

// The browser log that found this: 2 (660Hz), 1 (880Hz), then 2 and 1 again
// within 23ms, the label flipping back to "Capturing in 2". Two clocks drive the
// count: performance.now() from a camera update that lands after synchronous
// CPU inference, and requestAnimationFrame's frame-start stamp. The next
// paint's stamp can be older than that update.
// captureFeedback caches its AudioContext per page, so every recorder shares one log.
const beepLog: number[] = [];
function recordBeeps(): { hz: number[]; restore(): void } {
  const hz = beepLog;
  hz.length = 0;
  const g = globalThis as unknown as { window?: unknown };
  const previous = g.window;
  const param = () => ({ setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  class FakeAudio {
    state = "running";
    currentTime = 0;
    destination = {};
    resume() { return Promise.resolve(); }
    createGain() { return { gain: param(), connect: (d: unknown) => d, disconnect() {} }; }
    createOscillator() {
      let frequency = 0;
      return {
        type: "sine",
        frequency: { setValueAtTime: (v: number) => { frequency = v; } },
        connect: (gain: { connect(d: unknown): unknown }) => gain,
        disconnect() {},
        start: () => { hz.push(frequency); },
        stop() {},
        onended: null,
      };
    }
  }
  g.window = { AudioContext: FakeAudio };
  return { hz, restore: () => { g.window = previous; } };
}

test("an older paint stamp after a post-inference update cannot move the count or beeps backwards", () => {
  const beeps = recordBeeps();
  try {
    const h = harness(1.5);
    h.auto.update(true); // 1000: step 2
    now = 1760; // camera update after a slow synchronous detector pass
    h.auto.update(true); // step 1
    // The paint that follows carries the frame-start stamp from before the update.
    const pending = [...frames.entries()];
    frames.clear();
    for (const [, cb] of pending) cb(1740);
    for (let i = 0; i < 6; i++) advance(150);
    assert.deepEqual(h.ticks, [2, 1, null]);
    assert.deepEqual(beeps.hz, [660, 880], "exactly one soft 2, then one higher 1");
    assert.equal(h.fired(), 1);
  } finally { beeps.restore(); }
});

test("interleaved update and paint clocks only ever count down", () => {
  const beeps = recordBeeps();
  try {
    const h = harness(1.5);
    h.auto.update(true);
    // Updates run ahead of paint stamps by up to 90ms of inference, in every order.
    for (let step = 0; step < 40 && !h.fired(); step++) {
      now += 45;
      if (step % 2) h.auto.update(true);
      const pending = [...frames.entries()];
      frames.clear();
      for (const [, cb] of pending) cb(now - (step % 3) * 45);
    }
    const shown = h.ticks.filter((t): t is number => t !== null);
    for (let i = 1; i < shown.length; i++) assert.ok(shown[i] < shown[i - 1], `count went ${shown[i - 1]} -> ${shown[i]}`);
    assert.deepEqual(beeps.hz, [660, 880]);
    assert.equal(h.fired(), 1);
  } finally { beeps.restore(); }
});
