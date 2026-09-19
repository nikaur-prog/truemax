import assert from "node:assert/strict";
import test from "node:test";
import { coachRead, deltaReadingCopy, fmt, leverFor, lockedCopy, regionSummary } from "./templates.js";
import { METRICS } from "../engine/metrics.js";
import type { ScanDelta } from "../engine/history.js";
import type { Report, ScoredMetric, Sex } from "../engine/types.js";

function metric(id: string, overrides: Partial<ScoredMetric> = {}): ScoredMetric {
  const def = METRICS.find((entry) => entry.id === id);
  assert.ok(def, id);
  return { def, value: def.dist.male.mean, z: -1, zEff: -1, score: 4, percentile: 30, markerPct: 30, conformance: 0.5, idealRange: [0, 1], ...overrides };
}

function report(sex: Sex = "male"): Report {
  const jaw = metric("jawCheekRatio");
  return { sex, overall: 5.4, overallPercentile: 60, overallZ: 0, potential: 6.1,
    metrics: [jaw], regions: [{ region: "jaw", percentile: 80, score: 6.7, z: 0.8, reliability: 0.47, metrics: [jaw] }],
    pillars: { Harmony: 5, Features: 5, Angularity: 5, Dimorphism: 5 }, zScores: {} };
}

function delta(overrides: Partial<ScanDelta> = {}): ScanDelta {
  return { daysAgo: 28, overall: 0.8, vsAverage: 0.7, averageOf: 3, regions: [], reading: "worthNoting", ...overrides };
}

const theatrical = /down to business|\balright\b|\bnice\b|\bbro\b|\bgirl\b|\brespect\b|do me a favour|tell me straight|no drama|actually did the thing|I see the improvements|what I gave you|camera can fake|blame on the camera/i;
const unsupportedRoutine = /moves without surgery|% of that gap|close part of this gap|restore the true measurement|two weeks of discipline|single biggest lever|leaning out raises|measurably worsen|protects the number|cut body fat|body-fat reduction|debloat protocol/i;

test("report reads lead with the supported result across names, sexes and score directions", () => {
  for (const sex of ["male", "female"] as const) {
    for (const comparison of [null, delta(), delta({ overall: -0.8 }), delta({ overall: 0, reading: "noise" })]) {
      const read = coachRead(report(sex), comparison, { selfName: "Nico", scope: "front" });
      assert.match(read.good, /^Your jaw has the highest supported region reading here/);
      assert.match(read.good, /reference set/);
      assert.doesNotMatch(Object.values(read).join(" "), theatrical);
      assert.doesNotMatch(Object.values(read).join(" "), /Nico|—/);
      assert.ok(read.memory.split(/\s+/).length < 100);
    }
  }
});

