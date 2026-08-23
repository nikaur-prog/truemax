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

/** Null until the generated image lands and its points are verified by eye. */
export const GUIDE_POINTS: Record<SidePointId, [number, number]> | null = null;

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
  const { x, y, size } = guideCrop(point, image.naturalWidth, image.naturalHeight);
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
