import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { FaceLandmarker } from "@mediapipe/tasks-vision";

// Landmark overlay: animated reveal during the scan beat, then a calm dim
// state; region tabs re-light their own landmarks.

const DOT = "rgba(255, 255, 255, 0.92)";
const DOT_IRIS = "rgba(143, 243, 224, 0.95)";
const DOT_DIM = "rgba(255, 255, 255, 0.30)";
const DOT_HI = "#8FF3E0";
const MESH_DIM = "rgba(255, 255, 255, 0.07)";

const REVEAL_MS = 1400;

export interface OverlayHandle {
  cancel(): void;
  done: Promise<void>;
}

export function drawLandmarksAnimated(
  canvas: HTMLCanvasElement,
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
): OverlayHandle {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const order = landmarks
    .map((_, i) => i)
    .sort((a, b) => ((a * 2654435761) % 977) - ((b * 2654435761) % 977));
  const dotR = Math.max(1.2, width / 480);

  let raf = 0;
  let start = 0;
  let resolveDone: () => void;
  const done = new Promise<void>((r) => (resolveDone = r));

  const frame = (now: number) => {
    if (!start) start = now;
    const t = Math.min(1, (now - start) / REVEAL_MS);
    ctx.clearRect(0, 0, width, height);

    // NO MESH in the reveal.
    //
    // The 478-point tessellation was the noisiest thing on the screen and it
    // carried the least meaning — nobody reads a triangle, and it spent
    // exactly the contrast budget the measurement lines need a moment later.
    // Landing dots alone reads as a machine finding points, which is what is
    // actually happening; the mesh read as a filter.
    //
    // The calm state below still draws one, at MESH_DIM (0.07) rather than the
    // 0.16 this used: less than half the weight, over a photograph nobody is
    // measuring, with nothing competing for the eye. That one is a resting
    // texture and it stays.
    const n = Math.floor(easeOut(t) * order.length);
    for (let i = 0; i < n; i++) {
      const idx = order[i];
      dot(ctx, landmarks[idx], width, height, idx >= 468 ? dotR * 1.6 : dotR, idx >= 468 ? DOT_IRIS : DOT);
    }

    if (t < 1) raf = requestAnimationFrame(frame);
    else resolveDone();
  };
  raf = requestAnimationFrame(frame);

  return {
    cancel() {
      cancelAnimationFrame(raf);
      resolveDone();
    },
    done,
  };
}

// Calm state, optionally with a highlighted region's landmarks.
export function drawCalm(
  canvas: HTMLCanvasElement,
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
  highlight?: number[],
): void {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const dotR = Math.max(1.1, width / 520);
  ctx.clearRect(0, 0, width, height);

  ctx.strokeStyle = MESH_DIM;
  strokeMesh(ctx, landmarks, width, height);

  const hi = new Set(highlight ?? []);
  for (let i = 0; i < landmarks.length; i++) {
    if (hi.has(i)) continue;
    dot(ctx, landmarks[i], width, height, dotR * 0.85, DOT_DIM);
  }
  for (const i of hi) {
    const lm = landmarks[i];
    if (!lm) continue;
    const r = dotR * 1.7;
    ctx.shadowColor = DOT_HI;
    ctx.shadowBlur = 6;
    dot(ctx, lm, width, height, r, DOT_HI);
    ctx.shadowBlur = 0;
  }
}

// ---------------------------------------------------------------------------
// Region transition.
//
// Switching tabs used to redraw the highlight instantly while the photo zoomed
// under it over 550ms. The zoom read as smooth and the landmarks read as a
// jump-cut pasted on top of it, which is worse than either alone — the eye
// tracks the moving thing and the static thing next to it looks broken.
//
// So the highlight animates on the same clock as the zoom. The incoming points
// fly out from the region's own centre into their real positions, staggered by
// where they sit around that centre, so the cluster assembles into its shape
// rather than appearing all at once. Faint nearest-neighbour edges fade in
// behind them on the same per-point clock, which is what makes it read as a
// shape forming rather than as dots brightening in place.
//
// The outgoing region's points fade back to the calm state over the same
// interval, so the two never both look active.
// ---------------------------------------------------------------------------

// Region-to-region transition. Was 620ms, which is fine for something you
// trigger once and far too slow for something you trigger by moving a mouse:
// switching tabs meant watching two thirds of a second of animation before the
// new region settled. Still slightly longer than the CSS zoom so it lands last.
const TRANSITION_MS = 380;

