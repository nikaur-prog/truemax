import type { SidePointId } from "../engine/sideMetrics.js";

// ---------------------------------------------------------------------------
// The photographic reference for landmark placement.
//
// The line-drawing guide answers "what is the layout of these thirteen
// points"; it cannot answer the question people actually stall on, which is
// "what does the jaw hinge look like ON A FACE". A photograph can. One clean
// synthetic profile (AI-generated — deliberately nobody's real face) carries
// thirteen annotated positions, and the same image serves two surfaces:
//
//   - the guided walkthrough shows a ZOOMED CROP around the current point,
//     ring at the centre, under the step's description — "it goes here"
//   - the full-screen guide shows the whole photograph with every ring
//
// GUIDE_POINTS is the hand-verified position of each landmark on that image,
// normalised 0..1 against its width and height. Hand-verified is the point:
// these were placed by eye on a rendered overlay, not trusted from the seeder
// the guide exists to correct. While it is null the photographic guide simply
// does not render and the drawing carries the whole job, so shipping the
// wiring before the artwork costs nothing.
//
// The reference faces image-RIGHT, matching the canonical orientation the
// analysis flips photos into. A left-facing subject gets the reference
// mirrored at draw time — geometry is bilateral, so a mirrored reference is
// exactly as true.
// ---------------------------------------------------------------------------

export const GUIDE_PHOTO_URL = "/side-guide/reference.jpg";

/**
 * Every landmark's position on the reference, normalised against its width and
 * height. Placed by eye at native resolution on a marked-up copy, then checked
 * again region by region — two of them moved on that second pass:
 *
 *   - labialeSuperius was 20px high, sitting on the white roll above the lip
 *     rather than on the vermilion. A saturation-boosted crop is what settled
 *     the border; at normal contrast the two read as one bulge.
 *   - subnasale was inside the columella's shadow instead of at the corner
 *     where the nose's underside actually meets the philtrum.
 *
 * Note about this particular face: it has an almost straight forehead-to-nose
 * line, so glabella and nasion sit 34px apart out of 2048 — the nasofrontal
 * "dip" the hint describes is barely a dip here. That is a real profile and not
 * a mistake, but it does mean those two crops would be near-identical at one
 * shared zoom, which is what GUIDE_ZOOM below exists to fix.
 */
export const GUIDE_POINTS: Record<SidePointId, [number, number]> | null = {
  trichion: [0.6537, 0.2227],
  glabella: [0.7303, 0.377],
  nasion: [0.7309, 0.3936],
  pronasale: [0.8041, 0.5166],
  subnasale: [0.7461, 0.5483],
  // Was [0.7506, 0.605], which was not on the upper lip at all — it was in the
  // TROUGH between the two lips, so the walkthrough's crop showed the lip line
  // and called it the upper lip.
  //
  // Found by tracing the silhouette instead of judging it by eye, which is what
  // the earlier passes did and what let this survive two of them. The subject
  // is shot against a flat light background, so the profile edge is the first
  // non-background pixel walking each row in from the right, and the lips are
  // then two local maxima with a trough between:
  //
  //   upper lip peak   y 0.5950   x 0.7530
  //   trough           y 0.6054   x 0.7480   <- the old point
  //   lower lip peak   y 0.6227   x 0.7630
  //
  // labialeInferius already sat within one pixel of its own maximum, which is
  // the check that says the method is right and only this point was wrong.
  labialeSuperius: [0.753, 0.595],
  labialeInferius: [0.7618, 0.6235],
  pogonion: [0.7697, 0.7017],
  menton: [0.7359, 0.751],
  gonion: [0.4212, 0.6973],
  condylion: [0.3829, 0.5117],
  cervicale: [0.6059, 0.7725],
  tragion: [0.353, 0.5024],
};

/**
 * Per-landmark crop width, as a fraction of the image's shorter side.
 *
 * Points that sit close together on the face need DIFFERENT framing, not just
 * a moved ring: at one shared zoom, glabella and nasion produce two crops that
 * look like the same picture with the ring in the same place, and a step that
 * looks identical to the previous step teaches nothing. So the wider member of
 * each close pair pulls back far enough to show what it is relative to (the
 * whole forehead and brow), and the tighter member goes in close on its own
 * feature. Anything not listed uses the default.
 */
