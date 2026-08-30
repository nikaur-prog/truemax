import test from "node:test";
import assert from "node:assert/strict";
import { PILLAR_BLURB, pillarDeck } from "./pillarDeck.js";
import { REGION_RELIABLE_MIN } from "../engine/scoring.js";
import { reliabilityOf } from "../engine/reliability.js";
import { METRICS } from "../engine/metrics.js";
import { SIDE_METRICS } from "../engine/sideMetrics.js";
import type { PillarId, RegionId, Report, ScoredMetric } from "../engine/types.js";

// Real MetricDefs throughout: the deck's whole job is to gather the
// measurements that actually build a pillar, so a test built on invented ids
// would be asserting about nothing.
function metric(id: string, value = 1.23): ScoredMetric {
  const def = [...METRICS, ...SIDE_METRICS].find((m) => m.id === id);
  assert.ok(def, `no such metric: ${id}`);
  return {
    def,
    value,
    z: 0,
    zEff: 0,
    percentile: 50,
    markerPct: 50,
    score: 5,
    conformance: 0.5,
    idealRange: [0, 2],
  };
}

function region(id: RegionId, ids: string[], reliability = 0.6) {
  return { region: id, score: 5, percentile: 50, z: 0, reliability, metrics: ids.map((i) => metric(i)) };
}

function report(regions: ReturnType<typeof region>[]): Report {
  return {
    sex: "male",
    overall: 5,
    overallPercentile: 50,
    overallZ: 0,
    potential: 6,
    pillars: { Harmony: 5, Angularity: 5, Dimorphism: 5, Features: 5 },
    regions,
    metrics: regions.flatMap((r) => r.metrics),
    zScores: {},
  };
}

const pillarOf = (id: string) => [...METRICS, ...SIDE_METRICS].find((m) => m.id === id)!.pillar;

test("the deck holds exactly the measurements that build that pillar", () => {
  const ids = ["browTilt", "canthalTilt", "jawCheekRatio", "lipRatio", "midfaceRatio"];
  const r = report([
    region("eyes", ["browTilt", "canthalTilt"]),
    region("jaw", ["jawCheekRatio"]),
    region("lips", ["lipRatio"]),
    region("midface", ["midfaceRatio"]),
  ]);
  for (const p of ["Harmony", "Angularity", "Dimorphism", "Features"] as PillarId[]) {
    const deck = pillarDeck(r, p).map((m) => m.def.id);
    assert.deepEqual(new Set(deck), new Set(ids.filter((id) => pillarOf(id) === p)));
  }
});

test("the deck crosses regions, because a pillar does", () => {
  // The reason the detail card had to stop taking one region for the whole
  // deck. Angularity is carried by the jaw and the cheekbones at once.
  const r = report([region("jaw", ["jawCheekRatio"]), region("midface", ["cheekboneHeight"])]);
  const deck = pillarDeck(r, "Angularity");
  assert.ok(deck.length >= 2, `only ${deck.length} in the deck`);
  assert.ok(new Set(deck.map((m) => m.def.region)).size >= 2, "deck did not cross a region boundary");
});

test("a region the report refuses to score contributes nothing to any pillar", () => {
  // Same bar the region header and the scan pass use. The nose fails it in
  // production; letting its measurements in through the pillar door would be
  // the report showing what it just declined to score.
  const unscored = region("nose", ["nasalIndex"], REGION_RELIABLE_MIN - 0.01);
  const r = report([region("lips", ["lipRatio"]), unscored]);
  const all = (["Harmony", "Angularity", "Dimorphism", "Features"] as PillarId[]).flatMap((p) =>
    pillarDeck(r, p).map((m) => m.def.id),
  );
  assert.ok(!all.includes("nasalIndex"), "an unscored region's measurement reached a pillar deck");
});

test("an unmeasured metric is not in the deck", () => {
  // The card steps through what it is given and draws each one. A non-finite
  // value has no construction to draw and no position to state.
  const r = report([region("eyes", ["browTilt", "canthalTilt"])]);
  r.regions[0].metrics[0].value = Number.NaN;
  const deck = pillarDeck(r, pillarOf("browTilt")).map((m) => m.def.id);
  assert.ok(!deck.includes("browTilt"));
});

test("the deck leads with the measurement that moved the number most", () => {
  // Effective weight — weight x reliability — which is the quantity scoring.ts
  // actually multiplies by. Ordering on the declared weight alone would open
  // the deck on a measurement whose reliability is 0.00, i.e. the one that
  // contributed least of all.
  const ids = ["browTilt", "canthalTilt", "browPosition", "eyeAspectRatio"];
  const r = report([region("eyes", ids)]);
  for (const p of ["Harmony", "Angularity", "Dimorphism", "Features"] as PillarId[]) {
    const deck = pillarDeck(r, p);
    const eff = deck.map((m) => m.def.weight * reliabilityOf(m.def.id));
    assert.deepEqual(eff, [...eff].sort((a, b) => b - a), `${p} deck is not in effective-weight order`);
  }
});

test("every pillar has copy, and none of it congratulates", () => {
  // Dimorphism is the one this exists for: the word reads as a compliment and
  // the measurement is a distance from the middle of the two sexes.
  for (const p of ["Harmony", "Angularity", "Dimorphism", "Features"] as PillarId[]) {
    const text = PILLAR_BLURB[p];
    assert.ok(text && text.length > 40, `${p} has no blurb`);
    assert.doesNotMatch(text, /attractive|handsome|beautiful/i, `${p} blurb pays a compliment`);
    assert.doesNotMatch(text, /—/, `${p} blurb uses an em dash`);
  }
});
