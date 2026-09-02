import { FaceLandmarker } from "@mediapipe/tasks-vision";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

// ---------------------------------------------------------------------------
// Skin measurement.
//
// Two rules govern everything in this file.
//
// 1. NOTHING HERE IS A DIAGNOSIS. These are image statistics — how evenly a
//    face reflects light, how much its colour varies across itself. Acne,
//    eczema, rosacea and the rest are medical conditions; identifying them
//    from a photograph is a clinician's job and, in several jurisdictions, a
//    regulated one. The engine measures evenness and reports evenness.
//
// 2. EVERY METRIC IS RELATIVE TO THE PERSON'S OWN SKIN. Not one of them
//    compares absolute lightness or hue against a population. Dark skin and
//    pale skin produce the same score for the same evenness, because the
//    statistic is variation WITHIN one face — an absolute-colour metric would
//    encode a preference for skin tone, which would be both wrong and useless.
//
// Both rules are load-bearing. Breaking either turns a measurement into a
// claim we cannot stand behind.
// ---------------------------------------------------------------------------

export interface SkinStats {
  // Robust spread of lightness across the face, as a fraction of its own mean.
  // Higher = more mottled. Shadow-resistant via trimmed percentiles.
  toneEvenness: number;
  // Spread along the red-green axis. Picks up patchy redness without caring
  // whether the face is warm or cool overall.
  rednessSpread: number;
  // Overall colour blotchiness — spread in the full chroma plane.
  chromaSpread: number;
  // High-frequency energy in lightness, measured at a FIXED face-relative
  // resolution and divided by the frame's own sharpness. Without both of those
  // corrections, a soft or low-resolution photo scores as flawless skin, which
  // is the most obvious way to game a skin score.
  texture: number;
  // Mean lightness under the eyes over mean lightness at the cheeks. Below 1
  // means darker there. A ratio, so it is tone-independent.
  undereyeRatio: number;
  // Fraction of usable skin pixels found. Low values mean heavy occlusion —
  // hair, a beard, glasses, a mask — and the stats above should not be trusted.
  coverage: number;
  // The consumption of the line above. Coverage was computed and then read by
  // nobody, which meant every consumer trusted blotchiness measured off a
  // beard exactly as much as blotchiness measured off skin. False when the
  // usable area is too small for the statistics to mean anything; consumers
  // must treat the numbers as absent, not as approximate.
  reliable: boolean;
}

// Below this fraction of the face, the "skin" statistics are mostly measuring
// whatever is covering the skin. A clean-shaven, unobstructed face samples
// around 0.25-0.35 of its bounding box after the eye/brow/lip holes are cut;
// heavy beard, hair across the face, or a mask drops it well under a tenth.
export const SKIN_COVERAGE_MIN = 0.08;

// Exported so the rule is testable without a canvas: analyzeSkin only runs in
// a browser, but whether a given coverage is trustworthy is pure arithmetic.
export function skinReliable(coverage: number): boolean {
  return coverage >= SKIN_COVERAGE_MIN;
}

const SAMPLE_W = 220; // face resampled to a fixed width: texture must not depend on megapixels

// Walk a MediaPipe connection list into an ordered ring so it can be used as a
// polygon. The connector sets are edge lists, not paths.
function ring(conns: Array<{ start: number; end: number }>): number[] {
  const next = new Map<number, number[]>();
  for (const c of conns) {
    (next.get(c.start) ?? next.set(c.start, []).get(c.start)!).push(c.end);
    (next.get(c.end) ?? next.set(c.end, []).get(c.end)!).push(c.start);
  }
  const start = conns[0].start;
  const out = [start];
  const seen = new Set([start]);
  let cur = start;
  for (;;) {
    const step = (next.get(cur) ?? []).find((n) => !seen.has(n));
    if (step === undefined) break;
    out.push(step);
    seen.add(step);
    cur = step;
  }
  return out;
}

let RINGS: { oval: number[]; eyeL: number[]; eyeR: number[]; lips: number[]; browL: number[]; browR: number[] } | null =
  null;
function rings() {
  return (RINGS ??= {
    oval: ring([...FaceLandmarker.FACE_LANDMARKS_FACE_OVAL]),
    eyeL: ring([...FaceLandmarker.FACE_LANDMARKS_LEFT_EYE]),
    eyeR: ring([...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE]),
    lips: ring([...FaceLandmarker.FACE_LANDMARKS_LIPS]),
    browL: ring([...FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW]),
    browR: ring([...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW]),
  });
}

/** The mesh rings the mask is built from, for skinPatterns.ts, which samples the face the same way. */
export const faceRings = rings;

