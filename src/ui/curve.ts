import { AGG_NORM } from "../engine/aggNorm.ts";
import type { Sex } from "../engine/types.ts";

// ---------------------------------------------------------------------------
// Population curve.
//
// This used to draw a textbook normal — a perfect bell, identical on every
// tab, for every metric, for both sexes. It was decoration. The reference
// distributions are NOT normal (midface and nose in particular are badly
// skewed), so the picture was quietly contradicting the numbers printed
// underneath it: a face at the 80th percentile sat where a normal said the
// 80th percentile should be, not where the eightieth-percentile face actually
// measures.
//
// So we draw the real thing. AGG_NORM stores 21 empirical quantiles per
// aggregate — 0%, 5%, … 100% — which is exactly a histogram in disguise: each
// consecutive pair brackets 5% of the reference set, so the height of that
// slice is 0.05 divided by how wide it is. Where the quantiles bunch up,
// faces bunch up.
//
// The ticks along the axis are those 21 quantiles, drawn. They are the honest
// part of this chart: their spacing IS the data, and where they thin out is
// where the sample genuinely runs out of faces. A smooth bell can never show
// you that.
// ---------------------------------------------------------------------------

const W = 300;
const TOP = 14; // top of the plotting area
const BASE = 90; // baseline / axis
const TICK = 96; // quantile ticks hang below the axis
const LABEL = 109;
const H = 116;

let uid = 0;

// Two box passes over the 20 slice heights. With only 110-odd faces behind 21
// order statistics, two nearly-coincident quantiles produce a spike that is
// sampling noise rather than a real mode; smoothing keeps the shape honest
// without inventing a distribution the way a fitted normal does.
function smooth(a: number[]): number[] {
  return a.map((_, i) => (a[Math.max(0, i - 1)] + 2 * a[i] + a[Math.min(a.length - 1, i + 1)]) / 4);
}

