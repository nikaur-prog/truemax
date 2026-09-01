import test from "node:test";
import assert from "node:assert/strict";
import { basicScores, verdictFor, verdictForPercentile } from "./analysisMode.js";
import type { VerdictTone } from "./analysisMode.js";
import type { Report } from "./types.js";

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

test("the descriptive ladder has a defined floor and nothing below it", () => {
  // The bottom of the scale is the one place this product could do real harm.
  for (const pct of [0, 1, 5, 11.9]) {
    assert.equal(
      verdictFor(report({ overallPercentile: pct }), "blunt").word,
      "A lot to work on",
      `${pct}`,
    );
  }
});

test("no ladder has a rung below its own floor", () => {
  // The same rule, stated for every register rather than for the one that
  // happens to be the default today. Changing the default must not be able to
  // introduce a word nobody vetted at the bottom of the scale.
  for (const tone of ["blunt", "kind", "polite"] as const) {
    for (const sex of ["male", "female"] as const) {
      for (const pct of [0, 1, 5, 11.9]) {
        const v = verdictForPercentile(pct, sex, tone);
        assert.equal(v.tone, "low", `${tone}/${sex} at ${pct}`);
        assert.ok(v.word.length > 0, `${tone}/${sex} at ${pct} has no word`);
      }
    }
  }
});

test("each rung starts exactly where it says it does", () => {
  const at = (pct: number) => verdictFor(report({ overallPercentile: pct }), "blunt").word;
  assert.equal(at(11.9), "A lot to work on");
  // The bottom-fifth rung carries alternates now, like every rung above it, so
  // two friends who land in the same band do not read the same word. What this
  // test is about is the BOUNDARY, so both ends of the band assert the band.
  const BAND_12 = ["A long way to go", "Rough around the edges"];
  assert.ok(BAND_12.includes(at(12)));
  assert.ok(BAND_12.includes(at(25.9)));
  assert.ok(["A bit below average", "Some way to go"].includes(at(26)));
  assert.ok(["Average looking", "Ordinary looking", "Middle of the road"].includes(at(40)));
  assert.ok(["A bit above average", "Fairly good looking"].includes(at(52)));
  assert.ok(["Good looking", "Nice looking", "Sharp looking"].includes(at(65)));
  assert.ok(["Very good looking", "Great looking", "Really good looking"].includes(at(82)));
  assert.ok(["Model looks", "Outstanding looking"].includes(at(95)));
  assert.ok(["Model looks", "Outstanding looking"].includes(at(98.9)));
  assert.equal(at(99), "As good as it gets");
  assert.equal(at(100), "As good as it gets");
});

test("the verdict word does not change with the reference population", () => {
  // The words used to be split by sex because they were jokes, and
  // "she-mogger" was not a translation of "mogger". Plain English needs no
  // such split: the same percentile is the same reading whoever is reading it,
  // which is what the plain ladder has always said about itself.
  const at = (pct: number, sex: "male" | "female", tone: VerdictTone) =>
    verdictFor(report({ overallPercentile: pct, sex }), tone).word;
  // The descriptive and plain ladders are shared word for word.
  for (const tone of ["blunt", "polite"] as const) {
    for (let pct = 0; pct <= 100; pct += 0.5) {
      assert.equal(at(pct, "male", tone), at(pct, "female", tone), `${tone} at ${pct}`);
    }
  }
  // The kind ladder keeps exactly one split, "Handsome" and "Lovely", and it
  // stays: both are ordinary English, neither is slang, and this change was
  // about words nobody could parse rather than about gendered ones. Asserted
  // rather than left implicit so that a second split cannot appear unnoticed.
  const splits = new Set<string>();
  for (let pct = 0; pct <= 100; pct += 0.5) {
    const m = at(pct, "male", "kind");
    const f = at(pct, "female", "kind");
    if (m !== f) splits.add(`${m}/${f}`);
  }
  assert.deepEqual([...splits], ["Handsome/Lovely"]);
});

test("the spoken descriptor still names the right person", () => {
  // The word is shared; the descriptor is not, because it says "a male" or
  // "a female" out loud and the wrong one is the most obvious error the video
  // could make.
  for (let pct = 0; pct <= 100; pct += 0.5) {
    assert.match(verdictForPercentile(pct, "male").descriptor, /\bmale\b/);
    assert.match(verdictForPercentile(pct, "female").descriptor, /\bfemale\b/);
  }
});

