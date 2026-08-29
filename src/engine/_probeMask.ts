import { segmentCategories } from "./headCovering.js";

// ---------------------------------------------------------------------------
// The head, as the segmentation model actually sees it.
//
// The side seeder's old foreground mask was a colour model built from the top
// corners of the frame — a heuristic that returned nothing usable on ordinary
// bedroom photographs, which is why every true profile fell through to a
// blind, centred ladder of points (the "atrocious" seeds). The app has been
// shipping a real segmentation model all along for the head-covering check,
// and its multiclass output answers the seeder's questions directly:
//
//   hair (1) + face skin (3)      = the head, for "is this point on the person"
//   face skin alone               = the FACE, whose front edge IS the profile
//                                   line the nine front landmarks sit on
//   the hair/face boundary on top = the hairline, which is trichion by
//                                   definition rather than by guesswork
//
// Everything here is measured on the mask at the segmenter's own resolution
// and reported with scale factors back to the source canvas. All of it runs
// on-device; no photograph or mask leaves the browser.
// ---------------------------------------------------------------------------

const HAIR = 1;
const FACE_SKIN = 3;
const BODY_SKIN = 2;

export interface SideMaskGeometry {
  /** Mask resolution. */
  w: number;
  h: number;
  /** Multiply mask coordinates by these to reach source-canvas pixels. */
  scaleX: number;
  scaleY: number;
  /** Which way the face points in the image: +1 right, -1 left. */
  faceDir: 1 | -1;
  /** First and last mask rows holding a solid run of face skin. */
  faceTop: number;
  faceBottom: number;
  /**
   * The face's front edge per mask row: the most faceDir-ward face-skin pixel,
   * NaN where the row has none. This is the profile line.
   */
  front: Float32Array;
  /** Head (hair + face skin) horizontal span per row, null where empty. */
  headSpan: (y: number) => [number, number] | null;
  personSpan: (y: number) => [number, number] | null;
  /** Fraction of head pixels in the mask, for a cheap sanity signal. */
  headFraction: number;
}

/** Smallest run of face pixels a row needs before it counts. Kills speckle. */
const MIN_RUN_FRACTION = 0.02;

