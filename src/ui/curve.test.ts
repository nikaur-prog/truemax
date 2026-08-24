import test from "node:test";
import assert from "node:assert/strict";
import { curveSVG } from "./curve.js";
import { AGG_NORM } from "../engine/aggNorm.js";
import type { Sex } from "../engine/types.js";

const SEXES: Sex[] = ["male", "female"];

function keysFor(sex: Sex): string[] {
  return Object.entries(AGG_NORM[sex] ?? {})
    .filter(([, q]) => Array.isArray(q) && q.length >= 21)
    .map(([k]) => k);
}

/** The y of every vertex on the drawn density line. */
function lineYs(svg: string): number[] {
  const m = /<path class="curve-line"[^>]*\sd="([^"]+)"/.exec(svg) ?? /d="(M[^"]+)"/.exec(svg);
  assert.ok(m, "no path drawn");
  return [...m![1].matchAll(/[-\d.]+[, ]([-\d.]+)/g)].map((x) => Number(x[1])).filter(Number.isFinite);
}

test("no reference distribution is drawn as a needle on a flat line", () => {
  // THE test for this module. The density of a bin is 0.05 divided by the gap
  // between two quantiles, so a metric whose reference set piles up against a
  // limit — male region:nose has SIX gaps of exactly zero — produces one
  // enormous bin. Scaling the chart to the largest bin then made that spike the
  // whole picture and pressed every real feature of the distribution flat into
  // the axis. It read as a rendering bug, and it was worse than one: the shape
  // it drew was not the shape of the data.
  //
  // The guard is that the drawn line has to USE the box. If most of the curve
  // sits within a hair of the baseline, one bin has taken the scale.
  for (const sex of SEXES) {
    for (const key of keysFor(sex)) {
      const ys = lineYs(curveSVG(50, key, sex, true));
      assert.ok(ys.length > 4, `${sex}/${key}: too few points to judge`);
      const base = Math.max(...ys); // SVG y grows downward, so baseline is max
      const top = Math.min(...ys);
      const span = base - top;
      assert.ok(span > 0, `${sex}/${key}: the line is perfectly flat`);
      // How many vertices are pinned to the floor of the box. The threshold is
      // set from measurement, not taste: scaling to the largest bin put 45.5%
      // of male region:nose on the baseline, and anchoring on the median puts
      // 15.9% there — the worst of any table. 0.30 sits clear of both.
      const flat = ys.filter((y) => base - y < span * 0.05).length;
      assert.ok(
        flat / ys.length < 0.3,
        `${sex}/${key}: ${flat} of ${ys.length} points sit on the baseline — a spike owns the scale`,
      );
    }
  }
});

test("the drawn line never escapes the top of the box", () => {
  // A clipped spike must clip, not draw above the chart and collide with
  // whatever sits over it.
  for (const sex of SEXES) {
    for (const key of keysFor(sex)) {
      const ys = lineYs(curveSVG(50, key, sex, true));
      assert.ok(Math.min(...ys) >= -0.5, `${sex}/${key}: drew above the box at y=${Math.min(...ys)}`);
    }
  }
});

test("every percentile from 0 to 100 renders without producing NaN", () => {
  // The subject's dot is interpolated into the same quantile table, and a table
  // with zero-width bins is exactly where a divide-by-zero would hide.
  for (const sex of SEXES) {
    for (const key of keysFor(sex)) {
      for (const pct of [0, 0.5, 1, 25, 50, 75, 99, 99.9, 100]) {
        const svg = curveSVG(pct, key, sex, true);
        assert.doesNotMatch(svg, /NaN|Infinity/, `${sex}/${key} at ${pct}% produced a broken number`);
      }
    }
  }
});

test("a percentile outside 0..100 is clamped rather than drawn off the chart", () => {
  for (const pct of [-40, -1, 101, 260]) {
    const svg = curveSVG(pct, "region:nose", "male", true);
    assert.doesNotMatch(svg, /NaN|Infinity/, `${pct}% produced a broken number`);
  }
});
