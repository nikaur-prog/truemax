import { FaceLandmarker } from "@mediapipe/tasks-vision";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { Pt } from "./geometry.ts";

// ---------------------------------------------------------------------------
// Glasses.
//
// A frame sits across the nose bridge and rings the orbits, which is exactly
// where the eye and brow metrics are read. It does not stop the landmarker —
// MediaPipe returns a full, confident mesh straight through a pair of frames —
// so nothing downstream notices, and the scan comes back confidently wrong.
//
// Asking people to take them off before they start does most of the work. This
// is for when they don't.
//
// TWO RULES, the same shape as the ones in skin.ts.
//
// 1. THIS IDENTIFIES NOTHING. It measures horizontal edge energy across the
//    bridge of a nose and compares it against that same face's own cheek. "A
//    hard line across the bridge of your nose" is the measurement; "glasses" is
//    what it gets called, because that is what it almost always is. It cannot
//    tell a frame from a scar and does not claim to.
//
// 2. THE NUMBER IS A RATIO AGAINST THE SAME FACE. An absolute edge count would
//    track sharpness, camera and contrast far more strongly than eyewear — a
//    crisp 12MP portrait has more edges everywhere than a webcam frame does.
//    Dividing by a control patch of the person's own cheek cancels all of it,
//    the same way the blur metric cancels exposure. It also keeps the measure
//    away from skin tone, which any absolute threshold would quietly encode.
//
// ---------------------------------------------------------------------------
// WHAT IS NOT HERE: hats and hoods.
//
// They were attempted and the attempt failed, which is worth recording so it is
// not tried again the same way. The feature was the strongest horizontal edge
// running across the forehead, gated on the forehead also being darker than the
// cheeks — a brim casts a shadow. Measured over the same 229 faces, the twenty
// highest scores were seventeen people with hair on their forehead and three
// people in headwear. The shadow gate did not rescue it: the two clearest hats
// in the set were both lit brightly enough to make the forehead LIGHTER than
// the cheeks, so the conjunction caught one cap and two fringes.
//
// A fringe is far more common than a cap. Telling someone with hair to take
// their hat off is worse than saying nothing, since the capture screen already
// asks.
//
// SECOND ATTEMPT, also failed: texture. The reasoning was that hair has strand
// detail at a fine scale while fabric is a broad flat field, so high-frequency
// energy in the band above the hairline — over the same quantity on the
// person's own cheek — should tell them apart. Measured against 229 bare heads
// and 9 portraits in caps, berets and military headwear:
//
//   crownTexture   Cohen's d 0.405
//   best threshold 3% precision at 67% recall — 173 bare heads flagged to
//                  catch 6 hats
//
// Colour spread looked better at d = -0.630, and that number is a trap: the
// headwear portraits available were largely historical monochrome, which has
// almost no chroma by construction. It was measuring the age of the photograph,
// not the presence of a hat.
//
// WHAT WOULD ACTUALLY WORK is not a hand-built feature at all. MediaPipe ships
// an ImageSegmenter in the bundle already loaded here, and Google publishes a
// multiclass selfie model whose classes include hair and clothes separately —
// a hood is clothes where hair should be, which is the question asked directly.
// The cost is the download: 16 MB for the multiclass model, against the 3.7 MB
// face model already loaded. The hair-only segmenter is 781 KB but cannot tell
// a bald head from a covered one, and flagging bald users is worse than the
// fringe problem it would replace. The product now takes that trade in
// headCovering.ts: the model is lazy-loaded after capture and its thresholds
// remain explicitly trial-only until they pass the labelled benchmark.
// ---------------------------------------------------------------------------

export interface Occlusion {
  // Horizontal edge energy across the nose bridge, over the same quantity on
  // bare cheek. 1 = the bridge is as smooth as the cheek.
  bridge: number;
  // Worth mentioning. Advisory only.
  glasses: boolean;
  // Strong enough to hold the shutter. See the two thresholds below.
  glassesStrong: boolean;
}

// Face resampled to a fixed width, so edge energy is measured per unit of FACE
// rather than per unit of sensor.
const SAMPLE_W = 240;

// Calibrated against 229 reference faces, where the median is 1.53 and p90 is
// 2.46. At 3.4 it flags 11 — of which nine are plainly wearing glasses and one
// or two I cannot call from the photograph either way. Against a base rate
// somewhere near 8%, that is a real signal and it is NOT a clean one.
//
// Which is why nothing downstream ever blocks on it, and why the wording it
// drives is conditional — "if you're wearing glasses" rather than "you are".
// Phrased that way a false positive costs nothing: the person reads it, it does
// not apply, they carry on. Phrased as an accusation the same error tells
// someone with a bare face to remove something that is not there, and there is
// no way for them to comply.
//
// Recall is partial by design and by nature. Thin and rimless frames land in
// the middle of the pack, so plenty of glasses go unflagged; the capture screen
// asks everyone up front, and this only has to catch the people who did not
// read it.
const BRIDGE_GLASSES = 3.4;