export async function sideMaskGeometry(canvas: HTMLCanvasElement): Promise<SideMaskGeometry | null> {
  const seg = await segmentCategories(canvas);
  if (!seg) return null;
  const { data, width: w, height: h } = seg;

  const minRun = Math.max(2, Math.round(w * MIN_RUN_FRACTION));

  // Row spans, one pass. Face rows demand a contiguous-ish run rather than a
  // pixel count: a scatter of mislabelled pixels on a busy wall must not
  // become a face row.
  const faceL = new Int16Array(h).fill(-1);
  const faceR = new Int16Array(h).fill(-1);
  const headL = new Int16Array(h).fill(-1);
  const headR = new Int16Array(h).fill(-1);
  const personL = new Int16Array(h).fill(-1);
  const personR = new Int16Array(h).fill(-1);
  const hairL = new Int16Array(h).fill(-1);
  const hairR = new Int16Array(h).fill(-1);
  let headPixels = 0;
  let faceSumX = 0;
  let faceN = 0;
  let headSumX = 0;
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x < w; x++) {
      const c = data[y * w + x];
      const isHead = c === HAIR || c === FACE_SKIN;
      if (isHead || c === BODY_SKIN) {
        if (personL[y] < 0) personL[y] = x;
        personR[y] = x;
      }
      if (isHead) {
        headPixels++;
        headSumX += x;
        if (headL[y] < 0) headL[y] = x;
        headR[y] = x;
      }
      if (c === HAIR) {
        if (hairL[y] < 0) hairL[y] = x;
        hairR[y] = x;
      }
      if (c === FACE_SKIN) {
        run++;
        faceSumX += x;
        faceN++;
        if (run >= minRun) {
          const start = x - run + 1;
          if (faceL[y] < 0 || start < faceL[y]) faceL[y] = start;
          if (x > faceR[y]) faceR[y] = x;
        }
      } else {
        run = 0;
      }
    }
  }
  if (faceN < w * h * 0.005 || headPixels < w * h * 0.02) return null;

  let faceTop = -1;
  let faceBottom = -1;
  for (let y = 0; y < h; y++) {
    if (faceL[y] < 0) continue;
    if (faceTop < 0) faceTop = y;
    faceBottom = y;
  }
  if (faceTop < 0 || faceBottom - faceTop < h * 0.08) return null;

  // Which way does the face point? Three witnesses, in order of reliability,
  // each validated against the 60-face labeled dataset.
  //
  // 1) HAIR. On a profile, head hair sits BEHIND the face — so on each face
  //    row, note which side of the face span holds hair pixels, and the
  //    heavier side is the back of the head. Restricted to the upper head
  //    (crown down to 40% of face height) because a beard is "hair" too and
  //    it sits IN FRONT: s038's beard was the single face this test got
  //    wrong until the bottom rows were excluded. With any head hair at all
  //    this signal was correct on every face in the dataset.
  //
  // 2) A bald head has no hair witness, but offers a better one: with the
  //    scalp read as skin, the face mask's horizontal extremes are the nose
  //    and the occiput — and only a handful of rows graze the nose tip,
  //    while the round back of the skull is shared by a broad band. The
  //    narrow extreme is the front.
  //
  // 3) The face-vs-head centroid offset survives as the last tiebreak. It
  //    was the original, single test, and it is right except on bald or
  //    heavily bearded heads — which the two shape tests above now decide.
  const faceSpan = faceBottom - faceTop;
  let headTop = faceTop;
  for (let y = 0; y < h; y++) {
    if (headL[y] >= 0) {
      headTop = y;
      break;
    }
  }
  const upperLimit = faceTop + Math.round(faceSpan * 0.4);
  let hairBehindL = 0;
  let hairBehindR = 0;
  for (let y = headTop; y <= upperLimit; y++) {
    if (faceL[y] < 0) continue;
    if (hairL[y] >= 0 && hairL[y] < faceL[y]) hairBehindL++;
    if (hairR[y] >= 0 && hairR[y] > faceR[y]) hairBehindR++;
  }

  const tol = w * 0.03;
  let faceMinX = w;
  let faceMaxX = -1;
  for (let y = faceTop; y <= faceBottom; y++) {
    if (faceL[y] < 0) continue;
    if (faceL[y] < faceMinX) faceMinX = faceL[y];
    if (faceR[y] > faceMaxX) faceMaxX = faceR[y];
  }
  let rowsNearL = 0;
  let rowsNearR = 0;
  for (let y = faceTop; y <= faceBottom; y++) {
    if (faceL[y] < 0) continue;
    if (faceL[y] <= faceMinX + tol) rowsNearL++;
    if (faceR[y] >= faceMaxX - tol) rowsNearR++;
  }

  let faceDir: 1 | -1;
  if (Math.abs(hairBehindL - hairBehindR) >= Math.max(8, h * 0.02)) {
    faceDir = hairBehindL > hairBehindR ? 1 : -1;
  } else if (Math.abs(rowsNearL - rowsNearR) >= h * 0.02) {
    faceDir = rowsNearL < rowsNearR ? -1 : 1;
  } else {
    faceDir = faceSumX / faceN >= headSumX / headPixels ? 1 : -1;
  }

  const front = new Float32Array(h).fill(NaN);
  for (let y = 0; y < h; y++) {
    if (faceL[y] < 0) continue;
    front[y] = faceDir === 1 ? faceR[y] : faceL[y];
  }

  return {
    w,
    h,
    scaleX: canvas.width / w,
    scaleY: canvas.height / h,
    faceDir,
    faceTop,
    faceBottom,
    front,
    headSpan: (y: number) => {
      const yy = Math.round(y);
      if (yy < 0 || yy >= h || headL[yy] < 0) return null;
      return [headL[yy], headR[yy]];
    },
    personSpan: (y: number) => {
      const yy = Math.round(y);
      if (yy < 0 || yy >= h || personL[yy] < 0) return null;
      return [personL[yy], personR[yy]];
    },
    headFraction: headPixels / (w * h),
  };
}
