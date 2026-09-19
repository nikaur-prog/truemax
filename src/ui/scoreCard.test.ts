import test from "node:test";
import assert from "node:assert/strict";
import { renderScoreCard, scoreCardRank, scoreCardTileRegions } from "./scoreCard.js";
import { aggregateScoreToPercentile } from "../engine/scoring.js";
import type { RegionId, RegionScore, Report } from "../engine/types.js";

const region = (id: RegionId, score: number): RegionScore => ({
  region: id,
  score,
  percentile: 50,
  z: 0,
  metrics: [],
  reliability: 1,
});

const reportWith = (ids: Array<[RegionId, number]>, view: "front" | "side") => ({
  regions: ids.map(([id, score]) => region(id, score)),
  metrics: [{ def: { view } }],
}) as unknown as Pick<Report, "regions" | "metrics">;

test("the card names the correct side of the population", () => {
  assert.equal(scoreCardRank(1), "Bottom 1%");
  assert.equal(scoreCardRank(10), "Bottom 10%");
  // 47 rounds to the honest five-point display precision. At 48/49 the
  // displayed standing is exactly the median and therefore reads Top 50%.
  assert.equal(scoreCardRank(47), "Bottom 45%");
  assert.equal(scoreCardRank(50), "Top 50%");
  assert.equal(scoreCardRank(80), "Top 20%");
  assert.equal(scoreCardRank(95), "Top 5%");
  assert.equal(scoreCardRank(100), "Top 1%");
});

test("a modest score gain is a large rank gain in the middle", () => {
  // The claim the card is built on: the scale is a population curve that is
  // steepest where most people sit, so 0.9 of a point near the median moves
  // rank far more than the number suggests. If this stops being true the card
  // should stop leading with the percentile, so it is asserted rather than
  // assumed.
  const now = aggregateScoreToPercentile(5.4);
  const potential = aggregateScoreToPercentile(6.3);
  assert.ok(potential > now, "potential must rank above current");
  assert.ok(
    potential - now > 15,
    `0.9 of a point near the median moved rank by only ${(potential - now).toFixed(1)} points`,
  );
});

test("rank gain is smaller out in the tail than in the middle", () => {
  // The same 0.9 of a point buys much less once somebody is already rare, which
  // is the honest shape of a curve and the reason the card cannot promise a
  // fixed improvement to everybody.
  const middle = aggregateScoreToPercentile(5.4) - aggregateScoreToPercentile(4.5);
  const tail = aggregateScoreToPercentile(8.4) - aggregateScoreToPercentile(7.5);
  assert.ok(middle > tail, `middle ${middle.toFixed(1)} should exceed tail ${tail.toFixed(1)}`);
});

test("front score cards keep one canonical category set regardless of score order", () => {
  const before = reportWith([
    ["chin", 9.8], ["symmetry", 9.2], ["jaw", 5.8], ["midface", 5],
    ["eyes", 4], ["proportions", 3],
  ], "front");
  const after = reportWith([
    ["proportions", 9.5], ["eyes", 8.6], ["lips", 8.2], ["chin", 7.5],
    ["midface", 4], ["jaw", 3],
  ], "front");

  assert.deepEqual(scoreCardTileRegions(before).map((entry) => entry.region), [
    "proportions", "eyes", "midface", "jaw",
  ]);
  assert.deepEqual(scoreCardTileRegions(after).map((entry) => entry.region), [
    "proportions", "eyes", "midface", "jaw",
  ]);
});

test("profile score cards use the same four profile categories", () => {
  const report = reportWith([
    ["lips", 9], ["proportions", 8], ["nose", 7], ["jaw", 6], ["chin", 5],
  ], "side");
  assert.deepEqual(scoreCardTileRegions(report).map((entry) => entry.region), [
    "jaw", "chin", "nose", "lips",
  ]);
});

test("missing and nonfinite front categories keep their slots instead of borrowing stronger regions", () => {
  const report = reportWith([
    ["nose", 9.8], ["symmetry", 9.7], ["jaw", Number.NaN], ["midface", 5.4], ["eyes", Infinity],
  ], "front");
  assert.deepEqual(scoreCardTileRegions(report), [
    { region: "proportions", score: null },
    { region: "eyes", score: null },
    { region: "midface", score: 5.4 },
    { region: "jaw", score: null },
  ]);
});

test("missing and nonfinite side categories keep their slots when the regions are shuffled", () => {
  const report = reportWith([
    ["lips", -Infinity], ["eyes", 9.8], ["nose", Number.NaN], ["jaw", 7], ["proportions", 9.9],
  ], "side");
  assert.deepEqual(scoreCardTileRegions(report), [
    { region: "jaw", score: 7 },
    { region: "chin", score: null },
    { region: "nose", score: null },
    { region: "lips", score: null },
  ]);
});

