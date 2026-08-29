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
  let headPixels = 0;
  let faceSumX = 0;
  let faceN = 0;
  let headSumX = 0;
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x < w; x++) {
      const c = data[y * w + x];
      const isHead = c === HAIR || c === FACE_SKIN;
      if (isHead) {
        headPixels++;
        headSumX += x;
        if (headL[y] < 0) headL[y] = x;
        headR[y] = x;
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

  // The face sits forward of the head's centre of mass — that is what a
  // profile IS — so the sign of that offset is the facing. This does not have
  // the mesh-centroid flip failure: no hallucinated far side exists in a mask.
  const faceDir: 1 | -1 = faceSumX / faceN >= headSumX / headPixels ? 1 : -1;

  let faceTop = -1;
  let faceBottom = -1;
  const front = new Float32Array(h).fill(NaN);
  for (let y = 0; y < h; y++) {
    if (faceL[y] < 0) continue;
    if (faceTop < 0) faceTop = y;
    faceBottom = y;
    front[y] = faceDir === 1 ? faceR[y] : faceL[y];
  }
  if (faceTop < 0 || faceBottom - faceTop < h * 0.08) return null;

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
    headFraction: headPixels / (w * h),
  };
}