// Two thresholds, the same shape as the blur gate, and for the same reason: one
// number cannot both catch enough and be safe enough to act on.
//
// A full view of the face is required — frames sit directly across the eye and
// brow metrics — so above this the shutter is held rather than a hint shown. At
// 4.3 it fires on 3.1% of the reference set, seven faces, of which six are
// plainly in glasses and one I cannot call from the photograph.
//
// That last one is why the block is always escapable. A wrong hint costs a
// glance; a wrong block costs someone the ability to use the app at all, with
// no way to comply because there is nothing on their face to remove. So the UI
// pairs this with an explicit override. Requiring removal and stranding people
// are different things, and only the first one is wanted.
const BRIDGE_BLOCK = 4.3;

export function detectOcclusion(
  source: HTMLCanvasElement | HTMLVideoElement,
  lm: NormalizedLandmark[],
  width: number,
  height: number,
): Occlusion | null {
  const pt = (i: number): Pt => ({ x: lm[i].x * width, y: lm[i].y * height });

  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const c of FaceLandmarker.FACE_LANDMARKS_FACE_OVAL) {
    const p = pt(c.start);
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  const fw = x1 - x0;
  const fh = y1 - y0;
  if (!(fw > 20 && fh > 20)) return null;

  const sw = SAMPLE_W;
  const sh = Math.max(8, Math.round((fh / fw) * sw));
  const c = document.createElement("canvas");
  c.width = sw;
  c.height = sh;
  const cx = c.getContext("2d", { willReadFrequently: true })!;
  cx.drawImage(source, x0, y0, fw, fh, 0, 0, sw, sh);
  const d = cx.getImageData(0, 0, sw, sh).data;

  const L = new Float32Array(sw * sh);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    L[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  }

  const local = (p: Pt): Pt => ({ x: ((p.x - x0) / fw) * sw, y: ((p.y - y0) / fh) * sh });
  const eyeRi = local(pt(133)); // inner corner, right eye
  const eyeLi = local(pt(362)); // inner corner, left eye
  const nasion = local(pt(168));
  const cheekR = local(pt(50));
  const cheekL = local(pt(280));
  const inter = Math.hypot(eyeLi.x - eyeRi.x, eyeLi.y - eyeRi.y) || 1;

  // Mean |dL/dy| over a rectangle: HORIZONTAL edges, which is what a frame
  // across a face makes. Vertical edges are deliberately not counted — hair
  // strands and the sides of a nose are full of them.
  const hEdge = (ax: number, ay: number, bx: number, by: number): number => {
    const X0 = Math.max(1, Math.round(Math.min(ax, bx)));
    const X1 = Math.min(sw - 1, Math.round(Math.max(ax, bx)));
    const Y0 = Math.max(1, Math.round(Math.min(ay, by)));
    const Y1 = Math.min(sh - 2, Math.round(Math.max(ay, by)));
    let s = 0;
    let n = 0;
    for (let y = Y0; y <= Y1; y++) {
      for (let x = X0; x <= X1; x++) {
        s += Math.abs(L[(y + 1) * sw + x] - L[(y - 1) * sw + x]);
        n++;
      }
    }
    return n ? s / n : 0;
  };

  // Control: mid-cheek. The smoothest large patch on a face, and lit the same
  // as everything else on it.
  const cs = inter * 0.3;
  const control =
    (hEdge(cheekR.x - cs, cheekR.y - cs, cheekR.x + cs, cheekR.y + cs) +
      hEdge(cheekL.x - cs, cheekL.y - cs, cheekL.x + cs, cheekL.y + cs)) / 2;
  // A control patch that came back essentially flat would make the ratio
  // explode; floor it rather than let one smooth cheek flag everyone.
  const denom = Math.max(0.35, control);

  // The gap between the inner eye corners, centred on the nasion. A bare bridge
  // is one of the smoothest parts of a face and a frame crosses it dead centre.
  const bh = inter * 0.22;
  const bridge =
    hEdge(eyeRi.x + inter * 0.12, nasion.y - bh, eyeLi.x - inter * 0.12, nasion.y + bh) / denom;

  return {
    bridge: +bridge.toFixed(3),
    glasses: bridge >= BRIDGE_GLASSES,
    glassesStrong: bridge >= BRIDGE_BLOCK,
  };
}
