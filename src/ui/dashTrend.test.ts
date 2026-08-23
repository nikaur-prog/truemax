import test from "node:test";
import assert from "node:assert/strict";
import { trend } from "./dashTrend.js";
import { DISPLAY_NOISE } from "../engine/history.js";
import type { StoredScan } from "../engine/history.js";

// readAllComparableHistory hands scans back NEWEST FIRST, and everything here
// depends on that, so the fixtures are built the same way round.
function scans(...overall: number[]): StoredScan[] {
  return overall.map((v, i) => ({
    scanId: `s${i}`,
    date: new Date(Date.UTC(2026, 7, 20 - i)).toISOString(),
    sex: "male" as const,
    overall: v,
    regions: {},
    scoreVersion: 2,
  }));
}

function bandRange(svg: string): [number, number] {
  const m = /<rect class="spark-band" x="0" y="([\d.]+)"[^>]*height="([\d.]+)"/.exec(svg);
  assert.ok(m, "no band drawn");
  const y = Number(m![1]);
  return [y, y + Number(m![2])];
}

function pathYs(svg: string): number[] {
  const m = /<path class="spark-line" d="([^"]+)"/.exec(svg);
  assert.ok(m, "no line drawn");
  return [...m![1].matchAll(/[ML] [\d.]+ ([\d.]+)/g)].map((x) => Number(x[1]));
}

test("the delta is the latest scan against the mean of the ones before it", () => {
  // Newest 6.0; the three before it average 5.0.
  const t = trend(scans(6.0, 5.2, 5.0, 4.8));
  assert.ok(t);
  assert.equal(Math.round(t!.delta! * 100) / 100, 1);
  assert.equal(t!.withinNoise, false);
  assert.equal(Math.round(t!.average * 100) / 100, 5.25);
});

test("a first scan has no delta to report", () => {
  const t = trend(scans(5.4));
  assert.ok(t);
  assert.equal(t!.delta, null);
  assert.equal(t!.withinNoise, false);
  assert.equal(t!.average, 5.4);
});

test("a move smaller than the instrument can resolve is flagged as noise", () => {
  const t = trend(scans(5.0 + DISPLAY_NOISE * 0.5, 5.0, 5.0, 5.0));
  assert.ok(t);
  assert.equal(t!.withinNoise, true);
  const u = trend(scans(5.0 + DISPLAY_NOISE * 1.5, 5.0, 5.0, 5.0));
  assert.equal(u!.withinNoise, false);
});

test("a flat run is drawn flat — the axis is never fitted to the data", () => {
  // THE test for this module. Auto-zooming the vertical axis to whatever range
  // the points happen to span is how a run that has not moved gets rendered as
  // a mountain, and on an instrument with this much photo-to-photo spread that
  // would be the app agreeing that noise is progress. Every point of a run
  // tighter than the noise band must therefore stay INSIDE the band.
  const t = trend(scans(5.05, 4.98, 5.02, 4.96, 5.04));
  assert.ok(t);
  const [top, bottom] = bandRange(t!.svg);
  for (const y of pathYs(t!.svg)) {
    assert.ok(y >= top && y <= bottom, `a point at y=${y} escaped the band ${top}..${bottom}`);
  }
});

test("a real move breaks out of the band", () => {
  // The other half of the same property: the band must not be so generous that
  // nothing can ever clear it.
  const t = trend(scans(6.6, 5.0, 5.0, 5.0, 5.0));
  assert.ok(t);
  const [top, bottom] = bandRange(t!.svg);
  const ys = pathYs(t!.svg);
  assert.ok(ys.some((y) => y < top || y > bottom), "no point cleared the band");
});

test("nothing is drawn for a device with no comparable scans", () => {
  assert.equal(trend([]), null);
});
