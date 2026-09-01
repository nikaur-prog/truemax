// ---------------------------------------------------------------------------
// On-device enhancement: sharpen, colour, contrast.
//
// This is deliberately NOT an AI upscaler. We ran a real TikTok through a
// state-of-the-art neural video enhancer while deciding what to build, and it
// hallucinated glossy plastic detail onto a face — worse than the compression
// it was fixing. What actually rescues soft, over-compressed phone footage is
// far more boring: resample it cleanly to the target size, bring back the edge
// contrast the encoder smeared away (unsharp mask), and give the colour the
// small push flat mobile footage always needs. Every operation here recovers
// or emphasises information that is IN the frame; nothing invents detail that
// is not. That is why the result can be trusted on faces.
//
// Pure array math on RGBA pixels, no canvas and no DOM, so the whole pipeline
// is unit-testable in node and behaves identically at preview size and at
// export size.
// ---------------------------------------------------------------------------

export interface EnhanceLook {
  /** Unsharp-mask amount. 0 = off; ~0.7 is a confident but honest sharpen. */
  sharpen: number;
  /** Saturation multiplier around luma. 1 = untouched. */
  saturation: number;
  /** Contrast multiplier around mid-grey. 1 = untouched. */
  contrast: number;
  /**
   * Blur radius of the unsharp mask, in PIXELS AT THE PROCESSED SIZE. Callers
   * must scale this with the frame (see lookFor) or the same look would read
   * strong on a thumbnail and invisible on a 4K frame.
   */
  radius: number;
}

/** The three strengths the panel offers. Radius here is for a ~1080p frame. */
export const LOOKS: Record<"subtle" | "standard" | "strong", EnhanceLook> = {
  subtle: { sharpen: 0.35, saturation: 1.05, contrast: 1.03, radius: 1 },
  standard: { sharpen: 0.7, saturation: 1.1, contrast: 1.07, radius: 2 },
  strong: { sharpen: 1.05, saturation: 1.16, contrast: 1.11, radius: 3 },
};

/** A look with its radius scaled for the frame it will actually process. */
export function lookFor(base: EnhanceLook, longEdge: number): EnhanceLook {
  const scale = Math.max(0.5, longEdge / 1920);
  return { ...base, radius: Math.max(1, Math.round(base.radius * scale)) };
}

/**
 * One separable box-blur pass over a single channel. Two passes of this
 * approximate a gaussian closely enough for an unsharp mask, at a cost that
 * stays linear in pixels whatever the radius — which is what makes per-frame
 * video processing viable in plain JS.
 */
function blurPass(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const win = 2 * r + 1;
  // Horizontal.
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      dst[row + x] = sum / win;
      const out = Math.max(0, x - r);
      const inn = Math.min(w - 1, x + r + 1);
      sum += src[row + inn] - src[row + out];
    }
  }
  // Vertical, in place on dst using a column buffer.
  const col = new Float32Array(h);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += dst[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      col[y] = sum / win;
      const out = Math.max(0, y - r);
      const inn = Math.min(h - 1, y + r + 1);
      sum += dst[inn * w + x] - dst[out * w + x];
    }
    for (let y = 0; y < h; y++) dst[y * w + x] = col[y];
  }
}

/**
 * Enhance RGBA pixels in place. Alpha is untouched.
 *
 * Order matters and is fixed: sharpen first (it works on the luminance
 * relationships the source actually has), then saturation around the
 * sharpened luma, then contrast last so it operates on the final tones.
 */
