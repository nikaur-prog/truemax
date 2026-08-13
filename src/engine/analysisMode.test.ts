import test from "node:test";
import assert from "node:assert/strict";
import { basicScores, verdictFor } from "./analysisMode.ts";
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

test("the verdict ladder has a floor at Chopped and no rung below it", () => {
  // The bottom of the scale is the one place this product could do real harm,
  // and the boundary is worth a test rather than a comment: a zero percentile
  // must land on the lowest DEFINED rung, never on something worse.
  for (const pct of [0, 1, 5, 19.9]) {
    assert.equal(verdictFor(report({ overallPercentile: pct })).word, "Chopped", `${pct}`);
  }
});

test("each rung starts exactly where it says it does", () => {
  const at = (pct: number) => verdictFor(report({ overallPercentile: pct })).word;
  assert.equal(at(19.9), "Chopped");
  assert.equal(at(20), "Aight");
  assert.equal(at(49.9), "Aight");
  assert.equal(at(50), "Fine");
  assert.equal(at(79.9), "Fine");
  assert.equal(at(80), "Mogger");
  assert.equal(at(94.9), "Mogger");
  assert.equal(at(95), "TrueMax");
  assert.equal(at(100), "TrueMax");
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
  assert.equal(verdictFor(strong).word, "Mogger");
  assert.equal(basicScores(strong)[0].value, 91);
});
