import test from "node:test";
import assert from "node:assert/strict";
import { NOISE, concernCleared, followUp } from "./followUp.js";
import type { ScanPoint } from "./followUp.js";

const DAY = 86_400_000;
const T0 = 1_700_000_000_000;
const at = (days: number, overall: number): ScanPoint => ({ at: T0 + days * DAY, overall });

test("one scan is not a trend", () => {
  assert.equal(followUp([at(0, 6)]).kind, "too-soon");
  assert.equal(followUp([]).kind, "too-soon");
});

test("two scans days apart are not read as progress", () => {
  // The instrument's own repeatability is 1.3 points. Reporting a two-day
  // "improvement" would be reporting the camera.
  assert.equal(followUp([at(0, 5.0), at(3, 6.9)]).kind, "too-soon");
});

test("a move bigger than the noise floor is called real", () => {
  const r = followUp([at(0, 5.0), at(70, 5.0 + NOISE + 0.1)]);
  assert.equal(r.kind, "working");
  assert.equal(r.suggestChange, false, "do not change a routine that is working");
});

test("a move smaller than the noise floor is never called progress", () => {
  // The lie this product exists not to tell. Anything inside the floor gets
  // reported as no information, in both directions. Written relative to NOISE
  // rather than as literals, so the floor can move with the shrinkage factor
  // without this test silently testing the wrong boundary.
  for (const delta of [-(NOISE - 0.01), -0.6 * NOISE, 0, 0.6 * NOISE, NOISE - 0.01]) {
    const kind = followUp([at(0, 5), at(30, 5 + delta)]).kind;
    assert.equal(kind, "holding", `${delta}`);
  }
});

test("flat for eight weeks is a finding, and says so out loud", () => {
  const r = followUp([at(0, 5), at(60, 5.2)]);
  assert.equal(r.kind, "stalled");
  assert.equal(r.suggestChange, true);
  // The sentence every competitor is structurally unable to write, because
  // they are selling the thing that is not working.
  assert.match(r.body, /not the lever|different one/i);
});

test("flat for three weeks is patience, not a verdict", () => {
  const r = followUp([at(0, 5), at(21, 5.2)]);
  assert.equal(r.kind, "holding");
  assert.equal(r.suggestChange, false);
});

test("a real decline is reported, and blames the boring things first", () => {
  const r = followUp([at(0, 6.5), at(30, 6.5 - NOISE - 0.2)]);
  assert.equal(r.kind, "slipping");
  assert.match(r.body, /sleep|salt|alcohol|light/i);
  // Short-run decline does not trigger a plan rebuild — one bad month is a bad
  // month, and a face app that panics is a face app that gets deleted.
  assert.equal(r.suggestChange, false);
});

test("a decline that persists past two months does suggest a change", () => {
  assert.equal(followUp([at(0, 6.5), at(70, 4.9)]).suggestChange, true);
});

test("progress is measured from the start, not from the previous scan", () => {
  // Six scans of noise around a genuine climb. Compared pairwise the last step
  // is negative and the story flips every week; against the starting point the
  // climb is unambiguous. This asserts the module does the second thing.
  const run = [at(0, 5.0), at(14, 5.4), at(28, 5.1), at(42, 6.0), at(56, 6.6), at(70, 6.4)];
  assert.equal(followUp(run).kind, "working");
});

test("history order does not matter", () => {
  const run = [at(70, 6.6), at(0, 5.0), at(28, 5.4)];
  assert.equal(followUp(run).kind, "working");
});

test("nothing in any message prescribes", () => {
  // The hard product rule. Max may say an approach has not worked; it may not
  // name a dose, a drug, or a procedure. It is a camera.
  // "prescribe" is deliberately absent: the cleared-concern message contains
  // the phrase "we do not prescribe", which is the disclaimer working rather
  // than the rule being broken. What is banned is the instruction — a dose, a
  // named drug, a procedure — not the word.
  const banned = /\bdose|dosage|\bmg\b|surgery|surgeon|filler|botox|accutane|isotretinoin|supplement|\btake \d|\bapply \d/i;
  const messages = [
    followUp([at(0, 5)]),
    followUp([at(0, 5), at(3, 6)]),
    followUp([at(0, 5), at(70, 7)]),
    followUp([at(0, 5), at(70, 5.1)]),
    followUp([at(0, 5), at(30, 5.1)]),
    followUp([at(0, 7), at(30, 5)]),
    followUp([at(0, 5), at(70, 7)], "Jawline"),
    concernCleared("acne", 12),
  ];
  for (const m of messages) {
    assert.ok(!banned.test(m.body), `${m.kind}: ${m.body}`);
    assert.ok(!banned.test(m.headline), `${m.kind}: ${m.headline}`);
  }
});

test("no message instructs anybody to change what they are using", () => {
  // Separate from the vocabulary check above, because the dangerous sentence
  // here uses no banned word at all: "you can safely lower it now" is a dosing
  // instruction written in plain English, and it is exactly the sentence this
  // feature would drift toward.
  const instructions = /\byou can (safely )?(lower|reduce|stop|drop|cut)|\b(lower|reduce|halve|taper|stop using) (your|the|it)\b/i;
  const messages = [
    followUp([at(0, 5), at(70, 5.1)]),
    followUp([at(0, 7), at(70, 5)]),
    concernCleared("acne", 12),
  ];
  for (const m of messages) assert.ok(!instructions.test(m.body), `${m.kind}: ${m.body}`);
});

test("the cleared-concern message points at a pharmacist rather than advising", () => {
  const r = concernCleared("acne", 12);
  assert.match(r.body, /pharmacist/i);
  assert.match(r.body, /we do not prescribe/i);
  // Specifically must not tell anybody to reduce or stop anything.
  assert.ok(!/\b(reduce|lower|stop|halve|taper)\b/i.test(r.body), r.body);
});

test("the same history always produces the same words", () => {
  // A follow-up that reworded itself on every open would read as generated.
  // The claim here is that it was observed, so it has to be stable.
  const run = [at(0, 5.0), at(60, 6.8)];
  const first = followUp(run);
  for (let i = 0; i < 5; i++) assert.deepEqual(followUp(run), first);
});

test("the goal is named when there is one, and not invented when there isn't", () => {
  assert.match(followUp([at(0, 5), at(70, 7)], "Jawline").body, /jawline/i);
  assert.ok(!/your\s+on/i.test(followUp([at(0, 5), at(70, 7)]).body));
});
