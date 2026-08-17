import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { LM } from "./geometry.js";

// ---------------------------------------------------------------------------
// Finding the hairline, because the mesh does not have one.
//
// MediaPipe's topmost vertex (landmark 10) sits somewhere in the middle of the
// forehead. It is a fixed fraction up a fitted model, not a feature it went
// looking for, so it lands in the same place on a face with two inches of
// forehead and a face with five. `topThirdEst` has been built on it this whole
// time and calls itself "upper face proportion", and it is the reason a scan of
// a woman whose forehead is the first thing you notice came back reading FOUR
// SIGMA SMALL. The measurement was not wrong about its landmarks. It was
// measuring something that is not the forehead.
//
// A hairline is a material boundary — hair against skin — not a shading
// artifact, so it survives the lighting that would destroy a shadow-based
// measurement. It is a step in luminance, and steps are findable.
//
// What it does NOT try to survive, and refuses on instead:
//
//   - a fringe, which puts hair where the forehead is and produces a confident
//     step in the wrong place. Detected by the step being implausibly low.
//   - a shaved or bald head, where there is no step at all
//   - hair the same value as the skin, where the step is real and too weak to
//     locate
//
// Refusing is the whole design. A forehead measurement that is right most of
// the time and silently wrong the rest is worse than none, because every score
// built on it inherits the error without inheriting the doubt — which is
// exactly the position the mesh landmark left us in.
// ---------------------------------------------------------------------------

/** Columns sampled across the forehead, as fractions of inter-eye distance. */
const COLUMNS = [-0.34, -0.17, 0, 0.17, 0.34];
/** How far above the glabella to look, in inter-eye distances. */
const REACH = 1.9;
/** Below the glabella by this much, to catch a fringe hanging into the brow. */
const BELOW = 0.15;
/** Steps softer than this share of the face's own luminance spread are refused. */
const MIN_CONTRAST = 0.22;
/** At least this many of the five columns must agree, or the read is refused. */
const MIN_AGREEING = 3;
/** Columns disagreeing by more than this (in inter-eye units) do not count. */
const AGREE_WITHIN = 0.22;

export interface Hairline {
  /** Glabella → hairline, in inter-eye distances. */
  foreheadRatio: number;
  /** 0–1. How cleanly the step stood out; low values were refused already. */
  confidence: number;
}

/**
 * Measures the forehead, or says it could not.
 *
 * Returns null rather than a guess. Callers must treat that as "no measurement"
 * — see scoring.ts, where an absent value is excluded from every aggregate
 * rather than scored as zero.
 */
