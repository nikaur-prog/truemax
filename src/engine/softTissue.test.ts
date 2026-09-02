import test from "node:test";
import assert from "node:assert/strict";
import { LM } from "./geometry.js";
import {
  SOFT_TISSUE_ORDER,
  softTissueFromLandmarks,
  softTissueRows,
  softTissueSentence,
  softTissueValues,
} from "./softTissue.js";
import type { Report, ScoredMetric } from "./types.js";

function landmarks(overrides: Record<number, { x: number; y: number }>) {
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  for (const [i, p] of Object.entries(overrides)) lm[+i] = { ...p, z: 0, visibility: 1 };
  return lm;
}

test("lower face width is the mid-cheek silhouette over the cheekbone silhouette", () => {
  const lm = landmarks({
    [LM.ZYGION_R]: { x: 0.2, y: 0.4 },
    [LM.ZYGION_L]: { x: 0.8, y: 0.4 },
    [LM.CHEEK_MID_R]: { x: 0.26, y: 0.55 },
    [LM.CHEEK_MID_L]: { x: 0.74, y: 0.55 },
  });
  const out = softTissueFromLandmarks(lm, 1000, 1000);
  assert.ok(out);
  assert.ok(Math.abs(out!.lowerFaceWidthRatio - 0.8) < 1e-3, String(out!.lowerFaceWidthRatio));
});

test("a mid cheek wider than the cheekbones by a fifth is a misplaced landmark, not a face", () => {
  const lm = landmarks({
    [LM.ZYGION_R]: { x: 0.3, y: 0.4 },
    [LM.ZYGION_L]: { x: 0.7, y: 0.4 },
    [LM.CHEEK_MID_R]: { x: 0.05, y: 0.55 },
    [LM.CHEEK_MID_L]: { x: 0.95, y: 0.55 },
  });
  assert.equal(softTissueFromLandmarks(lm, 1000, 1000), null);
});

function fakeReport(values: Record<string, number>, extras?: { lowerFaceWidthRatio: number }): Report {
  const metrics = Object.entries(values).map(([id, value]) => ({
    def: { id, name: id, unit: "", decimals: 2 } as ScoredMetric["def"],
    value,
    z: 0, zEff: 0, percentile: 50, markerPct: 50, score: 5, conformance: 1,
  })) as unknown as ScoredMetric[];
  return {
    sex: "male", overall: 5, overallPercentile: 50, overallZ: 0, potential: 5,
    pillars: {} as Report["pillars"], regions: [], metrics, zScores: {},
    ...(extras ? { softTissue: extras } : {}),
  };
}

test("rows follow the published order, carry deltas, and say when a move is inside noise", () => {
  const report = fakeReport(
    { cheekFullness: 2.4, jawCheekRatio: 0.86, chinWidthRatio: 0.41, submentalCervical: 104.2 },
    { lowerFaceWidthRatio: 0.83 },
  );
  const previous = { cheekFullness: 3.3, jawCheekRatio: 0.85, lowerFaceWidthRatio: 0.9, submentalCervical: 100.1 };
  const rows = softTissueRows(report, previous);
  assert.deepEqual(rows.map((r) => r.id), [...SOFT_TISSUE_ORDER]);
  const cheek = rows.find((r) => r.id === "cheekFullness")!;
  assert.equal(cheek.delta, -0.9);
  assert.equal(cheek.moved, true);
  const jaw = rows.find((r) => r.id === "jawCheekRatio")!;
  assert.equal(jaw.moved, false);
  const chin = rows.find((r) => r.id === "chinWidthRatio")!;
  assert.equal(chin.delta, undefined);
  const lower = rows.find((r) => r.id === "lowerFaceWidthRatio")!;
  assert.equal(lower.indicative, true, "a measurement with no corpus figure wears the indicative flag");
  assert.deepEqual(Object.keys(softTissueValues(report)).sort(), [...SOFT_TISSUE_ORDER].sort());
});

test("the sentence names what moved, in units, and never names fat or a percentage of the person", () => {
  const report = fakeReport({ cheekFullness: 2.4, jawCheekRatio: 0.86 }, { lowerFaceWidthRatio: 0.83 });
  const rows = softTissueRows(report, { cheekFullness: 3.3, jawCheekRatio: 0.85, lowerFaceWidthRatio: 0.83 });
  const s = softTissueSentence(rows, 21);
  assert.match(s, /21 days ago/);
  assert.match(s, /cheek fullness from 3\.3 to 2\.4/);
  assert.match(s, /within capture variance/);
  assert.ok(!/\bfat\b|body fat|percent|%/i.test(s), s);
  assert.ok(!s.includes("—"), "no em dash");
  assert.equal(softTissueSentence(softTissueRows(report, null)), "");
});

test("a flat rescan says so instead of printing zeros", () => {
  const report = fakeReport({ cheekFullness: 2.4 });
  const s = softTissueSentence(softTissueRows(report, { cheekFullness: 2.5 }));
  assert.match(s, /^Nothing in this group moved outside capture variance/);
});
