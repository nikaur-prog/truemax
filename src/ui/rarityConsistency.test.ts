import test from "node:test";
import assert from "node:assert/strict";
import { populationLine, rarityText, scoreHigherText, topPctText } from "./templates.js";
import { oneInN, rarityPhrase } from "../engine/rarity.js";

// The two ways this app states the same fact must state the same fact.
//
// A results screen shows "Top 10%" as the headline chip and "1 in 8 faces
// measure this well" in the paragraph under it, and until these were built on
// one rule that is exactly what it did — the chip rounded to the nearest five
// and the sentence did not. Nobody reads that as rounding. They read it as the
// product not knowing its own answer.

test("rarityText is the shared rule, not a second copy of it", () => {
  assert.equal(rarityText, rarityPhrase);
});

test("the rarity phrase and the top-X% chip describe the same band", () => {
  for (let pct = 50; pct <= 98; pct += 1.3) {
    const phrase = rarityText(pct);
    const chip = topPctText(pct);
    if (phrase === "the top 1%") continue; // checked separately below
    const share = Number(/Top (\d+)%/.exec(chip)?.[1]);
    assert.ok(Number.isFinite(share), `no share parsed from "${chip}" at ${pct}`);

    // Two shapes, one claim. "1 in 10" and "10% of" both have to come out as
    // the same share the chip just printed — exactly, because a point of slack
    // here IS the contradiction this test exists to catch.
    const n = Number(/^1 in (\d+)$/.exec(phrase)?.[1]);
    const pctForm = Number(/^(\d+)% of$/.exec(phrase)?.[1]);
    const claimed = Number.isFinite(n) ? 100 / n : pctForm;
    assert.ok(Number.isFinite(claimed), `unparsed phrase "${phrase}" at ${pct}`);
    assert.equal(claimed, share, `"${phrase}" and "${chip}" disagree at percentile ${pct}`);
  }
});

test("the fraction form is only used where it lands exactly", () => {
  // The reason rarityPhrase has two shapes at all. If a change ever lets a
  // rounded fraction back in, this fails before it reaches a screen.
  assert.equal(rarityText(90), "1 in 10");
  assert.equal(rarityText(75), "1 in 4");
  assert.equal(rarityText(55), "45% of"); // "1 in 2" would claim 50%
  assert.equal(rarityText(85), "15% of"); // "1 in 7" would claim 14.3%
});

test("both stop claiming resolution at the same place", () => {
  // Past the sample's resolution the denominator is dropped rather than
  // sharpened. Whichever way it is said, it has to stop being said at the same
  // percentile, or one surface claims a precision the other just disclaimed.
  assert.equal(rarityText(99.4), "the top 1%");
  assert.equal(topPctText(99.4), "Top 1%");
  assert.equal(oneInN(99.4), 100);
});

test("no region line ever claims 100% of faces score higher", () => {
  // A rounding artefact, not a measurement. The reference set is a sample: it
  // cannot establish that literally every face scores higher, and a round 100
  // reads as a verdict rather than as the bottom of a range.
  for (let pct = 0; pct <= 100; pct += 0.1) {
    const t = scoreHigherText(pct);
    assert.doesNotMatch(t, /\b100%/, `percentile ${pct.toFixed(1)} printed ${t}`);
  }
  assert.equal(scoreHigherText(0), "more than 99%");
  assert.equal(scoreHigherText(0.4), "more than 99%");
  assert.equal(scoreHigherText(25), "75%");
});

test("rarity framing is never used to describe a below-median score", () => {
  // The phrasing is symmetric and the meaning is not. At the 1st percentile,
  // "roughly 1 in 100 male profiles measure this way" is arithmetically true
  // and reads as a compliment — it is the identical sentence the TOP 1% gets,
  // and next to a 3.6/10 it lands as though scoring badly were a distinction.
  for (let pct = 0; pct < 50; pct += 0.5) {
    const line = populationLine(pct, "male", "profiles");
    assert.doesNotMatch(line, /1 in \d/, `${pct}: rarity framing below the median — "${line}"`);
    assert.doesNotMatch(line, /measure this way/, `${pct}: still the rare-and-special sentence`);
    assert.match(line, /score higher/, `${pct}: should state the direction plainly`);
  }
});

test("above the median it still says how rare the reading is", () => {
  for (let pct = 50; pct <= 100; pct += 0.5) {
    const line = populationLine(pct, "male", "profiles");
    assert.match(line, /measure this way/, `${pct}: lost the rarity statement — "${line}"`);
  }
});

test("the two sides meet at the median without a gap or an overlap", () => {
  // Exactly one of the two forms must apply at every percentile.
  for (let pct = 0; pct <= 100; pct += 0.25) {
    const line = populationLine(pct, "female", "faces");
    const rare = /measure this way/.test(line);
    const direction = /score higher/.test(line);
    assert.ok(rare !== direction, `${pct}: produced ${rare && direction ? "both" : "neither"} form`);
  }
});

test("the population line names the reference group it is comparing against", () => {
  assert.match(populationLine(80, "male", "faces"), /male faces/);
  assert.match(populationLine(20, "female", "profiles"), /female profiles/);
});