const GUIDE_ZOOM: Partial<Record<SidePointId, number>> = {
  glabella: 0.46,
  nasion: 0.2,
  labialeSuperius: 0.2,
  labialeInferius: 0.3,
  tragion: 0.2,
  // Gonion is the one landmark with no feature under it — on soft tissue the
  // jaw corner is a shading change, not an edge. Close in it is a ring on a
  // blank cheek; pulled back it is a ring at a readable distance below the ear
  // and behind the jawline, which is how a person actually finds it.
  gonion: 0.52,
};

export function guidePhotoReady(): boolean {
  return GUIDE_POINTS !== null;
}

export interface CropRect {
  x: number;
  y: number;
  size: number;
}

/**
 * The square patch of the reference to show for one landmark.
 *
 * `zoom` is the fraction of the image's SHORTER side the patch spans — 0.34
 * shows enough surrounding anatomy to orient by (an ear, not a texture), and
 * the clamp keeps the patch inside the image near edges WITHOUT letting it
 * stop being centred silently: the caller draws the ring at the point's true
 * position within the patch, not at the patch centre, so an edge landmark
 * stays honestly marked rather than drifting like the old magnifier did.
 */
export function guideCrop(
  point: [number, number],
  imageW: number,
  imageH: number,
  zoom = 0.34,
): CropRect {
  const size = Math.min(imageW, imageH) * zoom;
  const x = Math.max(0, Math.min(imageW - size, point[0] * imageW - size / 2));
  const y = Math.max(0, Math.min(imageH - size, point[1] * imageH - size / 2));
  return { x, y, size };
}

/**
 * Draw one landmark's reference patch into a canvas: the crop, a ring at the
 * landmark's true position within it, mirrored when the subject faces left.
 */
/**
 * The "show me" animation: the whole profile, the ring on the point, then a
 * smooth zoom into the point's own crop.
 *
 * A static crop tells you what the point's neighbourhood looks like; it cannot
 * tell you where that neighbourhood IS on the head, which is the thing a
 * mis-seeded point needs. The zoom carries the eye from the face to the spot,
 * and it ends on exactly the frame drawGuideCrop draws, so pressing play never
 * leaves the step looking different from a step that was never played.
 *
 * Pure canvas — no video file. A rendered mp4 would need one per landmark,
 * re-rendering whenever a point is re-verified, and would still be a bitmap of
 * this exact draw call.
 *
 * Returns a cancel function. Cancelling immediately paints the final frame, so
 * a step change mid-flight never strands a half-zoomed picture.
 */
export function playGuideZoom(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  id: SidePointId,
  faceDir: number,
  options: { durationMs?: number; holdMs?: number; onDone?: () => void } = {},
): () => void {
  if (!GUIDE_POINTS || !image.naturalWidth) return () => {};
  const point = GUIDE_POINTS[id];
  const iw = image.naturalWidth;
  const ih = image.naturalHeight;
  // Start: the largest square the image can offer, centred so the whole
  // profile reads. End: the landmark's own crop.
  const startSize = Math.min(iw, ih);
  const start: CropRect = {
    x: Math.max(0, Math.min(iw - startSize, iw / 2 - startSize / 2)),
    y: Math.max(0, Math.min(ih - startSize, ih / 2 - startSize / 2)),
    size: startSize,
  };
  const end = guideCrop(point, iw, ih, GUIDE_ZOOM[id]);
  const duration = options.durationMs ?? 1500;
  const hold = options.holdMs ?? 450;
  // Ease-in-out, and the zoom interpolates the crop's LOG size: linear pixel
  // interpolation spends nearly the whole animation zoomed out (halving the
  // window removes half the remaining pixels but doubles the magnification),
  // so the final approach — the part that teaches — flashed past.
  const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

  let raf = 0;
  let cancelled = false;
  const t0 = performance.now();

  const paintAt = (p: number) => {
    const k = Math.exp(Math.log(start.size) + (Math.log(end.size) - Math.log(start.size)) * p);
    // The window tracks the point: its centre moves from the wide frame's
    // centre toward the point as the zoom closes in, clamped inside the image.
    const cx = start.x + start.size / 2 + (point[0] * iw - (start.x + start.size / 2)) * p;
    const cy = start.y + start.size / 2 + (point[1] * ih - (start.y + start.size / 2)) * p;
    const x = Math.max(0, Math.min(iw - k, cx - k / 2));
    const y = Math.max(0, Math.min(ih - k, cy - k / 2));
    drawGuidePatch(canvas, image, { x, y, size: k }, point, faceDir);
  };

  const frame = (now: number) => {
    if (cancelled) return;
    const t = now - t0;
    if (t < hold) {
      paintAt(0);
    } else {
      const p = Math.min(1, (t - hold) / duration);
      paintAt(easeInOut(p));
      if (p >= 1) {
        // Land on the canonical crop, so play-then-look matches never-played.
        drawGuideCrop(canvas, image, id, faceDir);
        options.onDone?.();
        return;
      }
    }
    raf = requestAnimationFrame(frame);
  };
  paintAt(0);
  raf = requestAnimationFrame(frame);

  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
    drawGuideCrop(canvas, image, id, faceDir);
  };
}

