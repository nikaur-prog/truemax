// ---------------------------------------------------------------------------
// The shared arithmetic under the skin measurements.
//
// skin.ts turns a photograph into five statistics; skinPatterns.ts turns the
// same fields into visible patterns with a place and a size. Both need the
// same things: a perceptual colour space, a masked blur that does not let the
// eye and lip holes bleed into the skin around them, a robust spread, a
// point-in-polygon test, and connected components. They live here, with no
// dependency on a canvas or on MediaPipe, so every one of them can be tested
// in Node on a synthetic array, which is the only way a detector's threshold
// can be pinned before real faces exist to check it against.
//
// The two rules from skin.ts hold here too and are what every function below
// is shaped by: nothing is a diagnosis, and every measure is relative to the
// person's own skin rather than to a population.
// ---------------------------------------------------------------------------

export type Pt = { x: number; y: number };

export interface SkinFields {
  sw: number;
  sh: number;
  /** CIE L*, a*, b* per sample pixel. */
  L: Float32Array;
  A: Float32Array;
  B: Float32Array;
  /** 1 where the pixel is skin inside the face and outside every hole. */
  mask: Uint8Array;
  /** 1 where mask is 1 AND lightness is inside the trimmed tails (hair, frames and blown highlights removed). */
  keep: Uint8Array;
  keepCount: number;
  meanL: number;
  meanA: number;
  meanB: number;
  lo: number;
  hi: number;
  /** keepCount over the whole sample. */
  coverage: number;
}

export function toLab(r: number, g: number, b: number): [number, number, number] {
  const lin = (c: number) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const R = lin(r), G = lin(g), Bc = lin(b);
  const X = (R * 0.4124 + G * 0.3576 + Bc * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + Bc * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + Bc * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function inside(poly: Pt[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** Grow or shrink a polygon about its own centroid. */
export function dilate(poly: Pt[], k: number): Pt[] {
  const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
  return poly.map((p) => ({ x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k }));
}

export function pct(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[i];
}

/** Robust spread: half the 10 to 90 range. Resists a shadow down one side. */
export function robustSpread(values: number[]): number {
  if (values.length < 4) return 0;
  const s = [...values].sort((a, b) => a - b);
  return (pct(s, 0.9) - pct(s, 0.1)) / 2;
}

/**
 * Separable box blur over masked pixels only, run twice (two box passes
 * approximate a Gaussian closely enough and stay O(n)), normalised by the
 * weight it actually found so a hole never darkens the skin beside it.
 * Returns the blurred field; 0 where nothing was in reach.
 */
export function maskedBlur(field: Float32Array, mask: Uint8Array, w: number, h: number, radius: number): Float32Array {
  const r = Math.max(1, radius);
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
  for (let i = 0; i < w * h; i++) out[i] = wt[i] > 1e-6 ? val[i] / wt[i] : 0;
  return out;
}

/** The field minus its own heavily blurred copy: local variation only. */
export function highPass(field: Float32Array, mask: Uint8Array, w: number, h: number, radius: number): Float32Array {
  const blurred = maskedBlur(field, mask, w, h, radius);
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = mask[i] ? field[i] - blurred[i] : 0;
  return out;
}

/**
 * Convert RGBA sample pixels into masked Lab fields. `skinPoly` is the face
 * in sample coordinates, `holes` the features to exclude. Null when there is
 * too little skin to say anything, which is also what skin.ts refuses on.
 */
export function extractSkinFields(
  data: Uint8ClampedArray | Uint8Array,
  sw: number,
  sh: number,
  skinPoly: Pt[],
  holes: Pt[][],
): SkinFields | null {
  const n = sw * sh;
  const L = new Float32Array(n);
  const A = new Float32Array(n);
  const B = new Float32Array(n);
  const mask = new Uint8Array(n);
  const Ls: number[] = [];
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = y * sw + x;
      const p = i * 4;
      const [l, a, b] = toLab(data[p], data[p + 1], data[p + 2]);
      L[i] = l;
      A[i] = a;
      B[i] = b;
      if (!inside(skinPoly, x + 0.5, y + 0.5)) continue;
      if (holes.some((hole) => inside(hole, x + 0.5, y + 0.5))) continue;
      mask[i] = 1;
      Ls.push(l);
    }
  }
  if (Ls.length < 400) return null;
  const sorted = [...Ls].sort((a, b) => a - b);
  const lo = pct(sorted, 0.08);
  const hi = pct(sorted, 0.97);
  const keep = new Uint8Array(n);
  let keepCount = 0;
  let sumL = 0, sumA = 0, sumB = 0;
  for (let i = 0; i < n; i++) {
    if (!mask[i] || L[i] < lo || L[i] > hi) continue;
    keep[i] = 1;
    keepCount++;
    sumL += L[i];
    sumA += A[i];
    sumB += B[i];
  }
  if (keepCount < 300) return null;
  return {
    sw, sh, L, A, B, mask, keep, keepCount,
    meanL: sumL / keepCount,
    meanA: sumA / keepCount,
    meanB: sumB / keepCount,
    lo, hi,
    coverage: +(keepCount / n).toFixed(4),
  };
}

export interface Component {
  size: number;
  cx: number;
  cy: number;
}

/** Four-connected components of a binary field, iterative so a big blob cannot blow the stack. */
export function components(binary: Uint8Array, w: number, h: number): Component[] {
  const seen = new Uint8Array(w * h);
  const out: Component[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!binary[start] || seen[start]) continue;
    seen[start] = 1;
    stack.push(start);
    let size = 0, sx = 0, sy = 0;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      sx += i % w;
      sy += Math.floor(i / w);
      const x = i % w;
      const y = Math.floor(i / w);
      const around = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of around) {
        if (j < 0 || seen[j] || !binary[j]) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    out.push({ size, cx: sx / size, cy: sy / size });
  }
  return out;
}

/**
 * Mean absolute Laplacian of lightness over kept pixels, divided by the same
 * over the whole sample. A soft photograph drags both together, so softness
 * reads as softness rather than as clear skin. Below about 0.55 the picture
 * is too soft to trust a spot count.
 */
export function textureRatio(L: Float32Array, keep: Uint8Array, w: number, h: number): number {
  let lapSkin = 0, nSkin = 0, lapAll = 0, nAll = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = Math.abs(4 * L[i] - L[i - 1] - L[i + 1] - L[i - w] - L[i + w]);
      lapAll += v;
      nAll++;
      if (keep[i]) {
        lapSkin += v;
        nSkin++;
      }
    }
  }
  return nSkin && nAll && lapAll > 0 ? (lapSkin / nSkin) / (lapAll / nAll) : 0;
}
