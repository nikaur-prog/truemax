import test from "node:test";
import assert from "node:assert/strict";
import { READ_EXCLUDED, READ_TABLE, metricRead } from "./metricReads.js";
import { METRICS, distFor } from "./metrics.js";
import { SIDE_METRICS } from "./sideMetrics.js";
import type { ScoredMetric } from "./types.js";

// ---------------------------------------------------------------------------
// The read table's guarantees, held mechanically.
//
// This table is prose keyed by id, which is exactly the shape that rots: a
// metric gets renamed and its lines silently stop appearing, or an entry is
// written for an id that no longer exists and nobody notices either way. And
// because the lines are interpretation, they carry the one risk the rest of
// the product does not — saying something ABOUT a person that the geometry
// does not support. Both are pinned here.
// ---------------------------------------------------------------------------

const ALL = [...METRICS, ...SIDE_METRICS];

test("every metric has a read, or an exclusion with its reason on record", () => {
  for (const def of ALL) {
    const has = def.id in READ_TABLE;
    const excluded = READ_EXCLUDED.has(def.id);
    assert.ok(
      has !== excluded,
      `${def.id}: ${has && excluded ? "both a read and an exclusion" : "neither a read nor an exclusion"}`,
    );
    if (has) {
      const r = READ_TABLE[def.id];
      assert.ok(r.high.length > 20 && r.low.length > 20, `${def.id}: a side is a stub`);
      assert.notEqual(r.high, r.low, `${def.id}: both sides say the same thing`);
    }
  }
});

test("no entry is written for a metric that does not exist", () => {
  const ids = new Set(ALL.map((d) => d.id));
  for (const id of Object.keys(READ_TABLE)) {
    assert.ok(ids.has(id), `read table carries "${id}", which no metric declares`);
  }
});

test("the lines describe geometry, never a person's worth or health", () => {
  // The vocabulary ban is blunt on purpose: any of these words in a line about
  // somebody's face is a sentence this product must not produce, whatever the
  // surrounding grammar was trying to do.
  const banned = /\b(ugly|unattractive|deform|defect|syndrome|disorder|disease|abnormal|wrong|bad|failed)\b/i;
  for (const [id, r] of Object.entries(READ_TABLE)) {
    for (const side of [r.high, r.low]) {
      assert.ok(!banned.test(side), `${id}: "${side}" uses banned vocabulary`);
    }
  }
});

const scored = (id: string, value: number): ScoredMetric => {
  const def = ALL.find((d) => d.id === id)!;
  return {
    def,
    value,
    zEff: 0,
    percentile: 50,
    conformance: 0.5,
    implausible: false,
  } as unknown as ScoredMetric;
};

test("a lean is only claimed when the value actually leans", () => {
  const d = distFor(ALL.find((m) => m.id === "gonialAngle")!, "male");
  // Dead on the mean: silence, not a manufactured trait.
  assert.equal(metricRead(scored("gonialAngle", d.mean), "male"), null);
  assert.equal(metricRead(scored("gonialAngle", d.mean + 0.4 * d.sd), "male"), null);
  // A real lean: the matching side, and only that side.
  const high = metricRead(scored("gonialAngle", d.mean + 1.2 * d.sd), "male");
  const low = metricRead(scored("gonialAngle", d.mean - 1.2 * d.sd), "male");
  assert.equal(high, READ_TABLE.gonialAngle.high);
  assert.equal(low, READ_TABLE.gonialAngle.low);
});

test("a refused measurement gets no read at all", () => {
  const m = scored("gonialAngle", 200);
  (m as { implausible: boolean }).implausible = true;
  assert.equal(metricRead(m, "male"), null);
  assert.equal(metricRead(scored("foreheadRatio", Number.NaN), "male"), null);
  // The excluded convention stays silent even at a strong lean.
  const d = distFor(ALL.find((x) => x.id === "browTilt")!, "male");
  assert.equal(metricRead(scored("browTilt", d.mean + 3 * d.sd), "male"), null);
});