/** One arbitrary window of the reference with the ring at the point. */
function drawGuidePatch(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  rect: CropRect,
  point: [number, number],
  faceDir: number,
): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const display = canvas.width / dpr || 148;
  canvas.width = display * dpr;
  canvas.height = display * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (faceDir === -1) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(image, rect.x, rect.y, rect.size, rect.size, 0, 0, canvas.width, canvas.height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const rx = ((point[0] * image.naturalWidth - rect.x) / rect.size) * canvas.width;
  const ringX = faceDir === -1 ? canvas.width - rx : rx;
  const ringY = ((point[1] * image.naturalHeight - rect.y) / rect.size) * canvas.height;
  ctx.strokeStyle = "rgba(143, 243, 224, 0.98)";
  ctx.lineWidth = 2 * dpr;
  ctx.shadowColor = "rgba(6, 20, 17, 0.85)";
  ctx.shadowBlur = 3 * dpr;
  ctx.beginPath();
  ctx.arc(ringX, ringY, 7 * dpr, 0, Math.PI * 2);
  ctx.stroke();
}

export function drawGuideCrop(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  id: SidePointId,
  faceDir: number,
  displaySize = 148,
): boolean {
  if (!GUIDE_POINTS) return false;
  const point = GUIDE_POINTS[id];
  const { x, y, size } = guideCrop(point, image.naturalWidth, image.naturalHeight, GUIDE_ZOOM[id]);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = displaySize * dpr;
  canvas.height = displaySize * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (faceDir === -1) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(image, x, y, size, size, 0, 0, canvas.width, canvas.height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // The ring sits at the landmark's true position in the patch — see guideCrop.
  const rx = ((point[0] * image.naturalWidth - x) / size) * canvas.width;
  const ringX = faceDir === -1 ? canvas.width - rx : rx;
  const ringY = ((point[1] * image.naturalHeight - y) / size) * canvas.height;
  ctx.strokeStyle = "rgba(143, 243, 224, 0.98)";
  ctx.lineWidth = 2 * dpr;
  ctx.shadowColor = "rgba(6, 20, 17, 0.85)";
  ctx.shadowBlur = 3 * dpr;
  ctx.beginPath();
  ctx.arc(ringX, ringY, 7 * dpr, 0, Math.PI * 2);
  ctx.stroke();
  return true;
}

/**
 * The whole profile, fitted, with the ring on the point.
 *
 * What the enlarged reference opens on. The zoomed patch answers "what does
 * this feature look like close up"; this answers "where on a head am I", which
 * is the question somebody has before they have the first one — and it is the
 * still the popout holds until the play button is pressed.
 */
export function drawGuideWhole(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  id: SidePointId,
  faceDir: number,
): boolean {
  if (!GUIDE_POINTS) return false;
  const point = GUIDE_POINTS[id];
  const ctx = canvas.getContext("2d");
  if (!ctx || !image.naturalWidth) return false;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Contain rather than cover: a reference that crops the crown off is not a
  // reference for the hairline.
  const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
  const dw = image.naturalWidth * scale;
  const dh = image.naturalHeight * scale;
  const dx = (canvas.width - dw) / 2;
  const dy = (canvas.height - dh) / 2;
  if (faceDir === -1) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(image, dx, dy, dw, dh);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const rx = dx + point[0] * dw;
  const ringX = faceDir === -1 ? canvas.width - rx : rx;
  const ringY = dy + point[1] * dh;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  ctx.strokeStyle = "rgba(143, 243, 224, 0.98)";
  ctx.lineWidth = 2 * dpr;
  ctx.shadowColor = "rgba(6, 20, 17, 0.85)";
  ctx.shadowBlur = 4 * dpr;
  ctx.beginPath();
  ctx.arc(ringX, ringY, 9 * dpr, 0, Math.PI * 2);
  ctx.stroke();
  return true;
}