function smoothPath(p: Array<[number, number]>): string {
  let s = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
  for (let i = 1; i < p.length - 1; i++) {
    const mx = (p[i][0] + p[i + 1][0]) / 2;
    const my = (p[i][1] + p[i + 1][1]) / 2;
    s += ` Q${p[i][0].toFixed(1)},${p[i][1].toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
  }
  const last = p[p.length - 1];
  return `${s} L${last[0].toFixed(1)},${last[1].toFixed(1)}`;
}

export function curveSVG(pct: number, key: string, sex: Sex, soft = false): string {
  const q = AGG_NORM[sex]?.[key];
  if (!q || q.length < 21) return idealSVG(pct, soft);

  const lo = q[0] - (q[20] - q[0] || 1) * 0.07;
  const hi = q[20] + (q[20] - q[0] || 1) * 0.07;
  const X = (z: number) => ((z - lo) / (hi - lo)) * W;

  // Each consecutive quantile pair holds exactly 5% of the reference set, so
  // its height is that mass divided by its width.
  const raw: number[] = [];
  for (let i = 0; i < 20; i++) raw.push(0.05 / Math.max(1e-3, q[i + 1] - q[i]));
  const d = smooth(smooth(raw));
  const dMax = Math.max(...d) || 1;
  const Y = (v: number) => BASE - (v / dMax) * (BASE - TOP);

  const pts: Array<[number, number]> = [[0, BASE]];
  for (let i = 0; i < 20; i++) pts.push([X((q[i] + q[i + 1]) / 2), Y(d[i])]);
  pts.push([W, BASE]);

  const line = smoothPath(pts);
  const area = `${line} L${W},${BASE} L0,${BASE} Z`;

  // The subject's dot is placed by interpolating the SAME table scoring used
  // to turn their measurement into a percentile. The dot and the number under
  // it cannot disagree, because they come from one lookup.
  const t = Math.max(0, Math.min(100, pct)) / 100 * 20;
  const i0 = Math.min(19, Math.floor(t));
  const px = X(q[i0] + (q[i0 + 1] - q[i0]) * (t - i0));
  const py = yAt(pts, px);

  const x25 = X(q[5]);
  const x50 = X(q[10]);
  const x75 = X(q[15]);
  const band = soft ? "#E8F1ED" : "#DCEBE5";
  const id = `pc${++uid}`;

  // Drop a quartile label only when it would actually collide with MEDIAN:
  // half of "MEDIAN" plus half of "25%" at 7.5px mono, plus a little air.
  const sideLabel = (x: number, text: string) =>
    Math.abs(x - x50) > 26
      ? `<text x="${x.toFixed(1)}" y="${LABEL}" text-anchor="middle" font-family="Inter Variable, Inter, sans-serif" font-size="8" font-weight="600" letter-spacing="0.06em" fill="#B4B6B1">${text}</text>`
      : "";

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img"
    aria-label="Where this measurement falls in the reference population: ${Math.round(pct)}th percentile">
    <defs><clipPath id="${id}"><path d="${area}"/></clipPath></defs>

    <g clip-path="url(#${id})">
      <rect x="0" y="${TOP}" width="${W}" height="${BASE - TOP}" fill="#EFEDE7"/>
      <rect x="${x25.toFixed(1)}" y="${TOP}" width="${(x75 - x25).toFixed(1)}" height="${BASE - TOP}" fill="${band}"/>
    </g>
    <path d="${line}" fill="none" stroke="#C4C2BA" stroke-width="1.25" stroke-linejoin="round" stroke-linecap="round"/>

    <line x1="${x25.toFixed(1)}" y1="${TOP + 4}" x2="${x25.toFixed(1)}" y2="${BASE}" stroke="#CFD8D4" stroke-width="1"/>
    <line x1="${x75.toFixed(1)}" y1="${TOP + 4}" x2="${x75.toFixed(1)}" y2="${BASE}" stroke="#CFD8D4" stroke-width="1"/>
    <line x1="${x50.toFixed(1)}" y1="${TOP}" x2="${x50.toFixed(1)}" y2="${BASE}" stroke="#B9C4BF" stroke-width="1" stroke-dasharray="2 4"/>

    <line x1="0" y1="${BASE}" x2="${W}" y2="${BASE}" stroke="#DDDBD4" stroke-width="1"/>
    ${q
      .map(
        (v, i) =>
          `<line x1="${X(v).toFixed(1)}" y1="${BASE}" x2="${X(v).toFixed(1)}" y2="${
            i === 10 ? TICK + 2 : TICK
          }" stroke="${i === 10 ? "#8B8E94" : "#C9C7C0"}" stroke-width="1"/>`,
      )
      .join("")}

    <line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${px.toFixed(1)}" y2="${BASE}"
      stroke="#0E7A68" stroke-width="1.5" stroke-dasharray="3 3"/>
    <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="0" fill="#0E7A68" stroke="#fff" stroke-width="1.5">
      <animate attributeName="r" to="5.5" dur=".5s" begin=".25s" fill="freeze"/>
    </circle>

    <text x="${x50.toFixed(1)}" y="${LABEL}" text-anchor="middle" font-family="Inter Variable, Inter, sans-serif" font-size="8" font-weight="600" letter-spacing="0.06em" fill="#A9ABA6">MEDIAN</text>
    ${sideLabel(x25, "25%")}${sideLabel(x75, "75%")}
  </svg>`;
}

// Height of the drawn curve at a given x, by walking the same point list the
// path was built from — so the dot always sits ON the line, never near it.
function yAt(pts: Array<[number, number]>, x: number): number {
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const f = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
      return y0 + (y1 - y0) * f;
    }
  }
  return pts[pts.length - 1][1];
}

// Legend. Worth the space: without it the shaded middle reads as a value
// judgement rather than as the interquartile range, which is all it is.
export function curveLegend(): string {
  return `<p class="curve-key">
    <span><i class="k-band"></i>middle 50% of faces</span>
    <span><i class="k-tick"></i>each tick = 5% of the reference set</span>
    <span><i class="k-you"></i>you</span>
  </p>
  <p class="curve-note">Drawn from the measured reference distribution, not a textbook bell — where the ticks crowd together is where real faces crowd together, and where they spread out is where the sample thins.</p>`;
}

// Fallback for aggregates with no quantile table (side-profile metrics, and
// anything measured before its table was regenerated). Clearly a model rather
// than data, so it never pretends otherwise.
function idealSVG(pct: number, soft: boolean): string {
  let path = "M0,84 ";
  for (let x = 0; x <= 300; x += 4) {
    const z = (x - 150) / 46;
    path += `L${x},${(84 - Math.exp((-z * z) / 2) * 70).toFixed(1)} `;
  }
  path += "L300,84 Z";
  const px = Math.max(8, Math.min(292, (pct / 100) * 300));
  const pz = (px - 150) / 46;
  const py = 84 - Math.exp((-pz * pz) / 2) * 70;
  return `<svg viewBox="0 0 300 92" width="100%">
    <path d="${path}" fill="${soft ? "#E4F0EC" : "#EFEDE7"}" stroke="#CBC9C2" stroke-width="1"/>
    <line x1="150" y1="14" x2="150" y2="84" stroke="#DDDBD4" stroke-width="1" stroke-dasharray="2 4"/>
    <line x1="${px}" y1="${py}" x2="${px}" y2="84" stroke="#0E7A68" stroke-width="1.5" stroke-dasharray="3 3"/>
    <circle cx="${px}" cy="${py}" r="0" fill="#0E7A68"><animate attributeName="r" to="5.5" dur=".5s" begin=".25s" fill="freeze"/></circle>
    <text x="150" y="10" text-anchor="middle" font-family="Inter Variable, Inter, sans-serif" font-size="8" font-weight="600" letter-spacing="0.06em" fill="#A9ABA6">MEDIAN</text>
  </svg>`;
}
