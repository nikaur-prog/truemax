import test from "node:test";
import assert from "node:assert/strict";
import { SHRINK, aggregateScoreToPercentile, phi } from "./scoring.js";
import { NOISE } from "./followUp.js";

// ---------------------------------------------------------------------------
// Measurement-noise shrinkage.
//
// A single capture is a noisy reading, and the noise on this scale is measured:
// two photographs of one unchanged face differ with an SD of 1.32 points, so a
// single reading carries ~0.72 sigma of noise. Crucially that noise is not
// neutral — scoring penalises deviation from ideal in BOTH directions, so noise
// can only push a score DOWN. Live testing found the consequence: a room of
// ordinary, decent-looking people all landing mid-3s, which is not what a
// median-anchored scale should say about a median room.
//
// The fix is the textbook estimate of a true value from one noisy reading:
// shrink toward the population centre by var(true)/(var(true)+var(noise)).
// These tests pin the properties that make it honest rather than flattering.
// ---------------------------------------------------------------------------

// The display path, inverted: what percentile does this score claim to be.
const pct = (score: number) => aggregateScoreToPercentile(score);

test("the median is exactly untouched", () => {
  // Shrinking toward the centre must not MOVE the centre. 5.0 stays the 50th
  // percentile, which is the anchor the whole scale is defined by.
  assert.ok(Math.abs(pct(5.0) - 50) < 1.5, `5.0 reads as ${pct(5.0)}`);
});

test("the scale stays monotonic after shrinking", () => {
  // A higher score must always mean a higher percentile. A shrink applied in
  // the wrong place — after the soft floor instead of before it — could fold
  // the curve back on itself, and nothing else here would notice.
  let previous = -1;
  for (let s = 3.3; s <= 9.5; s += 0.1) {
    const p = pct(s);
    assert.ok(p >= previous, `${s.toFixed(1)} -> ${p} went backwards from ${previous}`);
    previous = p;
  }
});

test("both tails compress toward the middle, not just the bottom", () => {
  // The honesty condition, and the answer to "does this pull attractive people
  // down too". Yes — symmetrically, and on purpose. A single webcam photo can
  // no more prove "top 1%" than it can prove "bottom 10%", so a scale that
  // lifted the floor and left the ceiling alone would not be a noise
  // correction, it would be grade inflation wearing one.
  //
  // Walks the FORWARD path a real face takes — true population percentile, to
  // shrunk z, to displayed score — rather than the display inverse, which maps
  // score to percentile after the shrink and so cannot see it.
  const probit = (p: number): number => {
    let lo = -6;
    let hi = 6;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (phi(mid) < p) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const scoreAtDisplayPct = (target: number): number => {
    let lo = 0.5;
    let hi = 9.9;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (aggregateScoreToPercentile(mid) < target) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  // Where a face at true population percentile P now displays.
  const scoreAtTruePct = (p: number) => scoreAtDisplayPct(phi(SHRINK * probit(p / 100)) * 100);

  // Pre-shrinkage these were 8.02 and 3.61 — one point above and 1.4 below the
  // median. Both ends must now sit closer to 5.0.
  const top = scoreAtTruePct(99);
  const bottom = scoreAtTruePct(2);
  assert.ok(top < 7.6, `99th percentile scores ${top.toFixed(2)}, ceiling did not come down`);
  assert.ok(bottom > 3.7, `2nd percentile scores ${bottom.toFixed(2)}, floor did not come up`);

  // Symmetric: neither end may move dramatically further than the other, which
  // is what would betray a one-sided thumb on the scale.
  const up = bottom - 3.61;
  const down = 8.02 - top;
  assert.ok(Math.min(up, down) > 0.15, `moved ${up.toFixed(2)} up / ${down.toFixed(2)} down`);
});

test("the noise floor moved in step with the shrink", () => {
  // The one coupling that would silently break everything: shrinking scores
  // compresses the same-face spread by the same factor, so a follow-up floor
  // left at the old 1.3 would call genuine progress "noise" forever. 1.32 x
  // 0.66 = 0.87, and NOISE is 0.9.
  assert.ok(NOISE < 1.0, `${NOISE} is the pre-shrinkage floor`);
  assert.ok(NOISE > 0.7, `${NOISE} is below the real spread and would invent progress`);
});
