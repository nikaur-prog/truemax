import test from "node:test";
import assert from "node:assert/strict";
import { buildReelScript, narrationFrom, reelBlockers } from "./reelScript.js";
import type { Report, ScoredMetric } from "./types.js";

// A metric stub with only the fields the script generator reads. Building a
// real Report would mean running the landmarker, which this module never
// touches — the whole point of it being pure.
function metric(id: string, region: string, zEff: number, implausible = false): ScoredMetric {
  return {
    def: {
      id,
      name: id,
      unit: "",
      decimals: 2,
      region,
      pillar: "Harmony",
      weight: 1,
      direction: "higher",
      dist: { male: { mean: 0, sd: 1 }, female: { mean: 0, sd: 1 } },
    },
    value: 1,
    z: zEff,
    zEff,
    percentile: 50,
    markerPct: 50,
    score: 5,
    idealRange: [0, 1],
    ...(implausible ? { implausible: true } : {}),
  } as unknown as ScoredMetric;
}

function report(metrics: ScoredMetric[]): Report {
  return {
    sex: "male",
    overall: 5.4,
    overallPercentile: 62,
    overallZ: 0.3,
    potential: 6,
    pillars: {},
    regions: [],
    metrics,
    zScores: {},
  } as unknown as Report;
}

const SPREAD_OF_METRICS = [
  metric("canthalTilt", "eyes", 1.6),
  metric("eyeAspectRatio", "eyes", -1.4),
  metric("midfaceRatio", "midface", 0.9),
  metric("nasalIndex", "nose", -0.8),
  metric("lipRatio", "lips", 1.1),
  metric("gonialProxy", "jaw", -1.9),
  metric("chinHeightRatio", "chin", 0.7),
  metric("facialIndex", "proportions", -0.6),
];

test("the running order walks down the face", () => {
  const beats = buildReelScript(report(SPREAD_OF_METRICS), { name: "Test" });
  const regions = beats.filter((b) => b.kind === "metric").map((b) => b.region);
  // Eyes must appear before jaw, jaw before chin. Interleaving strengths and
  // weaknesses is allowed to reorder WITHIN that, but the video must not bounce
  // from chin to eyes to nose — that is the difference between an analysis and
  // a slideshow.
  const first = (r: string) => regions.indexOf(r as never);
  assert.ok(first("eyes") < first("jaw"), `eyes ${first("eyes")} vs jaw ${first("jaw")}`);
  assert.ok(first("jaw") < first("proportions"));
});

test("it opens on a strength", () => {
  // Leading with a flaw is what makes these read as an attack, and the
  // subject's own audience is most of the reach.
  const beats = buildReelScript(report(SPREAD_OF_METRICS), { name: "Test" });
  const firstMetric = beats.find((b) => b.kind === "metric")!;
  assert.equal(firstMetric.positive, true);
});

test("it does not stack all the compliments then all the insults", () => {
  const beats = buildReelScript(report(SPREAD_OF_METRICS), { name: "Test" });
  const signs = beats.filter((b) => b.kind === "metric").map((b) => b.positive);
  // At least one sign change in the first four: a video that opens with four
  // compliments and closes with four insults is a bait and switch.
  const early = signs.slice(0, 4);
  assert.ok(new Set(early).size > 1, `first four all ${early[0]}`);
});

test("an impossible measurement never gets a sentence", () => {
  // A landmark in the wrong place carries no weight in the score (scoring.ts)
  // and must not carry a line in a video either.
  const beats = buildReelScript(
    report([...SPREAD_OF_METRICS, metric("brokenThing", "jaw", 3.5, true)]),
    { name: "Test" },
  );
  assert.ok(!beats.some((b) => b.metricId === "brokenThing"));
});

test("unremarkable measurements are left out", () => {
  const beats = buildReelScript(report([...SPREAD_OF_METRICS, metric("dull", "nose", 0.1)]), {
    name: "Test",
  });
  assert.ok(!beats.some((b) => b.metricId === "dull"));
});

test("the score beat never states a number without the distribution", () => {
  // The whole correction this product exists to make. A score alone gets read
  // against a school mark; the same score against the curve is the thing that
  // makes somebody want their own.
  const beats = buildReelScript(report(SPREAD_OF_METRICS), { name: "Test" });
  const score = beats.find((b) => b.kind === "score")!;
  assert.match(score.line, /5\.4 out of 10/);
  assert.match(score.line, /Two thirds of men measure between/);
  assert.match(score.line, /5\.0 is the exact middle/);
});

test("the hook and the call to action bookend it", () => {
  const beats = buildReelScript(report(SPREAD_OF_METRICS), { name: "LeBron James" });
  assert.equal(beats[0].kind, "hook");
  assert.match(beats[0].line, /How attractive is LeBron James\?/);
  assert.equal(beats[beats.length - 1].kind, "cta");
});

test("the context beat says what the face is not measuring", () => {
  const beats = buildReelScript(report(SPREAD_OF_METRICS), {
    name: "Test",
    context: ["6'9\"", "four championships"],
  });
  const context = beats.find((b) => b.kind === "context")!;
  assert.match(context.line, /measures a face and nothing else/);
  assert.match(context.line, /four championships/);
});

test("narration matches the captions exactly", () => {
  const beats = buildReelScript(report(SPREAD_OF_METRICS), { name: "Test" });
  const spoken = narrationFrom(beats);
  for (const beat of beats) assert.ok(spoken.includes(beat.line), `missing: ${beat.line}`);
});

test("a tilted capture blocks the reel", () => {
  // The pipeline must refuse a photograph the app would warn a paying customer
  // about. Nobody but us will ever check.
  const blockers = reelBlockers(report(SPREAD_OF_METRICS), 12, 6);
  assert.equal(blockers.length, 1);
  assert.match(blockers[0], /12° off level/);
  assert.equal(reelBlockers(report(SPREAD_OF_METRICS), 3, 6).length, 0);
});

test("a thin scan blocks the reel", () => {
  const blockers = reelBlockers(report([metric("a", "eyes", 1.2), metric("b", "jaw", -1.1)]), 0, 6);
  assert.ok(blockers.some((b) => /not enough for a breakdown/.test(b)));
});
