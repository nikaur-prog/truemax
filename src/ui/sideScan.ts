import type { SidePoints, SidePointId } from "../engine/sideMetrics.ts";

// ---------------------------------------------------------------------------
// The side-scan reveal.
//
// First cut of this scattered a synthesised cloud of points across the face to
// fake the front scan's density. It read as exactly the wrong thing: random
// dots on the cheek that look like the measurement missed, when the thirteen
// real points are sitting right where they were placed.
//
// So this traces the real profile instead. The thirteen verified points are
// walked in anatomical order — down the face silhouette from hairline to chin,
// then back along the jaw to the ear — and the path between them is densified
// into a running line of points that draws itself down the profile. It is dense
// and it is futuristic, but every point is ON the profile the user verified, so
// nothing can read as "off". The thirteen anchors light up mint as the trace
// reaches them; a scan line sweeps down; the measurement lines (E-line, the jaw
// angle) ghost in at the end. Nothing here is a new measurement — it is the
// theatre of the real one.
// ---------------------------------------------------------------------------

const REVEAL_MS = 1250;
const TRACE = "rgba(255,255,255,0.55)";
const TRACE_DOT = "rgba(255,255,255,0.5)";
const ANCHOR = "#8FF3E0";
const SCAN = "rgba(143,243,224,";

// The outline is drawn as SEPARATE runs, not one loop through all thirteen.
//
// A single chain looked right until a point was mis-seeded: joining the lip
// point to the ear point drew a line straight across the neck, and one bad dot
// turned the whole reveal into a scribble. Anatomically these are different
// edges anyway — the face profile is one continuous line, the jawline is
// another, and the neck point belongs to neither. Split, a wrong point can
// only spoil its own short segment.
const CHAINS: SidePointId[][] = [
  // The face profile: hairline down the brow, nose, lips and chin.
  [
    "trichion",
    "glabella",
    "nasion",
    "pronasale",
    "subnasale",
    "labialeSuperius",
    "labialeInferius",
    "pogonion",
    "menton",
  ],
  // The jawline, back up to the ear.
  ["menton", "gonion", "condylion"],
  // Under the chin to the throat.
  ["menton", "cervicale"],
];

// Drawn as anchors but never joined into a run.
const LOOSE: SidePointId[] = ["tragion"];

type Pt = [number, number];

export function revealSideScan(
  canvas: HTMLCanvasElement,
  points: SidePoints,
  w: number,
  h: number,
): void {
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  // Every anchor, in the order the trace reaches them, so each can light up.
  const anchorOrder: SidePointId[] = [];
  for (const chain of CHAINS) for (const id of chain) {
    if (!anchorOrder.includes(id)) anchorOrder.push(id);
  }
  for (const id of LOOSE) if (!anchorOrder.includes(id)) anchorOrder.push(id);
  const anchors: Pt[] = anchorOrder.map((id) => [points[id].x, points[id].y]);

  // Densify each chain separately: many points spaced along the real edges.
  // `anchor` is the index into anchorOrder that this trace point has reached,
  // and `breakBefore` marks where one run ends and the next begins so the
  // connecting line is never drawn between two unrelated edges.
  const seg = Math.max(8, w / 42);
  const trace: Array<{ p: Pt; anchor: number; breakBefore: boolean }> = [];
  for (const chain of CHAINS) {
    for (let i = 0; i < chain.length - 1; i++) {
      const a = points[chain[i]];
      const b = points[chain[i + 1]];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.max(1, Math.round(d / seg));
      for (let k = 0; k < n; k++) {
        const f = k / n;
        trace.push({
          p: [a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f],
          anchor: anchorOrder.indexOf(chain[i]),
          breakBefore: i === 0 && k === 0,
        });
      }
    }
    const last = chain[chain.length - 1];
    trace.push({ p: [points[last].x, points[last].y], anchor: anchorOrder.indexOf(last), breakBefore: false });
  }

  const r = Math.max(1.2, w / 240);
  const rAnchor = Math.max(3.5, w / 78);
  const start = performance.now();

  const frame = (now: number) => {
    const t = Math.min(1, (now - start) / REVEAL_MS);
    const e = easeOut(t);
    ctx.clearRect(0, 0, w, h);

    // How far along the outline the trace has reached.
    const reached = Math.floor(e * trace.length);

    // The connecting line, drawn up to where the trace has reached, lifting the
    // pen between runs so the face profile and the jawline never get joined.
    if (reached > 1) {
      ctx.strokeStyle = TRACE;
      ctx.lineWidth = Math.max(1, w / 360);
      ctx.lineJoin = "round";
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < reached; i++) {
        const [px, py] = trace[i].p;
        if (!pen || trace[i].breakBefore) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
        pen = true;
      }
      ctx.stroke();
    }

    // The trace points along the outline.
    ctx.fillStyle = TRACE_DOT;
    for (let i = 0; i < reached; i++) {
      const p = trace[i].p;
      ctx.beginPath();
      ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
      ctx.fill();
    }

    // A scan line sweeping top to bottom, brightening the trace it is level with.
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
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    for (let i = 0; i < reached; i++) {
      const p = trace[i].p;
      if (Math.abs(p[1] - scanY) < 20) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], r * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // The thirteen real anchors light up as the trace reaches each one, and stay
    // lit. They are the conclusion of the scan and the thing that is actually
    // measured, so they read brightest.
    const reachedAnchor = reached > 0 ? trace[Math.min(reached, trace.length) - 1].anchor : -1;
    ctx.shadowColor = ANCHOR;
    ctx.strokeStyle = "rgba(4,53,45,0.85)";
    for (let i = 0; i < anchors.length; i++) {
      if (i > reachedAnchor) continue;
      const [ax, ay] = anchors[i];
      // The most recently reached anchor lands large and settles.
      const fresh = i === reachedAnchor ? 1 - Math.min(1, (e * trace.length - reached) * 3) : 0;
      ctx.shadowBlur = 7;
      ctx.fillStyle = ANCHOR;
      ctx.lineWidth = Math.max(1, rAnchor * 0.28);
      ctx.beginPath();
      ctx.arc(ax, ay, rAnchor * (1 + fresh * 0.6), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    if (t < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
