import test from "node:test";
import assert from "node:assert/strict";
import { countUp, easeOutCubic } from "./countUp.js";

// The module reaches for window/performance/requestAnimationFrame at call time,
// so a fake clock is enough — no DOM needed. Frames are driven by hand so the
// test asserts on the actual sequence of values rather than on a timer.
interface Harness {
  el: HTMLElement;
  frames: Array<(now: number) => void>;
  timers: Array<() => void>;
  run(steps: number, msPerStep?: number): void;
}

function harness(opts: { reduced?: boolean; connected?: boolean } = {}): Harness {
  const frames: Array<(now: number) => void> = [];
  const timers: Array<() => void> = [];
  let now = 0;
  const el = {
    textContent: "",
    isConnected: opts.connected ?? true,
  } as unknown as HTMLElement;

  const g = globalThis as Record<string, unknown>;
  g.window = { matchMedia: () => ({ matches: opts.reduced ?? false }) };
  g.performance = { now: () => now };
  g.requestAnimationFrame = (cb: (t: number) => void) => {
    frames.push(cb);
    return frames.length;
  };
  g.setTimeout = ((cb: () => void) => {
    timers.push(cb);
    return timers.length;
  }) as unknown as typeof setTimeout;

  return {
    el,
    frames,
    timers,
    run(steps, msPerStep = 100) {
      while (timers.length) timers.shift()!();
      for (let i = 0; i < steps; i++) {
        const cb = frames.shift();
        if (!cb) break;
        now += msPerStep;
        cb(now);
      }
    },
  };
}

test("the number lands exactly on its target", () => {
  // A count-up that stops at 7.3999999 has turned a measurement into a bug
  // report, so the last write is the target verbatim rather than the curve's
  // final sample.
  const h = harness();
  countUp(h.el, 7.4);
  h.run(40);
  assert.equal(h.el.textContent, "7.4");
});

test("it counts up rather than down, and never overshoots", () => {
  const h = harness();
  const seen: number[] = [];
  countUp(h.el, 8.2, { write: (t) => seen.push(Number(t)) });
  h.run(40);
  assert.ok(seen.length > 2, "no intermediate frames were drawn");
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i]! >= seen[i - 1]!, `went backwards: ${seen[i - 1]} then ${seen[i]}`);
  }
  assert.ok(Math.max(...seen) <= 8.2, "overshot the target");
  assert.equal(seen[seen.length - 1], 8.2);
});

test("reduced motion jumps straight to the value and draws no frames", () => {
  // The global CSS reduced-motion rule kills transitions but cannot touch a
  // requestAnimationFrame tween, so this guard is the only thing standing
  // between that preference and a number ticking anyway.
  const h = harness({ reduced: true });
  countUp(h.el, 5.5, { delay: 400 });
  assert.equal(h.el.textContent, "5.5", "did not settle immediately");
  assert.equal(h.frames.length, 0, "scheduled animation frames anyway");
  assert.equal(h.timers.length, 0, "scheduled a delay anyway");
});

test("it stops when the element leaves the document", () => {
  const h = harness({ connected: false });
  let writes = 0;
  countUp(h.el, 9, { write: () => writes++ });
  h.run(20);
  assert.equal(writes, 0, "kept writing into a detached element");
});

test("a custom writer is used instead of textContent", () => {
  // The dashboard hero carries a "/10" in a sibling node that writing
  // textContent would delete, so it hands in its own writer.
  const h = harness();
  const written: string[] = [];
  countUp(h.el, 6.1, { write: (t) => written.push(t) });
  h.run(40);
  assert.ok(written.length > 0);
  assert.equal(h.el.textContent, "", "wrote to textContent despite a custom writer");
  assert.equal(written[written.length - 1], "6.1");
});

test("decimals are honoured", () => {
  const h = harness();
  countUp(h.el, 42, { decimals: 0 });
  h.run(40);
  assert.equal(h.el.textContent, "42");
});

test("a delay holds the count until the timer fires", () => {
  const h = harness();
  countUp(h.el, 5, { delay: 420 });
  assert.equal(h.frames.length, 0, "started counting before its delay");
  assert.equal(h.timers.length, 1);
  h.run(40);
  assert.equal(h.el.textContent, "5.0");
});

test("the easing starts fast and settles", () => {
  // Cubic ease-out is the house curve — every count-up in the app used it
  // before this module existed, and the reason is that a linear counter reads
  // as a slot machine while this one reads as an instrument settling.
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.ok(easeOutCubic(0.5) > 0.5, "not front-loaded");
  const early = easeOutCubic(0.2) - easeOutCubic(0.1);
  const late = easeOutCubic(1) - easeOutCubic(0.9);
  assert.ok(early > late, "does not decelerate");
});
