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
  labialeSuperius: [0.7506, 0.605],
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