type Pt = { x: number; y: number };

// Grow a polygon about its own centroid, so an exclusion zone covers the soft
// edge around a feature (lash line, lip vermilion, brow hairs) too.
function dilate(poly: Pt[], k: number): Pt[] {
  const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
  return poly.map((p) => ({ x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k }));
}

function inside(poly: Pt[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

// sRGB -> CIE L*a*b*. Worth the arithmetic: lightness and chroma need to be
// perceptually spaced or "evenness" would mean something different on dark
// skin than on pale skin, which is exactly the bias rule 2 exists to prevent.
function toLab(r: number, g: number, b: number): [number, number, number] {
  const lin = (c: number) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const pct = (sorted: number[], p: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))] : 0;

// Robust spread: half the 10–90 range. Resists the shadow down one side of a
// face and the specular highlight on a nose, both of which would otherwise
// dominate an ordinary standard deviation.
function robustSpread(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return (pct(s, 0.9) - pct(s, 0.1)) / 2;
}

export function analyzeSkin(
  source: HTMLCanvasElement,
  lm: NormalizedLandmark[],
  width: number,
  height: number,
): SkinStats | null {
  const R = rings();
  const pt = (i: number): Pt => ({ x: lm[i].x * width, y: lm[i].y * height });

  const oval = R.oval.map(pt);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of oval) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  const fw = x1 - x0;
  const fh = y1 - y0;
  if (!(fw > 4 && fh > 4)) return null;

  // Resample the face to a fixed width so texture is measured per unit of FACE,
  // not per unit of sensor. A 12MP photo and a 480p webcam frame must land in
  // the same units or nothing here is comparable between photos.
  const sw = SAMPLE_W;
  const sh = Math.max(8, Math.round((fh / fw) * SAMPLE_W));
  const c = document.createElement("canvas");
  c.width = sw;
  c.height = sh;
  const cx = c.getContext("2d", { willReadFrequently: true })!;
  cx.drawImage(source, x0, y0, fw, fh, 0, 0, sw, sh);
  const data = cx.getImageData(0, 0, sw, sh).data;

  const toLocal = (p: Pt): Pt => ({ x: ((p.x - x0) / fw) * sw, y: ((p.y - y0) / fh) * sh });
  // Pull the oval in slightly: its own boundary straddles the jaw edge, and
  // background pixels there would read as extreme unevenness.
  const skinPoly = dilate(oval.map(toLocal), 0.94);
  const holes = [
    dilate(R.eyeL.map(pt).map(toLocal), 1.7),
    dilate(R.eyeR.map(pt).map(toLocal), 1.7),
    dilate(R.lips.map(pt).map(toLocal), 1.25),
    dilate(R.browL.map(pt).map(toLocal), 1.35),
    dilate(R.browR.map(pt).map(toLocal), 1.35),
  ];

  const Lfield = new Float32Array(sw * sh);
  const Afield = new Float32Array(sw * sh);
  const Bfield = new Float32Array(sw * sh);
  const mask = new Uint8Array(sw * sh);
  const Ls: number[] = [];

  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = y * sw + x;
      const p = i * 4;
      const [l, a, b] = toLab(data[p], data[p + 1], data[p + 2]);
      Lfield[i] = l;
      Afield[i] = a;
      Bfield[i] = b;
      if (!inside(skinPoly, x + 0.5, y + 0.5)) continue;
      if (holes.some((h) => inside(h, x + 0.5, y + 0.5))) continue;
      mask[i] = 1;
      Ls.push(l);
    }
  }

  const total = Ls.length;
  if (total < 400) return null;

  // Drop the darkest and brightest tails before measuring. Hair falling across
  // a forehead, a beard, spectacle frames and blown highlights are all real,
  // and none of them are skin.
  const sortedL = [...Ls].sort((a, b) => a - b);
  const lo = pct(sortedL, 0.08);
  const hi = pct(sortedL, 0.97);
  const keepL = Ls.filter((v) => v >= lo && v <= hi);
  if (keepL.length < 300) return null;

  const meanL = keepL.reduce((s, v) => s + v, 0) / keepL.length;

  // Flat-field the face before measuring evenness.
  //
  // Raw spread of lightness across a face is mostly the LIGHT: a window on one
  // side puts a gradient across the whole cheek that dwarfs any blemish. That
  // gradient is smooth and large, so subtracting a heavily blurred copy of the
  // face removes it and leaves only local variation — which is the thing we
  // actually mean by "even skin". Measured directly, tone evenness reproduced
  // at 0.09; the illumination field was the signal.
  const hpL = highPass(Lfield, mask, sw, sh, Math.round(sw * 0.16));
  const hpA = highPass(Afield, mask, sw, sh, Math.round(sw * 0.16));
  const hpB = highPass(Bfield, mask, sw, sh, Math.round(sw * 0.16));

  const keepIdx: number[] = [];
  for (let i = 0; i < sw * sh; i++) {
    if (mask[i] && Lfield[i] >= lo && Lfield[i] <= hi) keepIdx.push(i);
  }

  const toneEvenness = robustSpread(keepIdx.map((i) => hpL[i])) / Math.max(1, meanL);
  const rednessSpread = robustSpread(keepIdx.map((i) => hpA[i]));
  const chromaSpread = robustSpread(keepIdx.map((i) => Math.hypot(hpA[i], hpB[i])));

  // Texture: mean |Laplacian| of lightness over masked interior pixels only,
  // divided by the same operator over the whole face crop. The ratio is what
  // makes it blur-proof — a soft photo drags numerator and denominator
  // together, so softness no longer reads as clear skin.
  let lapSkin = 0, nSkin = 0, lapAll = 0, nAll = 0;
  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const i = y * sw + x;
      const v = Math.abs(4 * Lfield[i] - Lfield[i - 1] - Lfield[i + 1] - Lfield[i - sw] - Lfield[i + sw]);
      lapAll += v;
      nAll++;
      if (mask[i] && Lfield[i] >= lo && Lfield[i] <= hi) {
        lapSkin += v;
        nSkin++;
      }
    }
  }
  const texture = nSkin && nAll && lapAll > 0 ? (lapSkin / nSkin) / (lapAll / nAll) : 0;

  // Under-eye against cheek, both sides pooled. Patch centres are landmarks
  // that sit on skin rather than on a feature edge.
  const patch = (idx: number[], rad: number): number => {
    let sum = 0;
    let n = 0;
    for (const id of idx) {
      const q = toLocal(pt(id));
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          const x = Math.round(q.x + dx);
          const y = Math.round(q.y + dy);
          if (x < 0 || y < 0 || x >= sw || y >= sh) continue;
          const i = y * sw + x;
          if (!mask[i]) continue;
          sum += Lfield[i];
          n++;
        }
      }
    }
    return n ? sum / n : 0;
  };
  const rad = Math.max(2, Math.round(sw * 0.03));
  const under = patch([230, 229, 450, 449], rad);
  const cheek = patch([50, 280, 205, 425], rad);
  const undereyeRatio = cheek > 0 && under > 0 ? under / cheek : 1;

  const coverage = +(keepL.length / (sw * sh)).toFixed(4);
  return {
    toneEvenness: +toneEvenness.toFixed(5),
    rednessSpread: +rednessSpread.toFixed(4),
    chromaSpread: +chromaSpread.toFixed(4),
    texture: +texture.toFixed(4),
    undereyeRatio: +undereyeRatio.toFixed(4),
    coverage,
    reliable: skinReliable(coverage),
  };
}

