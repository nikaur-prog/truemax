import test from "node:test";
import assert from "node:assert/strict";
import { contextFromStoredScan, storedMovement } from "./maxContext.js";

// The dashboard chat is built from the stored row, not from nothing. What the
// row carries goes; what it does not carry is left empty rather than
// invented, and the server's context block names the gap.
const latest = {
  sex: "male" as const,
  date: "2026-09-01T10:00:00.000Z",
  overall: 6.44,
  overallPercentile: 71.6,
  pillars: { Harmony: 6.2, Skin: 7.15 },
  regionPercentiles: { eyes: 80.4, jaw: 33.2 },
  potential: 7.31,
};

test("the stored row becomes a context Max can read", () => {
  const ctx = contextFromStoredScan({ latest, tone: "polite", scans: 4, includePotential: true });
  assert.equal(ctx.sex, "male");
  assert.equal(ctx.overall, 6.4);
  assert.equal(ctx.percentile, 72);
  assert.equal(ctx.potential, 7.3);
  assert.deepEqual(ctx.pillars, [{ label: "Harmony", score: 6.2 }, { label: "Skin", score: 7.2 }]);
  assert.deepEqual(ctx.regions.map((r) => r.percentile), [80, 33]);
  assert.equal(ctx.regions[0]?.label, "Eyes");
  assert.deepEqual(ctx.measurements, []);
  assert.deepEqual(ctx.focus, []);
  assert.equal(ctx.scans, 4);
  assert.equal(ctx.movement, undefined);
});

test("the ceiling only travels when the account can see it", () => {
  const ctx = contextFromStoredScan({ latest, tone: "blunt", scans: 1, includePotential: false });
  assert.equal(ctx.potential, undefined);
});

test("a row from before the percentile fields still opens a chat", () => {
  const old = { sex: "female" as const, date: "2025-01-01T00:00:00.000Z", overall: 5.5 };
  const ctx = contextFromStoredScan({ latest: old, tone: "polite", scans: 1, includePotential: true });
  assert.equal(ctx.percentile, 50);
  assert.deepEqual(ctx.pillars, []);
  assert.deepEqual(ctx.regions, []);
});

test("movement between two rows reads the noise floor, not the sign", () => {
  const previous = { ...latest, date: "2026-08-01T10:00:00.000Z", overall: 6.1 };
  const now = Date.parse("2026-09-03T10:00:00.000Z");
  const moved = storedMovement(latest, previous, now) ?? "";
  assert.match(moved, /^0\.3 up between the last two scans \(31 days apart, the latest 2 days ago\): inside the spread/);
  const jumped = storedMovement({ ...latest, overall: 7.2 }, { ...previous, date: "2026-08-31T10:00:00.000Z" }, now) ?? "";
  assert.match(jumped, /too short a gap/);
  const real = storedMovement({ ...latest, overall: 7.2 }, previous, now) ?? "";
  assert.match(real, /outside normal capture spread/);
  assert.equal(storedMovement(latest, { ...previous, date: "nonsense" }, now), undefined);
});