export function transitionRegion(
  canvas: HTMLCanvasElement,
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
  from: number[] | undefined,
  to: number[] | undefined,
): OverlayHandle {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const dotR = Math.max(1.1, width / 520);

  // Order the incoming points by angle around their own centroid, which is the
  // order they arrive in — so the cluster sweeps rather than popping.
  const incoming = (to ?? []).filter((i) => landmarks[i]);
  let cx = 0;
  let cy = 0;
  for (const i of incoming) {
    cx += landmarks[i].x * width;
    cy += landmarks[i].y * height;
  }
  cx /= Math.max(1, incoming.length);
  cy /= Math.max(1, incoming.length);
  const ordered = [...incoming].sort(
    (a, b) =>
      Math.atan2(landmarks[a].y * height - cy, landmarks[a].x * width - cx) -
      Math.atan2(landmarks[b].y * height - cy, landmarks[b].x * width - cx),
  );
  const outgoing = (from ?? []).filter((i) => !incoming.includes(i) && landmarks[i]);
  const hiSet = new Set(incoming);
  const outSet = new Set(outgoing);

  // Where each point sits in the stagger, so both the dot and the edges that
  // touch it move on the same clock.
  const slot = new Map<number, number>();
  ordered.forEach((i, k) => slot.set(i, ordered.length > 1 ? k / (ordered.length - 1) : 0));

  // Nearest-neighbour edges, capped by length so a two-cluster region never
  // gets a line drawn between its clusters.
  const px = (i: number) => [landmarks[i].x * width, landmarks[i].y * height] as const;
  const near: Array<[number, number, number]> = [];
  for (const a of incoming) {
    const [ax, ay] = px(a);
    const others = incoming
      .filter((b) => b !== a)
      .map((b) => {
        const [bx, by] = px(b);
        return [b, Math.hypot(bx - ax, by - ay)] as const;
      })
      .sort((p, q) => p[1] - q[1]);
    for (const [b, d] of others.slice(0, 2)) near.push([Math.min(a, b), Math.max(a, b), d]);
  }
  const lens = near.map((e) => e[2]).sort((p, q) => p - q);
  const cap = (lens[lens.length >> 1] ?? 0) * 2.2;
  const seen = new Set<string>();
  const edges: Array<[number, number]> = [];
  for (const [a, b, d] of near) {
    const key = `${a}:${b}`;
    if (seen.has(key) || d > cap) continue;
    seen.add(key);
    edges.push([a, b]);
  }

  let raf = 0;
  let start = 0;
  let resolveDone: () => void;
  const done = new Promise<void>((r) => (resolveDone = r));

  // Fraction of the timeline spent staggering the arrivals.
  const SPREAD = 0.45;

  const frame = (now: number) => {
    if (!start) start = now;
    const t = Math.min(1, (now - start) / TRANSITION_MS);
    const arrival = (i: number) => easeOut(clamp01((t - (slot.get(i) ?? 0) * SPREAD) / (1 - SPREAD)));
    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = MESH_DIM;
    strokeMesh(ctx, landmarks, width, height);

    // Everything that is neither arriving nor leaving
    for (let i = 0; i < landmarks.length; i++) {
      if (hiSet.has(i) || outSet.has(i)) continue;
      dot(ctx, landmarks[i], width, height, dotR * 0.85, DOT_DIM);
    }

    // Leaving: shrink and dim back to the calm state
    const outT = easeOut(t);
    for (const i of outgoing) {
      const r = dotR * (1.7 - 0.85 * outT);
      ctx.globalAlpha = 1 - outT * 0.55;
      dot(ctx, landmarks[i], width, height, r, outT > 0.7 ? DOT_DIM : DOT_HI);
      ctx.globalAlpha = 1;
    }

    // Arriving: each point gets its own slice of the timeline, so the shape
    // sweeps into existence instead of blinking on. Edges read the same
    // function, so a line never appears before both its ends have landed.
    const n = ordered.length;
    ctx.shadowColor = DOT_HI;
    for (let k = 0; k < n; k++) {
      const i = ordered[k];
      const e = arrival(i);
      if (e <= 0) continue;
      const lm = landmarks[i];
      const tx = lm.x * width;
      const ty = lm.y * height;
      // Fly out from the region's centre
      const px = cx + (tx - cx) * e;
      const py = cy + (ty - cy) * e;
      ctx.globalAlpha = e;
      ctx.shadowBlur = 6 * e;
      ctx.fillStyle = DOT_HI;
      ctx.beginPath();
      ctx.arc(px, py, dotR * 1.7 * (0.4 + 0.6 * e), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    // Connective tissue between the arriving points. Deliberately faint: it is
    // there to make the assembly read as a shape rather than as scattered dots,
    // not to assert that these points form an anatomical outline — they do not.
    //
    // Nearest-neighbour edges, NOT one loop through all of them. A single loop
    // ordered by angle looks right for a region that is one cluster and wrong
    // for a region that is two: `eyes` is a left group and a right group, and
    // the loop drew a long line straight across the bridge of the nose joining
    // them, which is a connection that does not exist. Local edges give each
    // cluster its own structure and never invent a link across the gap.
    ctx.lineWidth = Math.max(0.6, width / 1400);
    ctx.lineJoin = "round";
    for (const [a, bIdx] of edges) {
      const ea = arrival(a);
      const eb = arrival(bIdx);
      const edgeT = Math.min(ea, eb);
      if (edgeT <= 0.01) continue;
      const la = landmarks[a];
      const lb = landmarks[bIdx];
      ctx.strokeStyle = `rgba(143,243,224,${(0.3 * edgeT).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(la.x * width, la.y * height);
      ctx.lineTo(lb.x * width, lb.y * height);
      ctx.stroke();
    }

    if (t < 1) raf = requestAnimationFrame(frame);
    else resolveDone();
  };
  raf = requestAnimationFrame(frame);

  return {
    cancel() {
      cancelAnimationFrame(raf);
      resolveDone();
    },
    done,
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function strokeMesh(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
): void {
  ctx.lineWidth = Math.max(0.4, width / 1600);
  ctx.beginPath();
  for (const { start, end } of FaceLandmarker.FACE_LANDMARKS_TESSELATION) {
    const a = landmarks[start];
    const b = landmarks[end];
    ctx.moveTo(a.x * width, a.y * height);
    ctx.lineTo(b.x * width, b.y * height);
  }
  ctx.stroke();
}

function dot(
  ctx: CanvasRenderingContext2D,
  lm: NormalizedLandmark,
  width: number,
  height: number,
  r: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(lm.x * width, lm.y * height, r, 0, Math.PI * 2);
  ctx.fill();
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
