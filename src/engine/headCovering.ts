import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";

// Google's SelfieMulticlass labels:
// 0 background, 1 hair, 2 body skin, 3 face skin, 4 clothes, 5 accessories.
// The image is segmented on-device. No photograph or mask leaves the browser.
const FACE_SKIN = 3;
const CLOTHES = 4;
const ACCESSORY = 5;
const MODEL = "/models/selfie_multiclass_256x256.tflite";

export interface HeadCoveringCheck {
  available: boolean;
  hatLikely: boolean;
  hoodLikely: boolean;
  topCoverRatio: number;
  sideCoverRatio: number;
}

let segmenterPromise: Promise<ImageSegmenter> | null = null;

function segmenter(): Promise<ImageSegmenter> {
  return (segmenterPromise ??= (async () => {
    const fileset = await FilesetResolver.forVisionTasks("/wasm");
    return ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate: "CPU" },
      runningMode: "IMAGE",
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    });
  })());
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function ratioIn(
  data: Uint8Array,
  width: number,
  height: number,
  box: Box,
  categories: Set<number>,
): number {
  const x0 = clamp(Math.floor(box.x0), 0, width - 1);
  const x1 = clamp(Math.ceil(box.x1), x0 + 1, width);
  const y0 = clamp(Math.floor(box.y0), 0, height - 1);
  const y1 = clamp(Math.ceil(box.y1), y0 + 1, height);
  let hit = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      hit += categories.has(data[y * width + x]) ? 1 : 0;
      n++;
    }
  }
  return n ? hit / n : 0;
}

export function classifyCoveringMask(data: Uint8Array, width: number, height: number): HeadCoveringCheck {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  let skinPixels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] !== FACE_SKIN) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
      skinPixels++;
    }
  }
  // A confident face-skin area is required before asking where clothing sits.
  // Otherwise a wall patch labelled "clothes" could become a hood.
  if (skinPixels < width * height * 0.012 || x1 <= x0 || y1 <= y0) {
    return { available: true, hatLikely: false, hoodLikely: false, topCoverRatio: 0, sideCoverRatio: 0 };
  }

  const fw = x1 - x0 + 1;
  const fh = y1 - y0 + 1;
  const topCoverRatio = ratioIn(data, width, height, {
    x0: x0 - fw * 0.18,
    x1: x1 + fw * 0.18,
    y0: y0 - fh * 0.38,
    y1: y0 + fh * 0.08,
  }, new Set([CLOTHES, ACCESSORY]));
  const sideCategories = new Set([CLOTHES]);
  const sideY0 = y0 + fh * 0.05;
  const sideY1 = y0 + fh * 0.8;
  const left = ratioIn(data, width, height, {
    x0: x0 - fw * 0.35,
    x1: x0 + fw * 0.08,
    y0: sideY0,
    y1: sideY1,
  }, sideCategories);
  const right = ratioIn(data, width, height, {
    x0: x1 - fw * 0.08,
    x1: x1 + fw * 0.35,
    y0: sideY0,
    y1: sideY1,
  }, sideCategories);
  const sideCoverRatio = Math.max(left, right);

  return {
    available: true,
    hatLikely: topCoverRatio >= 0.08,
    hoodLikely: sideCoverRatio >= 0.14,
    topCoverRatio: +topCoverRatio.toFixed(4),
    sideCoverRatio: +sideCoverRatio.toFixed(4),
  };
}

export async function detectHeadCovering(source: HTMLCanvasElement): Promise<HeadCoveringCheck> {
  try {
    const engine = await segmenter();
    const result = engine.segment(source);
    const mask = result.categoryMask;
    if (!mask) return { available: false, hatLikely: false, hoodLikely: false, topCoverRatio: 0, sideCoverRatio: 0 };
    const check = classifyCoveringMask(mask.getAsUint8Array(), mask.width, mask.height);
    mask.close();
    return check;
  } catch (error) {
    // The structural scan remains usable if the optional 16 MB model cannot
    // load. The screen has already asked for bare, uncovered capture; the
    // returned availability flag keeps this failure visible to diagnostics.
    console.warn("Head-covering check unavailable", error);
    return { available: false, hatLikely: false, hoodLikely: false, topCoverRatio: 0, sideCoverRatio: 0 };
  }
}
