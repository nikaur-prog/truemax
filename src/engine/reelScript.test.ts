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

test("strengths run together, then one clean turn into the flaws", () => {
  // This test used to assert the OPPOSITE — that the signs must alternate
  // early, on the reasoning that all-praise-then-all-criticism is a bait and
  // switch. That reasoning was about a script whose sentences were "excellent
  // canthal tilt" and "weak brow tilt": when every line is the same length and
  // the same shape, alternation is the only thing giving the video a rhythm.
  //
  // It is not the only thing any more. The bait-and-switch risk was that the
  // turn is unannounced — a viewer who has heard four compliments does not know
  // the fifth line is where it changes. So the turn is announced now, out loud,
  // in the copy: "Now the flaws." A stated pivot is a structure. An unstated one
  // was the thing worth preventing, and the guard below is on the pivot rather
  // than on the ordering it used to stand in for.
  const beats = buildReelScript(report(SPREAD_OF_METRICS), { name: "Test" });
  const metrics = beats.filter((b) => b.kind === "metric");
  const signs = metrics.map((b) => b.positive);

  // Exactly one sign change: strengths, turn, flaws. Bouncing back to a
  // compliment after the turn is what makes a rundown feel arbitrary.
  const changes = signs.filter((s, i) => i > 0 && s !== signs[i - 1]).length;
  assert.equal(changes, 1, `${changes} tone changes: ${signs.join(",")}`);

  // And the turn must be audible. The viewer is told the video has changed
  // direction rather than left to work it out from the adjectives.
  const turn = metrics.find((b, i) => i > 0 && !b.positive && metrics[i - 1].positive);
  assert.ok(turn, "no turn from strengths into flaws");
  // "The flaws." rather than the older "Now the flaws." — same audible pivot,
  // one connective shorter, matching the verdict-first copy pass.
  assert.match(turn.line, /^The flaws\./);
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
  // The number now lives on the CARD and the distribution on the CURVE, which
  // is a stronger version of the same contract rather than a weaker one — the
  // curve is drawn, not merely spoken. The guard is unchanged in substance: a
  // viewer must not receive the number without the thing that gives it meaning.
  const beats = buildReelScript(report(SPREAD_OF_METRICS), { name: "Test" });
  const ending = beats.filter((b) => b.kind === "card" || b.kind === "curve");
  const said = ending.map((b) => b.line).join(" ");
  assert.match(said, /5\.4 out of 10/);
  assert.match(said, /Two thirds of men measure between/);
  assert.match(said, /5\.0 is dead average/);

  // And no rarity conversion is ever spoken. "That's 1 in 20" restated the
  // percentile in the one vocabulary that collides with how the audience
  // already uses the scale, and a nineteen-face corpus cannot support the
  // "1 in 100,000" the audience means by a 7 — so neither number is said.
  // The curve badge carries the percentile, scoped by the curve it sits on.
  assert.ok(!/1 in \d/.test(said), "a rarity conversion is being spoken again");

  // And they must be contiguous. Splitting the number from its distribution is
  // only safe while nothing can appear between them — a context or CTA beat
  // landing in the gap would put the number on screen alone, which is the exact
  // misreading the split is allowed to risk and this test exists to prevent.
  // Stated as the SHAPE rather than as a count: every card, then every curve,
  // and nothing else in between. Enumerating the exact run meant that splitting
  // a card beat in two — which changes nothing about the contract — failed here
  // and invited the fix of updating the list, which is how a guard quietly
  // becomes a description of whatever the code does today.
  const first = beats.findIndex((b) => b.kind === "card");
  const run = beats.slice(first, first + ending.length).map((b) => b.kind);
  assert.equal(run.length, ending.length, "something not in the ending landed inside it");
  const firstCurve = run.indexOf("curve");
  assert.ok(firstCurve > 0, "the ending has no card before its curve");
  assert.ok(
    run.slice(0, firstCurve).every((k) => k === "card"),
    `cards are interrupted: ${run.join(",")}`,
  );
  assert.ok(
    run.slice(firstCurve).every((k) => k === "curve"),
    `curves are interrupted: ${run.join(",")}`,
  );

  // The card carries the numbers it needs to draw itself, and it gets them from
  // here rather than reaching back into a Report at render time.
  const card = beats.find((b) => b.kind === "card")!.card!;
  assert.equal(card.overall, 5.4);
  assert.ok(card.rows.length >= 0);
  // And the curve knows where the marker goes.
  assert.equal(beats.find((b) => b.kind === "curve")!.percentile, 62);
});

