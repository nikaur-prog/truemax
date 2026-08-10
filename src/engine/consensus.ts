import type { FaceLandmarkerResult, NormalizedLandmark } from "@mediapipe/tasks-vision";
import { detect } from "./landmarker.ts";

// ---------------------------------------------------------------------------
// Consensus landmarks.
//
// The detector does not place landmarks in exactly the same spot twice. Feed it
// the same face resampled a fraction of a degree differently and individual
// points shift by a pixel or two — and for some faces the scoring pipeline
// amplifies that into nearly a point of score. Sweeping a photo through ±8° of
// pure image rotation, where the face demonstrably has not changed, moved one
// subject 4.0 → 4.9, and the movement was NOT monotonic with angle. Scatter
// rather than drift is the signature of detector noise, not of a pose error.
//
// So we stop trusting a single detection. The image is measured several times
// under small, fixed geometric transforms; each result is mapped back into
// original coordinates; and the per-landmark MEDIAN is taken. Median rather
// than mean because a detection that goes badly wrong on one variant should be
// discarded outright, not averaged in.
//
// Two properties this must not break, both of which the transforms being FIXED
// rather than random guarantees:
//
//   - The same photo always yields exactly the same landmarks. Determinism is
//     the product's core promise; a stabiliser that introduced randomness would
//     be worse than the noise it removes.
//   - Nothing here corrects pose. It reduces measurement noise around whatever
//     the true landmarks are. Pose normalisation still happens downstream.
// ---------------------------------------------------------------------------

interface Variant {
  rot: number; // degrees, about the image centre
  scale: number; // about the image centre
}

// Small enough that the face never leaves the frame, large enough that the
// detector genuinely re-solves rather than returning a cached-looking answer.
const VARIANTS: Variant[] = [
  { rot: 0, scale: 1 },
  { rot: 2.5, scale: 1 },
  { rot: -2.5, scale: 1 },
  { rot: 0, scale: 1.04 },
  { rot: 0, scale: 0.96 },
];

let scratch: HTMLCanvasElement | null = null;

function render(src: HTMLCanvasElement, v: Variant): HTMLCanvasElement {
  if (v.rot === 0 && v.scale === 1) return src;
  scratch = scratch ?? document.createElement("canvas");
  // Same dimensions as the source, so detected coordinates share one frame and
  // the inverse transform is a plain rotate-and-scale about the centre.
  scratch.width = src.width;
  scratch.height = src.height;
  const ctx = scratch.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#101010";
  ctx.fillRect(0, 0, scratch.width, scratch.height);
  ctx.translate(src.width / 2, src.height / 2);
  ctx.rotate((v.rot * Math.PI) / 180);
  ctx.scale(v.scale, v.scale);
  ctx.translate(-src.width / 2, -src.height / 2);
  ctx.drawImage(src, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return scratch;
}

// Map a landmark detected in a transformed image back to original coordinates.
function invert(p: NormalizedLandmark, v: Variant, aspect: number): NormalizedLandmark {
  if (v.rot === 0 && v.scale === 1) return p;
  // Work in an aspect-corrected space so a rotation is a true rotation rather
  // than a shear — normalized coordinates are anisotropic.
  const x = (p.x - 0.5) * aspect;
  const y = p.y - 0.5;
  const t = (-v.rot * Math.PI) / 180;
  const rx = (x * Math.cos(t) - y * Math.sin(t)) / v.scale;
  const ry = (x * Math.sin(t) + y * Math.cos(t)) / v.scale;
  return {
    x: rx / aspect + 0.5,
    y: ry + 0.5,
    z: (p.z ?? 0) / v.scale,
    visibility: p.visibility,
  } as NormalizedLandmark;
}

const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Detect with consensus. Falls back to the plain single detection whenever
// fewer than three variants agree there is a face at all.
export function detectStable(src: HTMLCanvasElement): FaceLandmarkerResult {
  const aspect = src.width / Math.max(1, src.height);
  const base = detect(src);
  if (!base.faceLandmarks?.length) return base;

  const sets: NormalizedLandmark[][] = [];
  for (const v of VARIANTS) {
    let r: FaceLandmarkerResult;
    try {
      r = v.rot === 0 && v.scale === 1 ? base : detect(render(src, v));
    } catch {
      continue;
    }
    const lm = r.faceLandmarks?.[0];
    if (!lm) continue;
    sets.push(lm.map((p) => invert(p, v, aspect)));
  }
  if (sets.length < 3) return base;

  const n = sets[0].length;
  const merged: NormalizedLandmark[] = [];
  for (let i = 0; i < n; i++) {
    merged.push({
      x: median(sets.map((s) => s[i].x)),
      y: median(sets.map((s) => s[i].y)),
      z: median(sets.map((s) => s[i].z ?? 0)),
      visibility: base.faceLandmarks[0][i].visibility,
    } as NormalizedLandmark);
  }

  // Blendshapes and the transformation matrix come from the untransformed
  // detection — they are not landmark positions and must not be averaged.
  return {
    ...base,
    faceLandmarks: [merged, ...base.faceLandmarks.slice(1)],
  };
}
