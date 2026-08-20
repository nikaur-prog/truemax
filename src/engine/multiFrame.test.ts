import test from "node:test";
import assert from "node:assert/strict";
import { medianMeasurements } from "./scoring.js";

// Deterministic noise. A flaky statistical test is worse than no test.
function lcg(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}
// Box-Muller from a uniform source, so the noise is actually Gaussian rather
// than uniform — the reliability arithmetic this feature rests on assumes it.
function gauss(rnd: () => number): number {
  const u = Math.max(1e-9, rnd());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

const TRUTH = { canthalTilt: 6.0, fwhr: 1.9, midfaceRatio: 0.97, lipRatio: 1.6 };
const IDS = Object.keys(TRUTH) as Array<keyof typeof TRUTH>;

function frames(n: number, sd: number, rnd: () => number): Array<Record<string, number>> {
  return Array.from({ length: n }, () => {
    const f: Record<string, number> = {};
    for (const id of IDS) f[id] = TRUTH[id] + gauss(rnd) * sd;
    return f;
  });
}

const err = (r: Record<string, number>) =>
  Math.sqrt(IDS.reduce((s, id) => s + (r[id] - TRUTH[id]) ** 2, 0) / IDS.length);

test("more frames land closer to the truth", () => {
  // The entire premise: reliability is 1 - within/population variance, and
  // combining k independent frames divides the within-person variance by k.
  // 0.35 at one frame, 0.78 at three, 0.87 at five.
  const rnd = lcg(7);
  const TRIALS = 400;
  const meanErr = (n: number) => {
    let total = 0;
    for (let t = 0; t < TRIALS; t++) total += err(medianMeasurements(frames(n, 0.4, rnd)));
    return total / TRIALS;
  };
  const one = meanErr(1);
  const three = meanErr(3);
  const five = meanErr(5);
  assert.ok(three < one * 0.9, `three frames should beat one: ${three.toFixed(4)} vs ${one.toFixed(4)}`);
  assert.ok(five < three, `five should beat three: ${five.toFixed(4)} vs ${three.toFixed(4)}`);
});

test("one wild frame does not move the answer", () => {
  // Median rather than mean, so a frame caught mid-blink or mid-turn is
  // discarded outright instead of dragging the result toward itself.
  const good = frames(4, 0.05, lcg(11));
  const wild: Record<string, number> = {};
  for (const id of IDS) wild[id] = TRUTH[id] * 4;
  const withWild = medianMeasurements([...good, wild]);
  assert.ok(err(withWild) < 0.2, `an outlier frame moved the median: ${err(withWild).toFixed(3)}`);

  // The same set averaged instead would be dragged badly off — this is what
  // the median is buying, stated as a number rather than as a claim.
  const meanOf = (id: string) => [...good, wild].reduce((s, r) => s + r[id], 0) / 5;
  const dragged = Math.sqrt(IDS.reduce((s, id) => s + (meanOf(id) - TRUTH[id]) ** 2, 0) / IDS.length);
  assert.ok(dragged > err(withWild) * 3, "the outlier was not extreme enough to prove anything");
});

test("a metric missing from one frame still uses the others", () => {
  // Per metric independently: a refused hairline read costs that measurement on
  // that frame, not the whole frame.
  const merged = medianMeasurements([
    { canthalTilt: 6.0, foreheadRatio: 0.30 },
    { canthalTilt: 6.2, foreheadRatio: Number.NaN },
    { canthalTilt: 5.8, foreheadRatio: 0.32 },
  ]);
  assert.equal(merged.canthalTilt, 6.0);
  assert.equal(merged.foreheadRatio, 0.31);
});

test("a metric missing from every frame stays missing rather than becoming zero", () => {
  // Downstream treats non-finite as "not measured" and zero as a real reading.
  // Turning one into the other here would be silent and wrong.
  const merged = medianMeasurements([
    { foreheadRatio: Number.NaN },
    { foreheadRatio: Number.NaN },
  ]);
  assert.ok(!Number.isFinite(merged.foreheadRatio));
});
