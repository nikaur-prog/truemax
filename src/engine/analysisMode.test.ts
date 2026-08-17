import test from "node:test";
import assert from "node:assert/strict";
import { basicScores, verdictFor, verdictForPercentile } from "./analysisMode.js";
import type { VerdictTone } from "./analysisMode.js";
import type { Report } from "./types.js";
import { statedPct } from "./precision.js";

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
  // The bottom-fifth rung carries alternates now, like every rung above it, so
  // two friends who land in the same band do not read the same word. What this
  // test is about is the BOUNDARY, so both ends of the band assert the band.
  assert.ok(["Chopped", "Undercooked", "Raw"].includes(at(12)));
  assert.ok(["Chopped", "Undercooked", "Raw"].includes(at(25.9)));
  assert.ok(["Mildly chopped", "Rough", "Half baked", "Unfinished"].includes(at(26)));
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
  //
  // Basic states percentiles to the nearest five (see engine/precision.ts), so
  // the check is that it reports the SAME number at the stated resolution —
  // not that it reports a different one.
  const strong = report({ overallPercentile: 91, pillars: { Harmony: 9, Angularity: 9, Dimorphism: 9, Features: 9 } });
  assert.ok(["Mogger", "Marlon level"].includes(verdictFor(strong).word));
  assert.equal(basicScores(strong)[0].value, statedPct(91));
  assert.ok(Math.abs(basicScores(strong)[0].value - 91) <= 2.5, "stating must not move the number");
});

test("stating a percentile coarsely never reorders two faces", () => {
  // Coarse is fine; wrong is not. A rounding that could report the better face
  // as the worse one would be a different answer, not a rounder one.
  for (let a = 0; a <= 100; a += 1) {
    for (const gap of [6, 11, 20]) {
      const b = Math.min(100, a + gap);
      const sa = basicScores(report({ overallPercentile: a }))[0].value;
      const sb = basicScores(report({ overallPercentile: b }))[0].value;
      assert.ok(sb >= sa, `stating inverted ${a} and ${b}`);
    }
  }
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

test("kind mode softens every band that stings", () => {
  const at = (pct: number, tone: VerdictTone) =>
    verdictForPercentile(pct, "male", tone).word;
  for (const pct of [5, 18, 30, 45, 58]) {
    assert.notEqual(at(pct, "kind"), at(pct, "blunt"), `${pct}`);
  }
});

test("kind mode never uses slang, at any height on the ladder", () => {
  // The dialog promises "no slang, nothing designed to sting", and that promise
  // does not stop being made once the result is good news. "Fine shyt" is a
  // compliment and it is still slang; somebody who asked for plain English
  // asked for it all the way up.
  const banned =
    /cooked|chopped|npc|rough|background character|mogger|shyt|baddie|final boss|true adam|true eve|aight/i;
  for (const sex of ["male", "female"] as const) {
    for (let pct = 0; pct <= 100; pct += 0.5) {
      const word = verdictForPercentile(pct, sex, "kind").word;
      assert.ok(!banned.test(word), `${sex} ${pct}: ${word}`);
    }
  }
});

test("no word is ever reused by two different rungs", () => {
  // Two people fifteen percentiles apart reading the same label is the ladder
  // failing at the only job it has.
  for (const tone of ["blunt", "kind"] as const) {
    for (const sex of ["male", "female"] as const) {
      const seen = new Map<string, string>();
      for (let pct = 0; pct <= 100; pct += 0.5) {
        const v = verdictForPercentile(pct, sex, tone);
        const previous = seen.get(v.word);
        assert.ok(
          previous === undefined || previous === v.line,
          `${tone}/${sex}: "${v.word}" appears on two rungs`,
        );
        seen.set(v.word, v.line);
      }
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

// ---------------------------------------------------------------------------
// The verdict in plain English.
//
// The ladder's words are slang, which is what makes them worth quoting and also
// what makes them meaningless to a viewer who arrived from the For You page.
// Every rung carries a second phrase that says the same thing in English, and
// the video says both.
// ---------------------------------------------------------------------------

test("every rung says what it means in plain English", () => {
  for (const sex of ["male", "female"] as const) {
    for (let pct = 0; pct <= 100; pct += 0.5) {
      const v = verdictForPercentile(pct, sex);
      assert.ok(v.descriptor.length > 0, `${sex} ${pct} has no descriptor`);
      // A noun phrase, so it can be read as its own sentence after the word:
      // "The verdict: Mogger. A very attractive male."
      assert.ok(/^an? /.test(v.descriptor), `${sex} ${pct}: "${v.descriptor}" is not a noun phrase`);
      // And it names the right person. Handing a woman "male" is the single
      // most obvious error the video could make.
      assert.ok(
        v.descriptor.includes(sex === "male" ? "male" : "female"),
        `${sex} ${pct}: "${v.descriptor}"`,
      );
      assert.ok(sex === "female" || !v.descriptor.includes("female"), `male got "${v.descriptor}"`);
    }
  }
});

test("the descriptor climbs with the ladder and never insults the floor", () => {
  // The bottom rung is the one place this product could do real damage. There
  // is a difference between telling somebody where they measure and telling
  // them what they are, and the plain-English half is the one that would say
  // the second thing if it were written carelessly.
  assert.ok(!/unattractive|ugly/i.test(verdictForPercentile(2).descriptor));
  assert.ok(!/unattractive|ugly/i.test(verdictForPercentile(15).descriptor));

  assert.equal(verdictForPercentile(45).descriptor, "a perfectly average male");
  assert.equal(verdictForPercentile(70).descriptor, "an attractive male");
  assert.equal(verdictForPercentile(85).descriptor, "a very attractive male");
  assert.equal(verdictForPercentile(85, "female").descriptor, "a very attractive female");
});

test("the descriptor does not move with the tone", () => {
  // The kind ladder already reads as plain English; a second plain-English
  // phrase behind it would be the same sentence twice.
  for (const pct of [5, 30, 50, 70, 90, 99.5]) {
    assert.equal(
      verdictForPercentile(pct, "male", "kind").descriptor,
      verdictForPercentile(pct, "male", "blunt").descriptor,
      `${pct}`,
    );
  }
});