test("the video ends by showing the address, then asking for the next face", () => {
  // A URL read aloud is a URL nobody types. The search bar is the one frame
  // with a job outside the video, and it has to land AFTER the curve — before
  // it, the viewer has not yet been given a reason to want their own.
  const beats = buildReelScript(report(SPREAD_OF_METRICS), { name: "Test" });
  const kinds = beats.map((b) => b.kind);
  assert.ok(kinds.lastIndexOf("curve") < kinds.indexOf("search"), "search bar lands before the curve");
  assert.equal(beats[beats.length - 1].kind, "cta");
  assert.match(beats[beats.length - 2].line, /truemax\.app/);
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

test("the running order is anatomical WITHIN each act", () => {
  // The bug this originally caught: metrics were sorted down the face and then
  // zipped good/bad, which silently undid the sort and bounced the viewer
  // around the face. That is still the thing being prevented — on a format
  // where the camera crops to the region being measured, bouncing is the most
  // visible fault in the video.
  //
  // What changed is the scope. The script now has acts — strengths, then the
  // flaws, then the profile — and the eye is expected to travel back to the top
  // of the face ONCE, at the turn, which the copy announces out loud. So the
  // guard is per-act: monotonic down REGION_ORDER inside each run of the same
  // tone, and no constraint across the boundary between them.
  const beats = buildReelScript(report(SPREAD_OF_METRICS), { name: "Test" });
  const order = ["eyes", "midface", "nose", "lips", "jaw", "chin", "proportions", "symmetry"];
  const metrics = beats.filter((b) => b.kind === "metric");
  for (let i = 1; i < metrics.length; i++) {
    if (metrics[i].positive !== metrics[i - 1].positive) continue; // the announced turn
    const [prev, here] = [order.indexOf(metrics[i - 1].region!), order.indexOf(metrics[i].region!)];
    assert.ok(here >= prev, `bounced up the face at beat ${i}: ${metrics[i - 1].region}→${metrics[i].region}`);
  }
  // Balance is still there, it just comes from which metrics were chosen.
  assert.ok(metrics.some((b) => b.positive), "no strengths chosen");
  assert.ok(metrics.some((b) => !b.positive), "no weaknesses chosen");
});

test("every spoken measurement carries its number", () => {
  // The whole correction. "Excellent canthal tilt" is an opinion; "a canthal
  // tilt of 6.4 degrees" is a reading, and the difference between those two
  // sentences is the difference between this and a horoscope. A grouping change
  // silently dropped every figure once already, and nothing caught it.
  const beats = buildReelScript(report(SPREAD_OF_METRICS), { name: "Test" });
  for (const b of beats.filter((b) => b.kind === "metric")) {
    assert.match(b.line, /\d/, `no figure in: ${b.line}`);
  }
});

test("no two sentences in a row open the same way", () => {
  // Three consecutive lines beginning "There is also" is what the last version
  // shipped, and it is the single loudest way a generated script announces that
  // it was generated.
  const beats = buildReelScript(report(SPREAD_OF_METRICS), { name: "Test" });
  const opens = beats.filter((b) => b.kind === "metric").map((b) => b.line.split(/\s+/).slice(0, 3).join(" "));
  for (let i = 1; i < opens.length; i++) {
    assert.notEqual(opens[i], opens[i - 1], `repeated opener at beat ${i}: "${opens[i]}"`);
  }
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
  // Immediately before the closing sequence — the search bar, then the sign-off.
  // The point is that it is the last thing SAID about the subject, so nothing
  // about the face may follow it.
  assert.deepEqual(
    beats.slice(index + 1).map((b) => b.kind),
    ["search", "cta"],
    "the disclaimer must land immediately before the closing ask",
  );

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
  // Roughly 206 words a minute plus a beat of air. Twenty words is about six
  // seconds — the number an operator uses to decide how much B-roll to find, so
  // it has to be in the right neighbourhood rather than merely monotonic.
  const twenty = new Array(20).fill("word").join(" ");
  const s = spokenSeconds(twenty);
  assert.ok(s > 5.8 && s < 7.5, `twenty words estimated at ${s.toFixed(1)}s`);
  assert.ok(spokenSeconds(twenty + " more") > s, "a longer line must estimate longer");
});

// ---------------------------------------------------------------------------
// A declined measurement must not block a rundown.
//
// Marlon in a baseball cap: the hairline detector correctly refused to measure
// a forehead it could not see, that refusal was counted as "anatomically
// impossible", and the rundown was blocked and reported as a tilt — of a
// photograph whose measured symmetry was among the best of the set.
// ---------------------------------------------------------------------------
test("a metric that declined to measure does not block a rundown", () => {
  const notable = Array.from({ length: 8 }, (_, i) => ({
    def: { id: `m${i}` },
    value: 1,
    zEff: 1.5,
  }));
  const declined = { def: { id: "foreheadRatio" }, value: Number.NaN, implausible: true };
  const report = { metrics: [...notable, declined] } as unknown as Report;
  assert.deepEqual(reelBlockers(report, 0, 8), []);
});

test("a measurement that was taken and is impossible still blocks", () => {
  const notable = Array.from({ length: 8 }, (_, i) => ({
    def: { id: `m${i}` },
    value: 1,
    zEff: 1.5,
  }));
  const impossible = { def: { id: "gonialProxy" }, value: 300, implausible: true };
  const report = { metrics: [...notable, impossible] } as unknown as Report;
  const blockers = reelBlockers(report, 0, 8);
  assert.equal(blockers.length, 1);
  assert.match(blockers[0], /anatomically impossible/);
});

// ---------------------------------------------------------------------------
// The full name once, the first name after.
//
// How the format is actually read: "How attractive is Timothée Chalamet?" to
// open, and then "Timothée" for the next ninety seconds. Eight repetitions of a
// full name stops sounding like somebody talking about a person and starts
// sounding like a record being read out.
// ---------------------------------------------------------------------------
test("the full name is said once, and only in the hook", () => {
  const beats = buildReelScript(report(SPREAD_OF_METRICS), { name: "Timothée Chalamet" });
  assert.match(beats[0].line, /How attractive is Timothée Chalamet\?/);

  const rest = beats.slice(1).map((b) => b.line).join(" ");
  assert.doesNotMatch(rest, /Chalamet/, `surname repeated after the hook: ${rest}`);
  // And the short form IS used — dropping the name entirely would be the other
  // way to pass the assertion above and is not the same thing at all.
  assert.match(rest, /Timothée/);
});

test("a name that is one word survives being shortened", () => {
  // A mononym has no first word to fall back to, and an empty label under the
  // curve marker is worse than a repeated name.
  const beats = buildReelScript(report(SPREAD_OF_METRICS), { name: "Zendaya" });
  const said = beats.map((b) => b.line).join(" ");
  assert.match(said, /How attractive is Zendaya\?/);
  assert.match(said, /Zendaya has/);
});

test("the short name can be overridden", () => {
  // Somebody universally known by a surname, a stage name, a nickname — the
  // first word is right often enough to be the default and wrong often enough
  // that deriving it silently is not good enough.
  const beats = buildReelScript(report(SPREAD_OF_METRICS), {
    name: "Cristiano Ronaldo",
    shortName: "Ronaldo",
  });
  assert.match(beats[0].line, /How attractive is Cristiano Ronaldo\?/);
  const rest = beats.slice(1).map((b) => b.line).join(" ");
  assert.match(rest, /Ronaldo has/);
  assert.doesNotMatch(rest, /Cristiano/);
});

// ---------------------------------------------------------------------------
// The opening line.
//
// The first two seconds are the whole retention argument, and the default
// question is one framing of several that work. Which one to post is a
// judgement about a subject and an audience, so it is an input.
// ---------------------------------------------------------------------------

test("the default opening asks the default question", () => {
  const beats = buildReelScript(report(SPREAD_OF_METRICS), { name: "Ethan Garcia" });
  assert.equal(beats[0].kind, "hook");
  assert.equal(beats[0].line, "How attractive is Ethan Garcia?");
});

test("an override replaces the question and keeps the name", () => {
  const beats = buildReelScript(report(SPREAD_OF_METRICS), {
    name: "Ethan Garcia",
    opening: "How UNATTRACTIVE is {name}?",
  });
  assert.equal(beats[0].line, "How UNATTRACTIVE is Ethan Garcia?");
});

test("an opening with no placeholder is used verbatim", () => {
  // Some hooks do not want the name in them — "Bro fell off" opens on the face
  // rather than on a question, and forcing a name into it would break the line.
  const beats = buildReelScript(report(SPREAD_OF_METRICS), {
    name: "Ethan Garcia",
    opening: "Bro really fell off.",
  });
  assert.equal(beats[0].line, "Bro really fell off.");
});

test("an empty opening falls back rather than shipping a blank first beat", () => {
  // A rundown that opens on silence has thrown away the two seconds the whole
  // format depends on, and a field left as spaces is indistinguishable from one
  // left alone as far as the person typing is concerned.
  for (const opening of ["", "   ", "\t"]) {
    const beats = buildReelScript(report(SPREAD_OF_METRICS), { name: "Ethan Garcia", opening });
    assert.equal(beats[0].line, "How attractive is Ethan Garcia?", JSON.stringify(opening));
  }
});

test("the name still appears only once, however the opening is written", () => {
  // The reason the hook and the short name are separate inputs at all: a full
  // name repeated through a ninety-second read stops sounding like somebody
  // talking about a person.
  const beats = buildReelScript(report(SPREAD_OF_METRICS), {
    name: "Ethan Garcia",
    opening: "{name}. Is {name} actually good looking?",
  });
  assert.equal(beats[0].line, "Ethan Garcia. Is Ethan Garcia actually good looking?");
  const rest = beats.slice(1).map((b) => b.line).join(" ");
  assert.ok(!rest.includes("Ethan Garcia"), "the full name leaked past the hook");
});

// ---------------------------------------------------------------------------
// The short cut.
// ---------------------------------------------------------------------------

// The same spread with the values the classifier reads set to something real:
// a hunter-band tilt so the eye beat can name the shape.
const SHORT_METRICS = [
  { ...metric("canthalTilt", "eyes", 1.6), value: 8 } as ScoredMetric,
  metric("browTilt", "eyes", -1.4),
  metric("midfaceRatio", "midface", 0.9),
  metric("lipRatio", "lips", 1.1),
  metric("jawCheekRatio", "jaw", -1.9),
  metric("philtrumChinRatio", "chin", 0.7),
  metric("facialIndex", "proportions", -0.6),
];

test("short cut: the voice never says a figure, the badge still carries it", () => {
  const beats = buildReelScript(report(SHORT_METRICS), { name: "Test", cut: "short" });
  for (const b of beats.filter((x) => x.kind === "metric")) {
    assert.doesNotMatch(b.line, /\d/, b.line);
    assert.ok(b.badge, "the on-screen number is the badge");
  }
});

test("short cut: a hunter-band tilt is named as the eye shape", () => {
  const beats = buildReelScript(report(SHORT_METRICS), { name: "Test", cut: "short" });
  const eyes = beats.find((b) => b.kind === "metric" && b.metricId === "canthalTilt");
  assert.ok(eyes);
  assert.match(eyes.line, /hunter eyes/);
});

test("short cut: strengths carry graded adjectives from their own zEff", () => {
  const beats = buildReelScript(report(SHORT_METRICS), { name: "Test", cut: "short" });
  const mid = beats.find((b) => b.kind === "metric" && b.metricId === "midfaceRatio");
  assert.ok(mid);
  // 0.9 sits in the "great" band.
  assert.match(mid.line, /a great|a very strong/);
});

test("short cut: the ending is compressed and the full cut's is not", () => {
  const short = buildReelScript(report(SHORT_METRICS), { name: "Test", cut: "short" });
  const full = buildReelScript(report(SHORT_METRICS), { name: "Test" });
  assert.equal(short.filter((b) => b.kind === "card").length, 2);
  assert.equal(short.filter((b) => b.kind === "curve").length, 1);
  assert.equal(full.filter((b) => b.kind === "card").length, 3);
  assert.equal(full.filter((b) => b.kind === "curve").length, 2);
  // Both keep the signature close: curve, then the search bar, then the ask.
  const shortKinds = short.map((b) => b.kind);
  assert.ok(shortKinds.indexOf("curve") < shortKinds.indexOf("search"));
  assert.equal(shortKinds[shortKinds.length - 1], "cta");
});

test("short cut: the narration is meaningfully shorter than the full cut's", () => {
  const short = buildReelScript(report(SHORT_METRICS), { name: "Test", cut: "short" });
  const full = buildReelScript(report(SHORT_METRICS), { name: "Test" });
  const seconds = (beats: typeof short) =>
    beats.reduce((total, b) => total + spokenSeconds(b.spoken ?? b.line), 0);
  assert.ok(
    seconds(short) < seconds(full) * 0.72,
    `short ${seconds(short).toFixed(1)}s vs full ${seconds(full).toFixed(1)}s`,
  );
});
