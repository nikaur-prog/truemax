import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";

// Google's SelfieMulticlass labels:
// 0 background, 1 hair, 2 body skin, 3 face skin, 4 clothes, 5 accessories.
// The image is segmented on-device. No photograph or mask leaves the browser.
const HAIR = 1;
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

/**
 * Start the optional covering detector before a captured frame needs it.
 *
 * The model is substantially larger than the face landmarker. Warming both on
 * the person's first capture intent lets the network and WASM setup overlap
 * the camera/upload interaction instead of presenting that cost as a frozen
 * "Preparing analysis" state after the photograph is already accepted.
 */
export async function warmHeadCovering(): Promise<void> {
  await segmenter();
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
  const hairCategory = new Set([HAIR]);
  // Temple band only. This used to reach down to 80% of face height, which is
  // beside the jaw — and a hood resting on the SHOULDERS put enough fabric
  // there to read as worn. A tester with his hood down was told it was ruining
  // his skin reading. Fabric that matters is fabric beside the temples and
  // ears, which is where a hood actually sits when it is up; anything level
  // with the jaw or below is a collar, a hood on shoulders, or a shirt.
  const sideY0 = y0 + fh * 0.02;
  const sideY1 = y0 + fh * 0.45;
  const leftBox = { x0: x0 - fw * 0.35, x1: x0 + fw * 0.08, y0: sideY0, y1: sideY1 };
  const rightBox = { x0: x1 - fw * 0.08, x1: x1 + fw * 0.35, y0: sideY0, y1: sideY1 };
  const left = ratioIn(data, width, height, leftBox, sideCategories);
  const right = ratioIn(data, width, height, rightBox, sideCategories);
  const leftHair = ratioIn(data, width, height, leftBox, hairCategory);
  const rightHair = ratioIn(data, width, height, rightBox, hairCategory);

  // A hood is a BILATERAL, HAIR-DISPLACING garment, and the check now demands
  // both properties instead of neither. The single-sided max() fired on a
  // shoulder at the edge of frame, and the clothes ratio alone fired on
  // voluminous dark hair — this segmenter's best-known confusion is hair read
  // as clothing, and a tester with curly hair and a plain collared shirt was
  // told he was wearing a hood on EVERY capture, with no way past it.
  //
  //   - both temple bands must read as fabric: a hood that is up flanks both
  //     sides of the head; anything one-sided is a shoulder, a wall, or hair
  //     mislabelled on its shadowed side
  //   - fabric must beat hair where it claims to sit: a hood that is up
  //     COVERS the hair beside the temples, so "hood" and "lots of visible
  //     hair in the same band" cannot both be true
  const sideCoverRatio = Math.min(left, right);
  const displacesHair = left > leftHair && right > rightHair;

  return {
    available: true,
    hatLikely: topCoverRatio >= 0.08,
    hoodLikely: sideCoverRatio >= 0.18 && displacesHair,
    topCoverRatio: +topCoverRatio.toFixed(4),
    sideCoverRatio: +sideCoverRatio.toFixed(4),
  };
}

/**
 * One segmentation pass, shared. The covering check above and the side-seed
 * mask both need the same multiclass categories from the same model, and two
 * modules each holding their own ImageSegmenter would mean a second WASM
 * instance and a second 16 MB model load for the same answer.
 *
 * Returns a copy of the category data (the underlying mask is closed before
 * returning), or null when the model cannot load or segment — callers treat
 * null as "this signal is unavailable", never as an error.
 */
export async function segmentCategories(
  source: HTMLCanvasElement,
): Promise<{ data: Uint8Array; width: number; height: number } | null> {
  try {
    const engine = await segmenter();
    const result = engine.segment(source);
    const mask = result.categoryMask;
    if (!mask) return null;
    const data = new Uint8Array(mask.getAsUint8Array());
    const out = { data, width: mask.width, height: mask.height };
    mask.close();
    return out;
  } catch (error) {
    console.warn("Segmentation unavailable", error);
    return null;
  }
}

export async function detectHeadCovering(source: HTMLCanvasElement): Promise<HeadCoveringCheck> {
  // The structural scan remains usable if the optional 16 MB model cannot
  // load. The screen has already asked for bare, uncovered capture; the
  // returned availability flag keeps this failure visible to diagnostics.
  const seg = await segmentCategories(source);
  if (!seg) return { available: false, hatLikely: false, hoodLikely: false, topCoverRatio: 0, sideCoverRatio: 0 };
  return classifyCoveringMask(seg.data, seg.width, seg.height);
}
