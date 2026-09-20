import type { SidePoints } from "../engine/sideMetrics.js";

/** Interactive pixels are independent of retained scan/export pixels. */
export function interactiveRasterSize(
  width: number,
  height: number,
  displayWidth: number,
  displayHeight: number,
  pixelRatio = 1,
): { width: number; height: number } {
  if (![width, height, displayWidth, displayHeight].every((n) => Number.isFinite(n) && n > 0)) {
    return { width, height };
  }
  // A little oversampling keeps the construction crisp while the camera pans.
  // Cap the DPR, not the retained photo: a 3x phone needn't repaint a 2160px
  // source for a ~350px interactive stage on every frame.
  const density = Math.min(2, Math.max(1, Number.isFinite(pixelRatio) ? pixelRatio : 1)) * 1.25;
  const scale = Math.min(1, Math.min(displayWidth / width, displayHeight / height) * density);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Layout is read once per interaction, never inside the animation loop. */
export function rasterSizeFor(canvas: HTMLCanvasElement, width: number, height: number, displayScale = 1) {
  return interactiveRasterSize(width, height, canvas.clientWidth * displayScale, canvas.clientHeight * displayScale,
    typeof window === "undefined" ? 1 : window.devicePixelRatio);
}

/** A display-only copy. Do not mutate the reviewed points used by scoring. */
export function sidePointsForRaster(points: SidePoints, sourceWidth: number, sourceHeight: number, width: number, height: number): SidePoints {
  if (sourceWidth === width && sourceHeight === height) return points;
  return Object.fromEntries(Object.entries(points).map(([key, point]) => [key, {
    x: point.x * width / sourceWidth,
    y: point.y * height / sourceHeight,
  }])) as SidePoints;
}

/** Reset drawing state (including clips), without resizing on modern canvases. */
export function resetCanvasState(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const context = canvas.getContext("2d");
  if (!context) return null;
  if (typeof context.reset === "function") context.reset();
  else {
    // Old engines cannot clear a saved clipping region with resetTransform.
    // Keep their original, correct reset behavior rather than leak old state.
    canvas.width = canvas.width;
  }
  return context;
}

/** Copy a retained photo without reallocating unchanged backing dimensions. */
export function paintPhotoCanvas(destination: HTMLCanvasElement, source: HTMLCanvasElement): void {
  if (destination.width !== source.width) destination.width = source.width;
  if (destination.height !== source.height) destination.height = source.height;
  const context = resetCanvasState(destination);
  if (!context) return;
  context.clearRect(0, 0, destination.width, destination.height);
  context.drawImage(source, 0, 0);
}