// Subtract a heavily blurred copy of a field, leaving only local variation.
// The blur is computed over masked pixels only and normalized by how many it
// actually found, so the eye and lip holes don't bleed dark values into the
// skin around them. Separable box blur, run twice — two box passes approximate
// a Gaussian closely enough and stay O(n).
function highPass(
  field: Float32Array,
  mask: Uint8Array,
  w: number,
  h: number,
  radius: number,
): Float32Array {
  const r = Math.max(2, radius);
  let val = new Float32Array(w * h);
  let wt = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (mask[i]) {
      val[i] = field[i];
      wt[i] = 1;
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    for (const horizontal of [true, false]) {
      const nv = new Float32Array(w * h);
      const nw = new Float32Array(w * h);
      const outer = horizontal ? h : w;
      const inner = horizontal ? w : h;
      for (let o = 0; o < outer; o++) {
        let sv = 0;
        let sw2 = 0;
        const at = (k: number) => (horizontal ? o * w + k : k * w + o);
        for (let k = 0; k <= Math.min(r, inner - 1); k++) {
          sv += val[at(k)];
          sw2 += wt[at(k)];
        }
        for (let k = 0; k < inner; k++) {
          const i = at(k);
          nv[i] = sv;
          nw[i] = sw2;
          const add = k + r + 1;
          const drop = k - r;
          if (add < inner) {
            sv += val[at(add)];
            sw2 += wt[at(add)];
          }
          if (drop >= 0) {
            sv -= val[at(drop)];
            sw2 -= wt[at(drop)];
          }
        }
      }
      val = nv;
      wt = nw;
    }
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    out[i] = wt[i] > 1e-6 ? field[i] - val[i] / wt[i] : 0;
  }
  return out;
}
