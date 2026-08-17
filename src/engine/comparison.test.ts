import test from "node:test";
import assert from "node:assert/strict";
import { MOVE_MIN, moveLabel, regionMoves } from "./comparison.js";
import type { Report, RegionScore } from "./types.js";

const region = (name: RegionScore["region"], score: number): RegionScore =>
  ({ region: name, score, reliability: 1 }) as RegionScore;

const report = (regions: RegionScore[]): Report =>
  ({
    sex: "male",
    overall: 5,
    overallPercentile: 50,
    overallZ: 0,
    potential: 6,
    pillars: { Harmony: 5, Angularity: 5, Dimorphism: 5, Features: 5 },
    regions,
    metrics: [],
    zScores: {},
  }) as Report;

test("regions are joined by name, never by position", () => {
  // The bug this function exists to make impossible. The grid sorts by score,
  // so a face whose ranking changed between the two scans would, under a
  // positional zip, have its jaw differenced against its midface — and the
  // table would look entirely reasonable while being about nothing.
  const before = report([region("eyes", 8), region("jaw", 4)]);
  const after = report([region("jaw", 9), region("eyes", 7)]);

  const moves = regionMoves(before, after);
  const jaw = moves.find((m) => m.region === "jaw")!;
  const eyes = moves.find((m) => m.region === "eyes")!;
  assert.equal(jaw.before, 4);
  assert.equal(jaw.after, 9);
  assert.equal(eyes.before, 8);
  assert.equal(eyes.after, 7);
});

test("a drop is never rendered as a rise", () => {
  // The one error that would make this tool untrustworthy to the person using
  // it, and a rescan going down is a real outcome rather than a hypothetical.
  const moves = regionMoves(report([region("jaw", 7)]), report([region("jaw", 5)]));
  assert.equal(moves[0].direction, "down");
  assert.equal(moves[0].delta, -2);
  assert.equal(moveLabel(moves[0]), "−2.0");
});

test("a rise reads as a rise", () => {
  const moves = regionMoves(report([region("jaw", 5)]), report([region("jaw", 7)]));
  assert.equal(moves[0].direction, "up");
  assert.equal(moveLabel(moves[0]), "+2.0");
});

test("movement inside the engine's own noise is not coloured as movement", () => {
  // Two photographs of one unchanged face differ by about this much. Painting
  // that green would be inventing the only result anybody reads off a
  // before/after.
  for (const delta of [MOVE_MIN, MOVE_MIN - 0.01, 0, -MOVE_MIN]) {
    const moves = regionMoves(report([region("jaw", 5)]), report([region("jaw", 5 + delta)]));
    assert.equal(moves[0].direction, "flat", `${delta} was called movement`);
  }
  // And just past it is.
  assert.equal(regionMoves(report([region("jaw", 5)]), report([region("jaw", 5.2)]))[0].direction, "up");
});

test("the figure is still shown even when it is too small to colour", () => {
  // Hiding it would overstate the ones that remain: a table where only the
  // movers have numbers reads as though everything else was unmeasured.
  const moves = regionMoves(report([region("jaw", 5)]), report([region("jaw", 5.1)]));
  assert.equal(moves[0].direction, "flat");
  assert.equal(moveLabel(moves[0]), "+0.1");
});

test("a region the before scan never had reads as unknown, not as zero", () => {
  // A missing before is not a before of 0.0, and differencing against one would
  // print a spectacular fake gain on a region that was simply never measured.
  const moves = regionMoves(report([region("eyes", 6)]), report([region("eyes", 6), region("jaw", 7)]));
  const jaw = moves.find((m) => m.region === "jaw")!;
  assert.equal(jaw.before, null);
  assert.equal(jaw.delta, null);
  assert.equal(jaw.direction, "flat");
  assert.equal(moveLabel(jaw), "—");
});

test("the rows come back in the after's ranking order", () => {
  // So the table lines up with the grid underneath it rather than presenting a
  // second, differently sorted, version of the same eight regions.
  const after = report([region("eyes", 4), region("jaw", 9), region("nose", 6)]);
  const moves = regionMoves(report([]), after);
  assert.deepEqual(
    moves.map((m) => m.region),
    ["jaw", "nose", "eyes"],
  );
});