test("one face always gets one verdict", () => {
  // The alternates are derived from the percentile, never randomised. A verdict
  // that changes when you press the button again is not a measurement.
  for (const pct of [83, 85.5, 96, 99.9]) {
    const first = verdictFor(report({ overallPercentile: pct }), "blunt").word;
    for (let i = 0; i < 20; i++) {
      assert.equal(verdictFor(report({ overallPercentile: pct }), "blunt").word, first, `${pct}`);
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

test("basic scores stay on the canonical 0-10 scale", () => {
  // Scores are 0-10 and percentiles are 0-100; a mix-up would print a
  // percentile or a score multiplied by ten as though it were a score.
  for (const pillars of [0, 5, 10]) {
    const scores = basicScores(
      report({ pillars: { Harmony: pillars, Angularity: pillars, Dimorphism: pillars, Features: pillars } }),
    );
    for (const s of scores) {
      assert.ok(s.value >= 0 && s.value <= 10, `${s.label}=${s.value}`);
    }
  }
});

test("every mode reads the same underlying score", () => {
  // The invariant the whole feature rests on: change the report, and every mode
  // moves together. If these ever disagree, the app is showing one face two
  // different answers.
  //
  // Basic is the same 0-10 score. Percentile is metadata for the rarity line,
  // never a replacement score.
  const strong = report({ overall: 7.1, overallPercentile: 91, pillars: { Harmony: 9, Angularity: 9, Dimorphism: 9, Features: 9 } });
  assert.ok(["Very good looking", "Great looking", "Really good looking"].includes(verdictFor(strong, "blunt").word));
  assert.equal(basicScores(strong)[0].value, 7.1);
  assert.equal(basicScores(strong)[0].percentile, 91);
});

test("basic score rounding never reorders two faces", () => {
  for (let a = 0.5; a <= 9.8; a += 0.1) {
    for (const gap of [0.1, 0.5, 1]) {
      const b = Math.min(9.9, a + gap);
      const sa = basicScores(report({ overall: a }))[0].value;
      const sb = basicScores(report({ overall: b }))[0].value;
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
    assert.equal(
      verdictForPercentile(pct, "male", "blunt").word,
      verdictFor(report({ overallPercentile: pct }), "blunt").word,
      `blunt ${pct}`,
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

test("NO register uses slang, at any height on any ladder", () => {
  // This is the regression guard for the whole change. It used to apply to the
  // kind ladder only, which is exactly how "Cracked" reached a published video:
  // the register somebody had actually selected was the one register nothing
  // checked.
  //
  // Every word below was on a shipped rung. They are barred by name rather
  // than by a general rule because there is no general rule that catches
  // "mogger" and spares "model looks"; a list somebody has to edit on purpose
  // is the point.
  const banned =
    /\bcooked\b|chopped|\bnpc\b|background character|mogger|shyt|baddie|final boss|true adam|true eve|\baight\b|cracked|built different|\bmid\b|\bbeige\b|stock photo|default settings|girl next door|half baked/i;
  for (const tone of ["blunt", "kind", "polite"] as const) {
    for (const sex of ["male", "female"] as const) {
      for (let pct = 0; pct <= 100; pct += 0.5) {
        const word = verdictForPercentile(pct, sex, tone).word;
        assert.ok(!banned.test(word), `${tone}/${sex} ${pct}: ${word}`);
      }
    }
  }
});

test("no verdict word carries censored profanity", () => {
  // "Fine shyt" shipped. A deliberate misspelling is not a clean word: it is
  // the same word wearing a hat, and a moderation classifier reads it that
  // way, which is what put the videos carrying it at risk.
  const banned = /sh[y1i\*]t|f[u\*]ck|b[i1\*]tch|\ba[s\$]{2}\b|d[a\*]mn/i;
  for (const tone of ["blunt", "kind", "polite"] as const) {
    for (const sex of ["male", "female"] as const) {
      for (let pct = 0; pct <= 100; pct += 0.5) {
        const v = verdictForPercentile(pct, sex, tone);
        assert.ok(!banned.test(v.word), `${tone}/${sex} ${pct}: ${v.word}`);
        assert.ok(!banned.test(v.descriptor), `${tone}/${sex} ${pct}: ${v.descriptor}`);
      }
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
    for (const tone of ["kind", "polite"] as const) {
      const other = verdictForPercentile(pct, "male", tone);
      assert.equal(blunt.tone, other.tone, `${tone} tone band at ${pct}`);
      assert.equal(blunt.line, other.line, `${tone} explanation at ${pct}`);
      assert.equal(blunt.descriptor, other.descriptor, `${tone} descriptor at ${pct}`);
    }
  }
});

test("polite is the default, so an unasked caller gets ordinary English", () => {
  // The default is what an exported video carries, and a video is watched by
  // people who never opted into anything. "Chopped" is the joke this audience
  // came for and it is also the word that decides a stranger scrolling past
  // that this is a red-pill account rather than a measurement tool.
  assert.equal(verdictForPercentile(5).word, "Needs work");
  assert.equal(verdictForPercentile(5, "male").word, "Needs work");
  assert.equal(verdictForPercentile(85).word, "Good");
  assert.equal(verdictForPercentile(96, "female").word, "Very good");
});

test("the polite ladder is the words a person would actually say", () => {
  // Exactly the set that was asked for, in the order the rungs climb, and no
  // slang anywhere on it at any height.
  const at = (pct: number, sex: "male" | "female" = "male") =>
    verdictForPercentile(pct, sex, "polite").word;
  assert.equal(at(45), "Okay");
  assert.equal(at(55), "Alright");
  assert.equal(at(70), "Decent");
  assert.equal(at(85), "Good");
  assert.equal(at(96), "Very good");
  assert.equal(at(96, "female"), "Very good");
  assert.equal(at(99.5), "Top of the scale");
  assert.equal(at(99.5, "female"), "Top of the scale");

  // Nothing on the plain ladder flatters. The register the owner asked for
  // is "decent, okay, alright, needs improving" — a reading, not a
  // compliment — so the words a compliment would reach for are barred.
  const flattery = /attractive|handsome|beautiful|gorgeous|stunning|striking|model/i;
  for (const sex of ["male", "female"] as const) {
    for (let pct = 0; pct <= 100; pct += 0.5) {
      assert.ok(!flattery.test(at(pct, sex)), `${sex} ${pct}: ${at(pct, sex)}`);
    }
  }

  const slang = /cooked|chopped|npc|mogger|shyt|baddie|final boss|adam|eve|aight|mid\b/i;
  for (const sex of ["male", "female"] as const) {
    for (let pct = 0; pct <= 100; pct += 0.5) {
      const word = at(pct, sex);
      assert.ok(!slang.test(word), `${sex} ${pct}: ${word}`);
    }
  }
});

test("the polite ladder climbs without ever repeating itself", () => {
  // One word per rung, so a repeat would mean two different bands reading the
  // same — which is the ladder failing at the only job it has.
  for (const sex of ["male", "female"] as const) {
    const seen = new Map<string, string>();
    for (let pct = 0; pct <= 100; pct += 0.5) {
      const v = verdictForPercentile(pct, sex, "polite");
      const previous = seen.get(v.word);
      assert.ok(previous === undefined || previous === v.line, `${sex}: "${v.word}" on two rungs`);
      seen.set(v.word, v.line);
    }
  }
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

  assert.equal(verdictForPercentile(45).descriptor, "a male right on the middle");
  assert.equal(verdictForPercentile(70).descriptor, "a decent-looking male");
  assert.equal(verdictForPercentile(85).descriptor, "a good-looking male");
  assert.equal(verdictForPercentile(85, "female").descriptor, "a good-looking female");

  // Same register as the word ladder: the spoken half says what a person
  // would say, not what a compliment would.
  for (const pct of [2, 15, 30, 45, 55, 70, 85, 96, 99.5]) {
    for (const sex of ["male", "female"] as const) {
      const d = verdictForPercentile(pct, sex).descriptor;
      assert.ok(!/attractive|handsome|beautiful/i.test(d), `${sex} ${pct}: ${d}`);
    }
  }
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