test("a higher or lower score does not become a claim about routine use or physical progress", () => {
  for (const overall of [0.8, -0.8]) {
    const read = coachRead(report(), delta({ overall }));
    assert.match(read.memory, new RegExp(`0.8 points ${overall > 0 ? "higher" : "lower"}`));
    assert.match(read.memory, /outside the app's usual capture spread/);
    assert.match(read.memory, /does not identify a cause or prove that a routine worked/);
    assert.doesNotMatch(read.memory, /\?|keeping up|running what|followed|earned|improving|failing|replace|rebuild/i);
  }
});

test("capture-limited comparisons state uncertainty rather than diagnosing the whole difference", () => {
  const noise = coachRead(report(), delta({ overall: 0.3, reading: "noise" }));
  assert.match(noise.memory, /0.3 points higher/);
  assert.match(noise.memory, /within the app's usual photo-to-photo spread/);
  assert.match(noise.memory, /does not establish a physical change/);
  assert.doesNotMatch(noise.memory, /is the camera rather than your face|whole explanation|no change either way/);
  const early = coachRead(report(), delta({ daysAgo: 1, reading: "tooSoon" }));
  assert.match(early.memory, /one day ago/);
  assert.match(early.memory, /cannot establish a lasting physical change/);
  assert.match(early.memory, /same pose, expression, lighting and camera distance/);
});

test("average comparisons retain their numbers without calling a matching average below average", () => {
  assert.match(coachRead(report(), delta()).memory, /0.7 points above your average across 3 earlier scans/);
  const equal = coachRead(report(), delta({ overall: 0, vsAverage: 0, reading: "noise" })).memory;
  assert.match(equal, /displayed score is unchanged/);
  assert.match(equal, /matches your displayed average/);
  assert.doesNotMatch(equal, /0.0 points (?:lower|higher|below|above)/);
  const missing = coachRead(report(), delta({ vsAverage: Number.NaN })).memory;
  assert.doesNotMatch(missing, /NaN|your average/);
});

test("missing history and guest scans do not invent a first scan, save or owner trend", () => {
  assert.match(coachRead(report(), null).memory, /no earlier scan comparison in this view/);
  assert.doesNotMatch(coachRead(report(), null).memory, /starting scan|first scan/);
  const guest = coachRead(report(), delta(), { guestName: "<img src=x onerror=alert(1)>", scope: "front" });
  assert.equal(guest.memory, "This is a guest scan. It is separate from your own history, average and trend.");
  assert.doesNotMatch(Object.values(guest).join(" "), /<img|saved|own record|0.8 points/);
  assert.equal(coachRead(report(), delta(), { scope: "side" }).memory, "");
});

test("invalid comparison data never reaches the spoken or displayed report as a number", () => {
  for (const invalid of [delta({ overall: Number.NaN }), delta({ daysAgo: Number.POSITIVE_INFINITY }), delta({ daysAgo: -1 })]) {
    assert.equal(coachRead(report(), invalid).memory, "The earlier scan comparison is not available in this view.");
    assert.equal(deltaReadingCopy(invalid), "The earlier scan comparison is not available in this view.");
  }
});

test("displayed and spoken comparisons share the same evidence limit", () => {
  for (const reading of ["noise", "tooSoon", "worthNoting"] as const) {
    const comparison = delta({ reading, vsAverage: null });
    assert.equal(deltaReadingCopy(comparison).replace(/<\/?b>/g, ""), coachRead(report(), comparison).memory);
  }
});

test("all plan copy preserves readings without promising causes, movable percentages or routines", () => {
  for (const def of METRICS) {
    const measured = metric(def.id);
    const lever = leverFor(measured);
    const text = `${lever.title} ${lever.body(measured, "male")} ${lever.neutral(measured, "male")} ${lockedCopy(measured, "male")}`;
    assert.ok(text.includes(fmt(measured)), def.id);
    assert.doesNotMatch(text, unsupportedRoutine, def.id);
    assert.doesNotMatch(text, /NaN|undefined|—/, def.id);
    assert.match(lever.neutral(measured, "male"), /chose not to receive/);
    assert.match(lockedCopy(measured, "male"), /part of Max/);
    assert.doesNotMatch(lockedCopy(measured, "male"), /chose not to receive/);
  }
});

test("unreliable or missing readings only offer review, with the existing advice channel intact", () => {
  const unreliable = metric("fwhr");
  assert.match(leverFor(unreliable).body(unreliable, "male"), /repeatability is too low to guide a routine/);
  const missing = metric("jawCheekRatio", { value: Number.NaN });
  assert.equal(leverFor(missing).channel, "diet");
  assert.match(leverFor(missing).body(missing, "male"), /was not available/);
  assert.doesNotMatch(leverFor(missing).body(missing, "male"), /measures –|reads –|NaN/);
  const implausible = metric("jawCheekRatio", { value: 99, implausible: true });
  assert.match(leverFor(implausible).body(implausible, "male"), /point-placement review/);
  assert.doesNotMatch(leverFor(implausible).body(implausible, "male"), /99/);
});

test("report explanation does not alter any scores, measurements, references or ordering", () => {
  const input = report();
  const before = JSON.stringify(input);
  coachRead(input, delta());
  regionSummary(input.regions[0], input.sex, { name: "Nico", delta: 0.8 });
  for (const measured of input.metrics) {
    leverFor(measured).body(measured, input.sex);
    lockedCopy(measured, input.sex);
  }
  assert.equal(JSON.stringify(input), before);
});
