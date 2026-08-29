import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

// ---------------------------------------------------------------------------
// Is this photograph good enough to put in a video?
//
// The rundown crops into the face and holds it on screen at 720x1280 for
// several seconds at a time. A photograph that looks acceptable as a thumbnail
// is enlarged four or five times by that crop, and the result is the fault the
// owner reported: cutaways that are "absolutely horrible with the picture
// quality" once they are moving at full size.
//
// Two independent things go wrong, and they need measuring separately because
// the answer to each is different:
//
//   RESOLUTION. Not enough pixels on the face to fill the crop. Nothing
//   recovers this — sharpening an upscale makes a crunchier upscale — so the
//   honest answer is "use a bigger photograph".
//
//   SOFTNESS. Enough pixels, but the detail in them is mush: missed focus,
//   heavy compression, a screenshot of a screenshot. An unsharp mask genuinely
//   helps here, which is why the offer to run it is worth making at all.
//
// Both are measured on the FACE, not the whole frame. A portrait with a busy
// background scores high on any whole-image sharpness measure while the face
// itself is soft, and the face is the only part the rundown shows.
// ---------------------------------------------------------------------------

export type PhotoQualityVerdict = "ok" | "soft" | "poor";

export interface PhotoQuality {
  /** Face bounding-box height, in source pixels. */
  facePx: number;
  /**
   * Detail energy on the face, as a fraction of local contrast.
   *
   * Mean absolute Laplacian divided by the region's own standard deviation, so
   * it answers "how much of this face's contrast is fine detail" rather than
   * "how contrasty is this face". A dark photo and a bright one of the same
   * sharpness land in the same place; a blurred one does not.
   */
  sharpness: number;
  verdict: PhotoQualityVerdict;
  /** One plain sentence, for showing to the person who chose the photo. */
  reason: string;
  /** True when an unsharp mask is worth offering. Resolution faults are not. */
  fixable: boolean;
}

/**
 * Face height below which the rundown is visibly enlarging the photograph.
 *
 * The crop is about 1.5 face-heights tall (the head plus the CROWN allowance)
 * and is drawn into a 1280-tall frame, so the face lands on screen at roughly
 * 1280 / 1.5 = 850px. A source face of 850px is therefore break-even. Below
 * ~520 the enlargement is past 1.6x and starts to show on a still frame; below
 * ~320 it is past 2.6x and shows in motion, which is worse.
 */
const FACE_PX_SOFT = 520;
const FACE_PX_POOR = 320;

/**
 * Detail thresholds, measured rather than guessed.
 *
 * Taken from the six demo portraits in public/demo (440x550 each), read at
 * full resolution and then again after being shrunk and blown back up, which
 * is what a low-resolution or re-compressed source actually looks like:
 *
 *     full        0.150 - 0.298
 *     halved      0.051 - 0.075     visibly soft at video size
 *     quartered   0.030 - 0.039     bad
 *     eighth      0.023 - 0.029     unusable
 *
 * The bands do not overlap, so the thresholds go in the gaps: 0.09 sits below
 * every sharp photo and above every halved one, and 0.045 sits below every
 * halved one and above every quartered one. A halved photo therefore reads
 * "soft" and a quartered one "poor", which is the call a person would make
 * looking at them.
 *
 * Deliberately placed in the gaps rather than at the edges: this feature
 * interrupts somebody to tell them their photo is bad, and being wrong about
 * that is worse than staying quiet.
 */
const SHARP_SOFT = 0.09;
const SHARP_POOR = 0.045;

