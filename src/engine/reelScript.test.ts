import test from "node:test";
import assert from "node:assert/strict";
import { buildReelScript, narrationFrom, reelBlockers, spokenSeconds } from "./reelScript.js";
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

// Every metric here clears REEL_RELIABLE_MIN, which is now part of what the
// script builder tests. The fixture previously used gonialProxy (0.25),
// nasalIndex (0.00) and chinHeightRatio (0.03) — all correctly excluded from a
// published video now, which left this fixture with no jaw, nose or chin beat
// and no way to assert an ordering that walks down the face.
//
// Swapping them for the reliable metric in each region keeps the test about
// what it is about: the running order. It is worth noting that the nose has no
// replacement — every nose metric measures noise — so a rundown simply has
// nothing trustworthy to say about a nose, and the fixture reflects that.
const SPREAD_OF_METRICS = [
  metric("canthalTilt", "eyes", 1.6),
  metric("browTilt", "eyes", -1.4),
  metric("midfaceRatio", "midface", 0.9),
  metric("lipRatio", "lips", 1.1),
  metric("jawCheekRatio", "jaw", -1.9),
  metric("philtrumChinRatio", "chin", 0.7),
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
  // The score is delivered over several beats so the renderer has something to
  // cut on, so the guard is on the SECTION rather than any one beat: whatever
  // the split, a viewer must not receive the number without the curve.
  const beats = buildReelScript(report(SPREAD_OF_METRICS), { name: "Test" });
  const score = beats.filter((b) => b.kind === "score");
  const said = score.map((b) => b.line).join(" ");
  assert.match(said, /5\.4 out of 10/);
  assert.match(said, /Two thirds of men measure between/);
  assert.match(said, /5\.0 is the exact middle/);

  // And they must be contiguous. Splitting the number from its distribution is
  // only safe while nothing can appear between them — a context or CTA beat
  // landing in the gap would put the number on screen alone, which is the exact
  // misreading the split is allowed to risk and this test exists to prevent.
  const first = beats.findIndex((b) => b.kind === "score");
  assert.deepEqual(
    beats.slice(first, first + score.length).map((b) => b.kind),
    score.map(() => "score"),
  );
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

test("the running order is strictly anatomical, tone is balanced by selection", () => {
  // The bug this replaces: metrics were sorted down the face and then zipped
  // good/bad, which silently undid the sort and bounced the viewer around the
  // face. Order must be monotonic down REGION_ORDER, with no exceptions.
  const beats = buildReelScript(report(SPREAD_OF_METRICS), { name: "Test" });
  const order = ["eyes", "midface", "nose", "lips", "jaw", "chin", "proportions", "symmetry"];
  const seen = beats.filter((b) => b.kind === "metric").map((b) => order.indexOf(b.region!));
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i] >= seen[i - 1], `bounced back up the face at beat ${i}: ${seen.join(",")}`);
  }
  // Balance is still there, it just comes from which metrics were chosen.
  const metrics = beats.filter((b) => b.kind === "metric");
  assert.ok(metrics.some((b) => b.positive), "no strengths chosen");
  assert.ok(metrics.some((b) => !b.positive), "no weaknesses chosen");
});

test("the voice track never reads a parenthetical or a colon aloud", () => {
  // Screen keeps "Facial width-to-height (fWHR)"; the synthesiser must not say
  // "f-w-h-r", and "nose : mouth width" must not put a colon where a word goes.
  const beats = buildReelScript(report(SPREAD_OF_METRICS), { name: "Test" });
  const narration = narrationFrom(beats);
  assert.ok(!/\(|\)/.test(narration), `parenthetical survived into narration: ${narration}`);
  assert.ok(!/\s:\s/.test(narration), `colon survived into narration: ${narration}`);
});

test("a typed disclaimer is read verbatim, just before the call to action", () => {
  // The operator knows something the engine cannot: that the subject is famous,
  // or tall, or a singer. Templating that would defeat the point — the value is
  // in it being a sentence nobody could have generated from the measurements.
  const note = "He's a singer with a stadium career, and that moves how he's seen.";
  const beats = buildReelScript(report(SPREAD_OF_METRICS), { name: "Ari", note });
  const index = beats.findIndex((b) => b.line === note);
  assert.ok(index > 0, "the disclaimer is missing from the script");
  assert.equal(beats[index].kind, "context");
  assert.equal(beats[index + 1]?.kind, "cta", "the disclaimer must land immediately before the CTA");

  // And it must reach the microphone, not just the screen.
  assert.ok(narrationFrom(beats).includes(note));
});

test("no disclaimer leaves the script exactly as it was", () => {
  const plain = buildReelScript(report(SPREAD_OF_METRICS), { name: "Ari" });
  for (const note of ["", "   "]) {
    const same = buildReelScript(report(SPREAD_OF_METRICS), { name: "Ari", note });
    assert.deepEqual(same.map((b) => b.line), plain.map((b) => b.line), `"${note}" should be ignored`);
  }
});

test("the spoken-length estimate is usable for planning footage", () => {
  assert.equal(spokenSeconds(""), 0);
  assert.equal(spokenSeconds("   "), 0);
  // Roughly 165 words a minute plus a beat of air. Twenty words is about eight
  // seconds — the number an operator uses to decide how much B-roll to find, so
  // it has to be in the right neighbourhood rather than merely monotonic.
  const twenty = new Array(20).fill("word").join(" ");
  const s = spokenSeconds(twenty);
  assert.ok(s > 6.5 && s < 9, `twenty words estimated at ${s.toFixed(1)}s`);
  assert.ok(spokenSeconds(twenty + " more") > s, "a longer line must estimate longer");
});
