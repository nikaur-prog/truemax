import test from "node:test";
import assert from "node:assert/strict";
import { basicScores, verdictFor, verdictForPercentile } from "./analysisMode.ts";
import type { VerdictTone } from "./analysisMode.ts";
import type { Report } from "./types.ts";

const report = (over: Partial<Report> = {}): Report =>
  ({
    sex: "male",
    overall: 5,
    overallPercentile: 50,
    overallZ: 0,
    potential: 6,
    pillars: { Harmony: 5, Angularity: 5, Dimorphism: 5, Features: 5 },
    regions: [],
    metrics: [],
    zScores: {},
    ...over,
  }) as Report;

test("the ladder has a defined floor and nothing below it", () => {
  // The bottom of the scale is the one place this product could do real harm.
  for (const pct of [0, 1, 5, 11.9]) {
    assert.equal(verdictFor(report({ overallPercentile: pct })).word, "You're cooked", `${pct}`);
  }
});

test("each rung starts exactly where it says it does", () => {
  const at = (pct: number) => verdictFor(report({ overallPercentile: pct })).word;
  assert.equal(at(11.9), "You're cooked");
  assert.equal(at(12), "Chopped");
  assert.equal(at(25.9), "Chopped");
  assert.ok(["Mildly chopped", "Rough"].includes(at(26)));
  assert.ok(["Mid", "NPC", "Background character"].includes(at(40)));
  assert.ok(["Aight", "Decent", "Solid"].includes(at(52)));
  assert.ok(["Good looking", "Attractive", "Sharp"].includes(at(65)));
  assert.ok(["Mogger", "Marlon level"].includes(at(82)));
  assert.equal(at(95), "Looksmaxxing final boss");
  assert.equal(at(98.9), "Looksmaxxing final boss");
  assert.equal(at(99), "True Adam");
  assert.equal(at(100), "True Adam");
});

test("the top rungs speak to the reference population", () => {
  const at = (pct: number, sex: "male" | "female") =>
    verdictFor(report({ overallPercentile: pct, sex })).word;
  assert.ok(["She-mogger", "Fine shyt"].includes(at(85, "female")));
  assert.equal(at(97, "female"), "Certified baddie");
  assert.equal(at(99.5, "female"), "True Eve");
  // A woman must never be handed the men's word, and the reverse.
  assert.ok(!["Mogger", "True Adam"].includes(at(85, "female")));
  assert.ok(!["She-mogger", "Certified baddie", "True Eve"].includes(at(97, "male")));
});

test("one face always gets one verdict", () => {
  // The alternates are derived from the percentile, never randomised. A verdict
  // that changes when you press the button again is not a measurement.
  for (const pct of [83, 85.5, 96, 99.9]) {
    const first = verdictFor(report({ overallPercentile: pct })).word;
    for (let i = 0; i < 20; i++) {
      assert.equal(verdictFor(report({ overallPercentile: pct })).word, first, `${pct}`);
    }
  }
});

test("no rung claims to measure body weight", () => {
  // This engine measures a face. A word about body fat would be a fabrication
  // dressed as a measurement, whichever way it was meant.
  const banned = /whale|fat|obese|lard/i;
  for (const sex of ["male", "female"] as const) {
    for (let pct = 0; pct <= 100; pct += 0.5) {
      const v = verdictFor(report({ overallPercentile: pct, sex }));
      assert.ok(!banned.test(v.word), `${sex} ${pct}: ${v.word}`);
    }
  }
});

test("no verdict word dehumanises the person reading it", () => {
  // Guards the product rule directly, so that re-adding a rung below Chopped is
  // a failing test rather than a quiet commit.
  const banned = /subhuman|worthless|hopeless|ugly|deformed|incel/i;
  for (let pct = 0; pct <= 100; pct += 0.5) {
    const v = verdictFor(report({ overallPercentile: pct }));
    assert.ok(!banned.test(v.word), `word at ${pct}: ${v.word}`);
    assert.ok(!banned.test(v.line), `line at ${pct}: ${v.line}`);
  }
});

test("basic mode names the dimorphism score for the reference population", () => {
  const male = basicScores(report()).map((s) => s.label);
  const female = basicScores(report({ sex: "female" })).map((s) => s.label);
  assert.ok(male.includes("Masculinity"));
  assert.ok(female.includes("Femininity"));
  assert.ok(!female.includes("Masculinity"));
});

test("basic scores stay inside 0-100", () => {
  // Pillars are 0-10 and percentiles are 0-100; a mix-up would print 500/100.
  for (const pillars of [0, 5, 10]) {
    const scores = basicScores(
      report({ pillars: { Harmony: pillars, Angularity: pillars, Dimorphism: pillars, Features: pillars } }),
    );
    for (const s of scores) {
      assert.ok(s.value >= 0 && s.value <= 100, `${s.label}=${s.value}`);
    }
  }
});

test("every mode reads the same underlying score", () => {
  // The invariant the whole feature rests on: change the report, and every mode
  // moves together. If these ever disagree, the app is showing one face two
  // different answers.
  const strong = report({ overallPercentile: 91, pillars: { Harmony: 9, Angularity: 9, Dimorphism: 9, Features: 9 } });
  assert.ok(["Mogger", "Marlon level"].includes(verdictFor(strong).word));
  assert.equal(basicScores(strong)[0].value, 91);
});

test("the percentile entry point agrees with the report entry point", () => {
  // The MP4 exporter renders from a percentile and has no Report. It used to
  // carry its own copy of the bands, which is how a reel and the app end up
  // calling the same face two different things. Both now come through here, and
  // this asserts they cannot separate.
  for (let pct = 0; pct <= 100; pct += 0.5) {
    assert.equal(
      verdictForPercentile(pct).word,
      verdictFor(report({ overallPercentile: pct })).word,
      `${pct}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Tone
// ---------------------------------------------------------------------------

test("kind mode softens the bands that sting and leaves the rest alone", () => {
  const at = (pct: number, tone: VerdictTone) =>
    verdictForPercentile(pct, "male", tone).word;
  // Bottom five rungs get a softer word.
  for (const pct of [5, 18, 30, 45, 58]) {
    assert.notEqual(at(pct, "kind"), at(pct, "blunt"), `${pct}`);
  }
  // The top four are already good news; softening them would be talking down
  // to somebody who just got a good result.
  for (const pct of [70, 88, 96, 99.5]) {
    assert.equal(at(pct, "kind"), at(pct, "blunt"), `${pct}`);
  }
});

test("kind mode never uses the harsh vocabulary", () => {
  const banned = /cooked|chopped|npc|rough|background character/i;
  for (const sex of ["male", "female"] as const) {
    for (let pct = 0; pct <= 100; pct += 0.5) {
      const word = verdictForPercentile(pct, sex, "kind").word;
      assert.ok(!banned.test(word), `${sex} ${pct}: ${word}`);
    }
  }
});

test("tone changes the label and never the measurement", () => {
  // The whole feature rests on this. A supportive mode that quietly inflated
  // the score would be the same lie as a harsh one that deflated it.
  for (let pct = 0; pct <= 100; pct += 2.5) {
    const blunt = verdictForPercentile(pct, "male", "blunt");
    const kind = verdictForPercentile(pct, "male", "kind");
    assert.equal(blunt.tone, kind.tone, `tone band at ${pct}`);
    assert.equal(blunt.line, kind.line, `explanation at ${pct}`);
  }
});

test("blunt is the default, so an unasked caller gets the real ladder", () => {
  assert.equal(verdictForPercentile(5).word, "You're cooked");
  assert.equal(verdictForPercentile(5, "male").word, "You're cooked");
});
