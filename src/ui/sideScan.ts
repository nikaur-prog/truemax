import type { SidePoints } from "../engine/sideMetrics.ts";

// ---------------------------------------------------------------------------
// The side-scan reveal.
//
// The profile only has thirteen real, draggable points — that is all the side
// measurements need, and all the user should ever have to place. But thirteen
// dots dropping in looked thin next to the front scan's cloud of hundreds, and
// the front scan is what sells the thing as a real instrument.
//
// So the *scan animation* fakes the density the front gets for free: a mesh of
// points synthesised inside the face region (the hull of the thirteen anchors),
// revealed in the same staggered, easing style as the front, with a bright scan
// line sweeping down. The thirteen anchors light up on top as the points that
// are actually measured. Nothing here is a measurement — it is the theatre of
// one, matched to the theatre the front already does. The verify screen still
// shows and moves only the real thirteen.
// ---------------------------------------------------------------------------

const REVEAL_MS = 1150;
const DOT_DIM = "rgba(255,255,255,0.30)";
const DOT = "rgba(255,255,255,0.85)";
const ANCHOR = "#8FF3E0";
const MESH = "rgba(255,255,255,0.13)";
const SCAN = "rgba(143,243,224,";

export function revealSideScan(
  canvas: HTMLCanvasElement,
  points: SidePoints,
  w: number,
  h: number,
): void {
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const anchors = Object.values(points).map((p) => [p.x, p.y] as [number, number]);
  if (anchors.length < 3) return;

  const hull = convexHull(anchors);
  const inset = insetToward(hull, centroid(hull), 0.93);
  const cloud = buildCloud(inset, w);
  // Nearest-neighbour edges, computed once. This is what reads as a mesh rather
  // than as loose confetti — the same job the tessellation does on the front.
  const edges = nearestEdges(cloud, 2);

  // A deterministic-enough shuffle so the cloud assembles in a scattered order
  // (like the front's hashed order) instead of sweeping in a readable grid.
  const order = cloud.map((_, i) => i).sort((a, b) => hash(a) - hash(b));

  const r = Math.max(1.1, w / 300);
  const rAnchor = Math.max(3, w / 90);
  const start = performance.now();

  const frame = (now: number) => {
    const t = Math.min(1, (now - start) / REVEAL_MS);
    const e = easeOut(t);
    // The scan field (mesh + cloud) fades back in the final quarter so the
    // thirteen real anchors are what is left standing.
    const cloudFade = 1 - easeOut(Math.max(0, (t - 0.75) / 0.25)) * 0.75;
    ctx.clearRect(0, 0, w, h);

    // Mesh first, under everything, fading in with the cloud.
    ctx.strokeStyle = MESH;
    ctx.globalAlpha = e * cloudFade;
    ctx.lineWidth = Math.max(0.4, w / 1400);
    ctx.beginPath();
    const shown = Math.floor(e * order.length);
    const isShown = new Set(order.slice(0, shown));
    for (const [a, b] of edges) {
      if (!isShown.has(a) || !isShown.has(b)) continue;
      ctx.moveTo(cloud[a][0], cloud[a][1]);
      ctx.lineTo(cloud[b][0], cloud[b][1]);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // The synthesised cloud: dim white, appearing in scattered order. Fades on
    // the same clock as the mesh so the thirteen real anchors are what is left
    // standing — the cloud is the scan field, not the measurement.
    ctx.globalAlpha = cloudFade;
    ctx.fillStyle = DOT_DIM;
    for (let i = 0; i < shown; i++) {
      const p = cloud[order[i]];
      ctx.beginPath();
      ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // A scan line sweeping top to bottom, brightening the points it is level
    // with — the futuristic tell, and it ties the reveal to a direction.
    const scanY = e * h;
    const grad = ctx.createLinearGradient(0, scanY - 26, 0, scanY + 4);
    grad.addColorStop(0, `${SCAN}0)`);
    grad.addColorStop(1, `${SCAN}0.5)`);
    ctx.strokeStyle = grad;
    ctx.lineWidth = Math.max(1, w / 320);
    ctx.beginPath();
    ctx.moveTo(0, scanY);
    ctx.lineTo(w, scanY);
    ctx.stroke();
    // Points within a band of the line flash brighter as it passes.
    ctx.fillStyle = DOT;
    for (let i = 0; i < shown; i++) {
      const p = cloud[order[i]];
      if (Math.abs(p[1] - scanY) < 22) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], r * 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // The thirteen real anchors, on top, mint and glowing — the points that are
    // actually measured. They land in the back third of the reveal so they read
    // as the conclusion of the scan, not part of the noise.
    const anchorT = easeOut(Math.min(1, Math.max(0, (t - 0.55) / 0.45)));
    if (anchorT > 0) {
      ctx.shadowColor = ANCHOR;
      ctx.shadowBlur = 7 * anchorT;
      ctx.fillStyle = ANCHOR;
      ctx.strokeStyle = "rgba(4,53,45,0.85)";
      ctx.lineWidth = Math.max(1, rAnchor * 0.28);
      for (const [ax, ay] of anchors) {
        ctx.beginPath();
        ctx.arc(ax, ay, rAnchor * (0.5 + 0.5 * anchorT), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }

    if (t < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// --- geometry helpers ------------------------------------------------------

type Pt = [number, number];

function centroid(pts: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const [px, py] of pts) {
    x += px;
    y += py;
  }
  return [x / pts.length, y / pts.length];
}

function insetToward(pts: Pt[], c: Pt, k: number): Pt[] {
  return pts.map(([x, y]) => [c[0] + (x - c[0]) * k, c[1] + (y - c[1]) * k] as Pt);
}

// Andrew's monotone chain.
function convexHull(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function inPolygon(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const hit = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

// A jittered grid of points inside the region, plus points walked along the
// outline so the silhouette itself reads as densely sampled.
function buildCloud(hull: Pt[], w: number): Pt[] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of hull) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const step = Math.max(10, (x1 - x0) / 12);
  const out: Pt[] = [];
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      const jx = x + (hash2(x, y) - 0.5) * step * 0.8;
      const jy = y + (hash2(y, x) - 0.5) * step * 0.8;
      if (inPolygon(jx, jy, hull)) out.push([jx, jy]);
    }
  }
  // Densify the outline.
  const seg = Math.max(14, w / 22);
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(d / seg));
    for (let k = 0; k < n; k++) {
      const f = k / n;
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    }
  }
  return out;
}

function nearestEdges(cloud: Pt[], k: number): Array<[number, number]> {
  const seen = new Set<string>();
  const edges: Array<[number, number]> = [];
  for (let i = 0; i < cloud.length; i++) {
    const dists = cloud
      .map((p, j) => [j, Math.hypot(p[0] - cloud[i][0], p[1] - cloud[i][1])] as [number, number])
      .filter(([j]) => j !== i)
      .sort((a, b) => a[1] - b[1]);
    for (const [j] of dists.slice(0, k)) {
      const key = i < j ? `${i}:${j}` : `${j}:${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([Math.min(i, j), Math.max(i, j)]);
    }
  }
  return edges;
}

function hash(i: number): number {
  return (i * 2654435761) % 977;
}
function hash2(a: number, b: number): number {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