/** The face's bounding box in pixels, or the middle of the frame without one. */
function faceBox(
  width: number,
  height: number,
  landmarks?: NormalizedLandmark[] | null,
): { x: number; y: number; w: number; h: number } {
  if (!landmarks || !landmarks.length) {
    // No mesh is not the same as no face — a cutaway that will not landmark is
    // still a photograph of somebody. Measure the middle half, which is where
    // a portrait's subject is, rather than refusing to answer.
    return { x: width * 0.25, y: height * 0.2, w: width * 0.5, h: height * 0.6 };
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of landmarks) {
    x0 = Math.min(x0, p.x * width);
    y0 = Math.min(y0, p.y * height);
    x1 = Math.max(x1, p.x * width);
    y1 = Math.max(y1, p.y * height);
  }
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/**
 * Mean |Laplacian| over the region, divided by the region's own contrast.
 *
 * Exported for the tests, which feed it a sharp checkerboard and a blurred one
 * and assert the ordering rather than either absolute value — an absolute is
 * the thing most likely to drift with a different sampling stride.
 */
export function detailEnergy(
  px: Uint8ClampedArray,
  width: number,
  box: { x: number; y: number; w: number; h: number },
): number {
  const x0 = Math.max(1, Math.round(box.x));
  const y0 = Math.max(1, Math.round(box.y));
  const x1 = Math.round(box.x + box.w);
  const y1 = Math.round(box.y + box.h);
  // A stride, because this runs on the main thread while somebody waits. Every
  // third pixel is far more than enough for a mean over a face-sized region,
  // and the Laplacian is still taken over ADJACENT pixels so the stride
  // subsamples the measurement without blurring it.
  const step = 3;
  const luma = (ix: number, iy: number): number => {
    const i = (iy * width + ix) * 4;
    return 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!;
  };
  let lapSum = 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = y0; y < y1 - 1; y += step) {
    for (let x = x0; x < x1 - 1; x += step) {
      const c = luma(x, y);
      const lap = Math.abs(4 * c - luma(x - 1, y) - luma(x + 1, y) - luma(x, y - 1) - luma(x, y + 1));
      lapSum += lap;
      sum += c;
      sumSq += c * c;
      n++;
    }
  }
  if (n < 16) return 1;
  const mean = sum / n;
  const variance = Math.max(1, sumSq / n - mean * mean);
  // Divided by the standard deviation, not the mean: a face against a black
  // background has a low mean and normal contrast, and dividing by the mean
  // would call it razor sharp.
  return lapSum / n / Math.sqrt(variance);
}

/**
 * Assess one photograph. Cheap enough to run the moment a file is chosen.
 *
 * `landmarks` is optional — a cutaway that failed to landmark still gets an
 * answer, from the middle of the frame.
 */
export function assessPhotoQuality(
  source: HTMLCanvasElement | HTMLImageElement,
  landmarks?: NormalizedLandmark[] | null,
): PhotoQuality {
  const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  const box = faceBox(width, height, landmarks);
  if (width < 8 || height < 8) {
    return { facePx: box.h, sharpness: 1, verdict: "ok", reason: "", fixable: false };
  }

  // Read only a bounded face crop. A modern phone image can be 48MP: copying
  // the whole thing into a canvas and then getImageData() allocated hundreds
  // of megabytes just to inspect the small region the rundown will display.
  // The source face height is retained for the resolution verdict; only the
  // sharpness sample is downscaled.
  const pad = Math.max(2, Math.min(box.w, box.h) * 0.02);
  const sx = Math.max(0, Math.floor(box.x - pad));
  const sy = Math.max(0, Math.floor(box.y - pad));
  const ex = Math.min(width, Math.ceil(box.x + box.w + pad));
  const ey = Math.min(height, Math.ceil(box.y + box.h + pad));
  const cropW = Math.max(1, ex - sx);
  const cropH = Math.max(1, ey - sy);
  const SAMPLE_MAX = 768;
  const scale = Math.min(1, SAMPLE_MAX / Math.max(cropW, cropH));
  const sampleW = Math.max(8, Math.round(cropW * scale));
  const sampleH = Math.max(8, Math.round(cropH * scale));
  const sample = document.createElement("canvas");
  sample.width = sampleW;
  sample.height = sampleH;
  const ctx = sample.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return { facePx: box.h, sharpness: 1, verdict: "ok", reason: "", fixable: false };
  }
  ctx.drawImage(source, sx, sy, cropW, cropH, 0, 0, sampleW, sampleH);
  const px = ctx.getImageData(0, 0, sampleW, sampleH).data;
  const sampleBox = {
    x: (box.x - sx) * scale,
    y: (box.y - sy) * scale,
    w: box.w * scale,
    h: box.h * scale,
  };
  const sharpness = detailEnergy(px, sampleW, sampleBox);
  const facePx = box.h;

  // Resolution is reported first when both are bad, because it is the one the
  // person can actually do something about and the sharpen cannot.
  if (facePx < FACE_PX_POOR) {
    return {
      facePx,
      sharpness,
      verdict: "poor",
      reason: "There are not enough pixels on the face for video. A larger photo is the only fix.",
      fixable: false,
    };
  }
  if (sharpness < SHARP_POOR) {
    return {
      facePx,
      sharpness,
      verdict: "poor",
      reason: "The face is very soft. Sharpening will help, but a clearer photo will help more.",
      fixable: true,
    };
  }
  if (facePx < FACE_PX_SOFT) {
    return {
      facePx,
      sharpness,
      verdict: "soft",
      reason: "This photo is small for video, so it will be enlarged. A larger one holds up better.",
      fixable: false,
    };
  }
  if (sharpness < SHARP_SOFT) {
    return {
      facePx,
      sharpness,
      verdict: "soft",
      reason: "The face is a little soft. Sharpening it usually helps.",
      fixable: true,
    };
  }
  return { facePx, sharpness, verdict: "ok", reason: "", fixable: false };
}