test("a completely unavailable report still has four named slots", () => {
  assert.deepEqual(scoreCardTileRegions({ regions: [], metrics: [] }), [
    { region: "proportions", score: null },
    { region: "eyes", score: null },
    { region: "midface", score: null },
    { region: "jaw", score: null },
  ]);
  assert.deepEqual(scoreCardTileRegions(reportWith([], "side")).map((tile) => tile.region), [
    "jaw", "chin", "nose", "lips",
  ]);
});

test("merged reports retain the front layout and a real finite zero is not missing", () => {
  const report = reportWith([["proportions", 0], ["lips", 9.9]], "side");
  const merged = { ...report, metrics: [...report.metrics, ...reportWith([], "front").metrics] };
  assert.deepEqual(scoreCardTileRegions(merged), [
    { region: "proportions", score: 0 },
    { region: "eyes", score: null },
    { region: "midface", score: null },
    { region: "jaw", score: null },
  ]);
});

function recordingCanvas() {
  const text: Array<{ value: string; x: number; y: number }> = [];
  const rectangles: number[][] = [];
  const finite = (...numbers: number[]) => {
    assert.ok(numbers.every(Number.isFinite), `canvas coordinates must be finite: ${numbers.join(", ")}`);
  };
  const ctx = {
    save() {}, restore() {}, beginPath() {}, fill() {}, stroke() {}, clip() {},
    fillRect: finite,
    arc: finite,
    roundRect(...args: number[]) { finite(...args); rectangles.push(args); },
    createRadialGradient(...args: number[]) {
      finite(...args);
      return { addColorStop(offset: number) { finite(offset); } };
    },
    drawImage(_image: unknown, ...args: number[]) { finite(...args); },
    fillText(value: string, x: number, y: number) {
      finite(x, y);
      assert.doesNotMatch(value, /NaN|Infinity|undefined|null/);
      text.push({ value, x, y });
    },
    measureText(value: string) { return { width: value.length * 18 }; },
  } as unknown as CanvasRenderingContext2D;
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, text, rectangles };
}

for (const view of ["front", "side"] as const) {
  test(`${view} card renders unavailable labels in fixed positions without invalid canvas draws`, async (t) => {
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { fonts: { load: async () => [], ready: Promise.resolve() } },
    });
    t.after(() => {
      if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
      else Reflect.deleteProperty(globalThis, "document");
    });
    const partial = view === "front"
      ? reportWith([["nose", 9.8], ["midface", 5.4], ["eyes", Infinity], ["jaw", Number.NaN]], view)
      : reportWith([["lips", -Infinity], ["jaw", 7], ["nose", Number.NaN], ["symmetry", 9.8]], view);
    const report = {
      ...partial, sex: "male", overall: 6.1, overallPercentile: 80, overallZ: 0.5, potential: 6.9,
      pillars: { Harmony: 6, Angularity: 6, Dimorphism: 6, Features: 6 }, zScores: {},
    } as Report;
    const { canvas, text, rectangles } = recordingCanvas();
    await renderScoreCard(canvas, { width: 500, height: 500 } as HTMLCanvasElement,
      [{ x: 0.25, y: 0.2, z: 0, visibility: 1 }, { x: 0.75, y: 0.8, z: 0, visibility: 1 }],
      { report, ...(view === "side" ? { previousOverall: 4.2 } : {}) });

    assert.equal(canvas.width, 1080);
    assert.equal(canvas.height, 1920);
    const labels = text.filter((draw) => draw.y === 1232 || draw.y === 1450);
    assert.deepEqual(labels.map((draw) => draw.value), view === "front"
      ? ["PROPORTIONS", "EYES", "MIDFACE", "JAW"]
      : ["JAW", "CHIN", "NOSE", "LIPS"]);
    assert.deepEqual(labels.map(({ x, y }) => [x, y]), [[128, 1232], [586, 1232], [128, 1450], [586, 1450]]);
    const scores = text.filter((draw) => draw.y === 1306 || draw.y === 1524);
    assert.deepEqual(scores.map((draw) => draw.value), view === "front"
      ? ["Not measured", "Not measured", "5.4", "Not measured"]
      : ["7.0", "Not measured", "Not measured", "Not measured"]);
    assert.equal(rectangles.filter(([, , , height]) => height === 8).length, 2,
      "only the one measured category gets a background and a filled score bar");
    assert.deepEqual(text.filter((draw) => draw.y === 830).map((draw) => draw.value), view === "front"
      ? ["NOW", "POTENTIAL"] : ["BEFORE", "NOW"]);
    assert.deepEqual(text.filter((draw) => draw.y === 946 && draw.value !== "/10").map((draw) => draw.value), view === "front"
      ? ["6.1", "6.9"] : ["4.2", "6.1"]);
  });
}