export function findHairline(
  source: CanvasImageSource,
  lm: NormalizedLandmark[],
  width: number,
  height: number,
): Hairline | null {
  const px = (i: number) => ({ x: lm[i].x * width, y: lm[i].y * height });
  const eyeR = px(LM.EYE_R_OUTER);
  const eyeL = px(LM.EYE_L_OUTER);
  const glabella = px(LM.GLABELLA);
  const interEye = Math.hypot(eyeL.x - eyeR.x, eyeL.y - eyeR.y);
  if (!(interEye > 8)) return null;

  // Up is away from the chin, along the face's own axis rather than the
  // image's. A head tilted twenty degrees would otherwise have its sample
  // columns walk off the side of the forehead before reaching the hair.
  const menton = px(LM.MENTON);
  const ux = glabella.x - menton.x;
  const uy = glabella.y - menton.y;
  const ulen = Math.hypot(ux, uy) || 1;
  const up = { x: ux / ulen, y: uy / ulen };
  const across = { x: -up.y, y: up.x };

  // Read one band covering every column, once. Sampling the source directly per
  // pixel would mean thousands of getImageData calls, each of which stalls the
  // GPU pipeline; one draw and one read is the difference between a millisecond
  // and a visible hitch on the results screen.
  const pad = interEye * 0.6;
  const reach = interEye * REACH;
  const x0 = Math.max(0, Math.floor(Math.min(glabella.x, glabella.x + up.x * -reach) - pad - interEye * 0.5));
  const y0 = Math.max(0, Math.floor(Math.min(glabella.y, glabella.y + up.y * -reach) - pad - interEye * 0.5));
  const x1 = Math.min(width, Math.ceil(Math.max(glabella.x, glabella.x - up.x * -reach) + pad + interEye * 0.5));
  const y1 = Math.min(height, Math.ceil(Math.max(glabella.y, glabella.y - up.y * -reach) + pad + interEye * 0.5));
  const bw = x1 - x0;
  const bh = y1 - y0;
  if (!(bw > 8 && bh > 8)) return null;

  const canvas = document.createElement("canvas");
  canvas.width = bw;
  canvas.height = bh;
  const cx = canvas.getContext("2d", { willReadFrequently: true });
  if (!cx) return null;
  cx.drawImage(source, x0, y0, bw, bh, 0, 0, bw, bh);
  const data = cx.getImageData(0, 0, bw, bh).data;
  const lumAt = (x: number, y: number): number => {
    const ix = Math.round(x - x0);
    const iy = Math.round(y - y0);
    if (ix < 0 || iy < 0 || ix >= bw || iy >= bh) return NaN;
    const o = (iy * bw + ix) * 4;
    return 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
  };

  const step = Math.max(1, interEye / 60);
  const samples = Math.round((REACH + BELOW) * interEye / step);
  const hits: number[] = [];
  const strengths: number[] = [];
  let spreadPool: number[] = [];

  for (const offset of COLUMNS) {
    const ox = across.x * offset * interEye;
    const oy = across.y * offset * interEye;
    const profile: number[] = [];
    for (let s = 0; s < samples; s++) {
      const d = -BELOW * interEye + s * step;
      profile.push(lumAt(glabella.x + ox + up.x * d, glabella.y + oy + up.y * d));
    }
    if (profile.some((v) => !Number.isFinite(v))) continue;
    spreadPool = spreadPool.concat(profile);

    // Smooth before differencing. A raw per-pixel derivative finds the loudest
    // sensor noise in the image, every time, and calls it a hairline.
    const smooth = profile.map((_, i) => {
      let sum = 0;
      let n = 0;
      for (let k = -2; k <= 2; k++) {
        const v = profile[i + k];
        if (v !== undefined) { sum += v; n++; }
      }
      return sum / n;
    });

    // The largest step anywhere along the column, in either direction — dark
    // hair over light skin and light hair over dark skin are the same event.
    let best = -1;
    let bestAt = -1;
    for (let i = 2; i < smooth.length - 2; i++) {
      const jump = Math.abs(smooth[i + 2] - smooth[i - 2]);
      if (jump > best) { best = jump; bestAt = i; }
    }
    if (bestAt < 0) continue;
    hits.push((-BELOW * interEye + bestAt * step) / interEye);
    strengths.push(best);
  }
  if (hits.length < MIN_AGREEING || !spreadPool.length) return null;

  // Contrast is judged against the face's own luminance range rather than an
  // absolute threshold, so an underexposed photo is held to the same standard
  // as a bright one instead of being refused for being dark.
  const sorted = [...spreadPool].sort((a, b) => a - b);
  const spread = sorted[Math.floor(sorted.length * 0.9)] - sorted[Math.floor(sorted.length * 0.1)];
  const strength = median(strengths) / Math.max(spread, 1e-6);
  if (strength < MIN_CONTRAST) return null;

  // Columns must agree. A parting, a widow's peak or a single stray lock moves
  // one column; a hairline moves all of them together, and disagreement is the
  // signal that whatever was found is not one edge.
  const centre = median(hits);
  const agreeing = hits.filter((h) => Math.abs(h - centre) <= AGREE_WITHIN);
  if (agreeing.length < MIN_AGREEING) return null;

  const foreheadRatio = median(agreeing);
  // Anatomy, not taste. A forehead shorter than a third of the inter-eye
  // distance means the step found was a brow or a fringe; longer than 1.7 means
  // it found the top of the head, or a background edge past it.
  if (foreheadRatio < 0.33 || foreheadRatio > 1.7) return null;

  return {
    foreheadRatio,
    confidence: Math.min(1, (strength / MIN_CONTRAST - 1) / 2 + agreeing.length / COLUMNS.length) / 2,
  };
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