export function applyEnhance(px: Uint8ClampedArray, w: number, h: number, look: EnhanceLook): void {
  const n = w * h;
  if (px.length < n * 4) throw new Error("pixel buffer smaller than dimensions");
  const r = Math.max(1, Math.round(look.radius));

  const chans = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    chans[0][i] = px[i * 4];
    chans[1][i] = px[i * 4 + 1];
    chans[2][i] = px[i * 4 + 2];
  }

  // Two box passes per channel ≈ gaussian; blurred stays separate because the
  // mask is (source - blur).
  const blurred = chans.map((c) => {
    const a = new Float32Array(c);
    const b = new Float32Array(n);
    blurPass(a, b, w, h, r);
    blurPass(b, a, w, h, r);
    return a;
  });

  const { sharpen, saturation, contrast } = look;
  for (let i = 0; i < n; i++) {
    let red = chans[0][i] + sharpen * (chans[0][i] - blurred[0][i]);
    let grn = chans[1][i] + sharpen * (chans[1][i] - blurred[1][i]);
    let blu = chans[2][i] + sharpen * (chans[2][i] - blurred[2][i]);
    if (saturation !== 1) {
      const luma = 0.2126 * red + 0.7152 * grn + 0.0722 * blu;
      red = luma + (red - luma) * saturation;
      grn = luma + (grn - luma) * saturation;
      blu = luma + (blu - luma) * saturation;
    }
    if (contrast !== 1) {
      red = 128 + (red - 128) * contrast;
      grn = 128 + (grn - 128) * contrast;
      blu = 128 + (blu - 128) * contrast;
    }
    px[i * 4] = red;
    px[i * 4 + 1] = grn;
    px[i * 4 + 2] = blu;
  }
}

/**
 * Mean absolute horizontal gradient — a cheap edge-energy figure used by the
 * tests to prove sharpening does what it claims, and useful for a sanity
 * check on any frame ("did this pass actually change anything").
 */
export function edgeEnergy(px: Uint8ClampedArray, w: number, h: number): number {
  let sum = 0;
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 1; x < w; x++) {
      const i = (y * w + x) * 4;
      sum += Math.abs(px[i] - px[i - 4]) + Math.abs(px[i + 1] - px[i - 3]) + Math.abs(px[i + 2] - px[i - 2]);
      count++;
    }
  }
  return count ? sum / count : 0;
}

// --- how big the output gets ------------------------------------------------
//
// This used to aim every source at a 1920 long edge, which meant the tool did
// nothing at all to the files people actually feed it. A phone photo is 4032px
// on the long edge and a screen recording is 1920: both were already at or
// past the target, so both came back the same size they went in, silently,
// under a button that promised a 4K upscale. The target was the bug.
//
// Images now aim at 4K. Video does not: every frame is resampled and unsharp
// masked in plain JS on the person's own device, so quadrupling the pixel
// count quadruples a cost that is already the slowest thing here. The two
// targets are separate constants and every caller names the one it wants,
// because a shared default is how they drifted apart in the first place.

/** Long-edge targets, in pixels. */
export const IMAGE_TARGET = 3840;
export const VIDEO_TARGET = 1920;

/**
 * The most pixels this will ever invent. Past 2x, a clean resample of a soft
 * source is just a bigger soft source, and the sharpening cannot rescue detail
 * the encoder already threw away.
 */
export const MAX_UPSCALE = 2;

export type UpscaleReason = "upscaled" | "already-sharp" | "capped";

export interface UpscalePlan {
  scale: number;
  /** The output size, even-rounded by the caller if it needs to be. */
  w: number;
  h: number;
  reason: UpscaleReason;
}

/**
 * What will happen to a source of this size, worked out BEFORE any pixels
 * move so the panel can say it out loud.
 *
 * There are exactly three outcomes and they must be told apart. A real
 * upscale; a source already at or above the target, which is left alone and
 * only sharpened; and a source so small that the 2x ceiling binds before the
 * target is reached. Reporting the second as though it were the first is what
 * made this tool look broken, so the reason travels with the numbers.
 */
export function upscalePlan(w: number, h: number, target: number): UpscalePlan {
  const long = Math.max(w, h);
  if (!Number.isFinite(long) || long <= 0) return { scale: 1, w, h, reason: "already-sharp" };
  if (long >= target) return { scale: 1, w, h, reason: "already-sharp" };
  const wanted = target / long;
  const scale = Math.min(MAX_UPSCALE, wanted);
  return {
    scale,
    w: Math.max(2, Math.round(w * scale)),
    h: Math.max(2, Math.round(h * scale)),
    reason: wanted > MAX_UPSCALE ? "capped" : "upscaled",
  };
}

/**
 * Just the scale. The target is required rather than defaulted: the whole
 * defect this replaces was a single hidden number applying to two callers that
 * wanted different things.
 */
export function upscaleFor(w: number, h: number, target: number): number {
  return upscalePlan(w, h, target).scale;
}
