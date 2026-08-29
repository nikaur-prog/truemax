import test from "node:test";
import assert from "node:assert/strict";
import { CTA_BEATS, CTA_SECONDS } from "./ctaSeries.js";

// The CTA is one fixed piece of film. These tests pin the properties that
// make it usable as one: the beats tile the runtime exactly, in script order,
// so a VO recorded against the published beat map can never drift out from
// under the visuals in a later edit.

test("the beats tile the full runtime with no gaps and no overlaps", () => {
  assert.equal(CTA_BEATS[0].start, 0);
  for (let i = 1; i < CTA_BEATS.length; i++) {
    assert.equal(CTA_BEATS[i].start, CTA_BEATS[i - 1].end, `gap before ${CTA_BEATS[i].id}`);
  }
  assert.equal(CTA_BEATS[CTA_BEATS.length - 1].end, CTA_SECONDS);
});

test("the beats follow the script order", () => {
  // The VO reads: analysis → breakdown → coach → confident self → recs →
  // weekly tracking → link in bio → search. A reorder here is a re-shoot.
  assert.deepEqual(
    CTA_BEATS.map((b) => b.id),
    ["score", "measure", "coach", "confident", "recs", "progress", "linkbio", "search"],
  );
});

test("every beat is long enough to read", () => {
  for (const b of CTA_BEATS) {
    assert.ok(b.end - b.start >= 1.5, `${b.id} is ${(b.end - b.start).toFixed(1)}s — a flash, not a beat`);
  }
});

// --- the eight-week trend on the progress beat ------------------------------
//
// The line was reported as not smooth, and the cause was that it advanced a
// whole week at a time: the draw admitted a new point only when steps*grow
// crossed an integer, and the head marker took its height from
// WEEK_TREND[floor(...)] while its x moved continuously, so it slid along flat
// and then snapped up. These pin the interpolator that replaced it.

test("the trend is continuous, so the line never jumps a week", async () => {
  const { weekTrendAt, WEEK_TREND } = await import("./ctaSeries2.js");
  const steps = WEEK_TREND.length - 1;
  let prev = weekTrendAt(0);
  let biggest = 0;
  for (let f = 0; f <= steps; f += 0.05) {
    const v = weekTrendAt(f);
    biggest = Math.max(biggest, Math.abs(v - prev));
    prev = v;
  }
  // The largest single-week rise is 0.2 (week 7 to 8). Sampled twenty times a
  // week, no step may be anywhere near that: a jump would mean the stutter is
  // back.
  assert.ok(biggest < 0.02, `a sample moved the trend by ${biggest}`);
});

test("the trend still passes through its own weekly values", async () => {
  const { weekTrendAt, WEEK_TREND } = await import("./ctaSeries2.js");
  // Smoothing the draw must not move the shape: the chart is a claim about
  // eight weeks and the weeks are where the claim lives.
  WEEK_TREND.forEach((want, week) => {
    assert.ok(Math.abs(weekTrendAt(week) - want) < 1e-9, `week ${week}`);
  });
});

test("the trend is clamped outside its own range", async () => {
  const { weekTrendAt } = await import("./ctaSeries2.js");
  assert.equal(weekTrendAt(-3), 0);
  assert.equal(weekTrendAt(99), 1);
});
