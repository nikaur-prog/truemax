import test from "node:test";
import assert from "node:assert/strict";
import { LADDER, SPREAD, oneInN, rarityLine, rarityShort, scoreAtPercentile, spreadLine } from "./rarity.js";
import { aggregateScoreToPercentile } from "./scoring.js";

test("scoreAtPercentile inverts the display curve", () => {
  for (const score of [4.0, 4.5, 5.0, 6.0, 6.5, 7.0, 7.6]) {
    const back = scoreAtPercentile(aggregateScoreToPercentile(score));
    assert.ok(Math.abs(back - score) <= 0.1, `${score} round-tripped to ${back}`);
  }
});

test("the median of the scale is 5.0 by construction", () => {
  // aggNorm.ts builds the tables so this holds. If it ever stops holding, the
  // reference tables were regenerated wrong and every percentile in the app is
  // off — which is worth a failing test far more than it is worth this module.
  assert.equal(SPREAD.median, 5);
});

test("the stated spread is tight, and that is the point", () => {
  // The whole offence problem is that this band is narrow: a reader assumes a
  // ten-point scale spreads people across it, and it does not. If a change ever
  // widens this past three points the explainer copy stops being true.
  assert.ok(SPREAD.low > 3.5 && SPREAD.low < 4.5, `low ${SPREAD.low}`);
  assert.ok(SPREAD.high > 6 && SPREAD.high < 6.8, `high ${SPREAD.high}`);
  assert.ok(SPREAD.high - SPREAD.low < 3, `span ${SPREAD.high - SPREAD.low}`);
});

test("rarity is computed off the stated percentile, not the raw one", () => {
  // 87.6 states as 90, so the rarity must read 1 in 10 and not 1 in 8. Quoting
  // a rarity the shown percentile does not support is the product contradicting
  // its own rounding on one screen.
  assert.equal(oneInN(87.6), 10);
  assert.equal(oneInN(93.8), 20);
});

test("rarity is symmetric about the median", () => {
  // Same construction both sides: no congratulating the top half and no
  // commiserating with the bottom half.
  assert.match(rarityLine(90), /1 in 10 measure this high/);
  assert.match(rarityLine(10), /1 in 10 measure this low/);
});

test("rarity never claims a certainty of one", () => {
  // statedPct clamps to 1-99, but a raw 100 or a NaN must not produce "1 in 1",
  // which would read as "everybody" and is never what was measured.
  for (const p of [100, 99.99, 0, -3, Number.NaN]) {
    assert.ok(oneInN(p) >= 2, `${p} gave 1 in ${oneInN(p)}`);
  }
});

test("the ladder gets steeper going up and is strictly ordered", () => {
  for (let i = 1; i < LADDER.length; i++) {
    assert.ok(
      LADDER[i].oneIn > LADDER[i - 1].oneIn,
      `${LADDER[i].score} (1 in ${LADDER[i].oneIn}) not rarer than ${LADDER[i - 1].score}`,
    );
  }
});

test("the ladder stops claiming counts where the sample runs out", () => {
  // The rung at the top must be flagged as a bound, not a count. On the raw
  // curve an 8 is about 1 in 91 and a 9 about 1 in 1000, but statedPct clamps
  // at 99, so anything up there can only honestly be called "rarer than 1 in
  // 100". A ladder that printed "1 in 1000" would be claiming three digits of
  // resolution off roughly a hundred reference faces.
  const top = LADDER[LADDER.length - 1];
  assert.ok(top.capped, `top rung ${top.score} should be capped`);
  assert.equal(top.oneIn, 100);
  // Everything below it is a real count and must not be flagged.
  for (const rung of LADDER.slice(0, -1)) {
    assert.ok(!rung.capped, `${rung.score} should not be capped`);
  }
});

test("the compact form uses a fraction only where it lands exactly", () => {
  // The punchy form on the values worth being punchy about...
  assert.equal(rarityShort(78), "1 in 5"); // top 20%
  assert.equal(rarityShort(90), "1 in 10");
  assert.equal(rarityShort(76), "1 in 4"); // top 25%
  // ...and the percentage where a fraction would misstate it. "1 in 7" claims
  // 14.3% while the number printed beside it says 15%.
  assert.equal(rarityShort(85), "Top 15%");
  assert.equal(rarityShort(62), "Top 40%");
});

test("the compact form never dresses a below-median score as an achievement", () => {
  // "1 in 3" in a grid cell reads as a distinction. Below the median the cell
  // has no room for the qualifier that would stop it being one, so it stays a
  // percentage — the same wording rankShort has always used down there.
  for (const pct of [5, 18, 30, 44, 47]) {
    assert.match(rarityShort(pct), /^Ahead of \d+%$/, `${pct} gave ${rarityShort(pct)}`);
  }
});

test("the median edge is decided by the stated percentile, not the raw one", () => {
  // 49 rounds to a stated 50, so it IS the median on screen and "1 in 2" is the
  // honest reading of it. Splitting on the raw value instead would print
  // "Ahead of 50%" beside a number the same screen just rounded to 50.
  assert.equal(rarityShort(49), "1 in 2");
  assert.equal(rarityShort(47), "Ahead of 45%");
});

test("the compact form stops at the resolution cap like everything else", () => {
  assert.equal(rarityShort(99.6), "Top 1%");
  assert.equal(rarityShort(100), "Top 1%");
});

test("the spread line names the right population", () => {
  assert.match(spreadLine("male"), /Two thirds of men measure between/);
  assert.match(spreadLine("female"), /Two thirds of women measure between/);
});
