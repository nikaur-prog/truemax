import { DISPLAY_NOISE } from "../engine/history.js";
import type { StoredScan } from "../engine/history.js";

// ---------------------------------------------------------------------------
// The compact trend, for the top of the dashboard.
//
// The full chart in the history view already exists and is not what belongs
// here: this one has to survive being 60px tall next to a large number, and it
// has to be readable in the half second somebody spends on it before deciding
// whether to scan again.
//
// It keeps the one thing that chart does that matters, which is the noise band.
// A line joining weekly dots invites the eye to read every wiggle as progress,
// and on this instrument most of the wiggle is the camera. The band is drawn
// first and the line sits inside it, so "nothing has happened" looks like
// nothing having happened rather than like a jagged ascent.
//
// The vertical scale is NOT fitted to the data. It is the band, widened only
// far enough to contain the points, and the band is a fixed number of score
// points. Fitting the axis to the range is how a flat run gets drawn as a
// mountain, and this is the module where that temptation lives.
// ---------------------------------------------------------------------------

const W = 320;
const H = 68;
const PAD_X = 6;
const PAD_Y = 8;

export interface Trend {
  svg: string;
  /** Latest minus the mean of everything before it; null on a first scan. */
  delta: number | null;
  /** True when that delta is smaller than the instrument can resolve. */
  withinNoise: boolean;
  average: number;
}

export function trend(scans: StoredScan[]): Trend | null {
  if (!scans.length) return null;
  // readAllComparableHistory hands these back newest first.
  const points = [...scans].reverse().map((s) => s.overall);
  const average = points.reduce((a, b) => a + b, 0) / points.length;
  const prior = points.slice(0, -1);
  const delta =
    prior.length === 0
      ? null
      : points[points.length - 1] - prior.reduce((a, b) => a + b, 0) / prior.length;
  const withinNoise = delta !== null && Math.abs(delta) < DISPLAY_NOISE;

  return { svg: sparkline(points, average), delta, withinNoise, average };
}

function sparkline(points: number[], average: number): string {
  const n = points.length;
  // The visible window is the noise band, opened up only as far as the data
  // forces. Anything inside the band is a photograph, not a face.
  const half = Math.max(
    DISPLAY_NOISE,
    ...points.map((p) => Math.abs(p - average)),
  ) * 1.15;
  const lo = average - half;
  const hi = average + half;
  const xAt = (i: number) => PAD_X + (n === 1 ? (W - 2 * PAD_X) / 2 : (i / (n - 1)) * (W - 2 * PAD_X));
  const yAt = (v: number) => PAD_Y + (1 - (v - lo) / (hi - lo)) * (H - 2 * PAD_Y);

  const bandTop = yAt(average + DISPLAY_NOISE / 2);
  const bandBottom = yAt(average - DISPLAY_NOISE / 2);
  const path = points.map((p, i) => `${i ? "L" : "M"} ${xAt(i).toFixed(1)} ${yAt(p).toFixed(1)}`).join(" ");

  const dots = points
    .map((p, i) => {
      const last = i === n - 1;
      return `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(p).toFixed(1)}" r="${last ? 4.2 : 2.4}"
        class="${last ? "spark-now" : "spark-dot"}" />`;
    })
    .join("");

  // Scaled uniformly, not stretched to the container's width. `none` would fill
  // the space, at the cost of turning every dot into an ellipse whose flattening
  // depends on how wide the screen happens to be; the container carries a
  // matching aspect-ratio instead, so this fills the width honestly.
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img"
      aria-label="Your last ${n} scans, against a band of camera noise">
    <rect class="spark-band" x="0" y="${bandTop.toFixed(1)}" width="${W}"
      height="${Math.max(2, bandBottom - bandTop).toFixed(1)}" rx="3" />
    <path class="spark-line" d="${path}" />
    ${dots}
  </svg>`;
}
