/** Camera geometry only. A digital crop cannot establish lens distance or add detail. */
export interface SourceFrame { width: number; height: number }
export interface FaceBounds { x: number; y: number; w: number; h: number }
export interface PreviewFit { scale: number; x: number; y: number }

export function faceBounds(points: ReadonlyArray<{ x: number; y: number }>): FaceBounds | null {
  if (!points.length) return null;
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const p of points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    x = Math.min(x, p.x); y = Math.min(y, p.y);
    right = Math.max(right, p.x); bottom = Math.max(bottom, p.y);
  }
  return { x, y, w: right - x, h: bottom - y };
}

export function usableSourceFrame(frame: SourceFrame): boolean {
  return Number.isFinite(frame.width) && Number.isFinite(frame.height) && frame.width > 0 && frame.height > 0;
}

/** Same source pixels mean the same detail, regardless of phone/browser shape or preview zoom. */
export function frontFaceDetail(box: FaceBounds, frame: SourceFrame): { enough: boolean; deficit: number } {
  if (!usableSourceFrame(frame) || ![box.x, box.y, box.w, box.h].every(Number.isFinite) || box.w <= 0 || box.h <= 0) return { enough: false, deficit: 1 };
  // Capture usability floors, not an accuracy guarantee. Lower-resolution
  // cameras keep a proportional floor instead of requiring an almost-full frame.
  const short = Math.min(frame.width, frame.height);
  const minWidth = Math.min(240, short * 0.32);
  const minHeight = Math.min(300, short * 0.4);
  const deficit = Math.max(0, 1 - box.w * frame.width / minWidth, 1 - box.h * frame.height / minHeight);
  return { enough: deficit === 0, deficit };
}

export function frontSourceFraming(box: FaceBounds, frame: SourceFrame) {
  const detail = frontFaceDetail(box, frame);
  const margin = 0.015;
  const clipped = box.x < margin || box.y < margin || box.x + box.w > 1 - margin || box.y + box.h > 1 - margin;
  const cxOff = box.x + box.w / 2 - 0.5;
  const cyOff = box.y + box.h / 2 - 0.5;
  return {
    enoughDetail: detail.enough,
    detailDeficit: detail.deficit,
    clipped,
    cxOff,
    cyOff,
    centered: Math.abs(cxOff) <= 0.18 && Math.abs(cyOff) <= 0.2,
    distance: detail.enough && !clipped,
  };
}

/** One aspect-preserving display transform shared by video and debug overlay. */
export function fitFrontPreview(frame: SourceFrame, viewport: SourceFrame, box: FaceBounds | null): PreviewFit {
  if (!usableSourceFrame(frame) || !usableSourceFrame(viewport)) return { scale: 1, x: 0, y: 0 };
  const contain = Math.min(viewport.width / frame.width, viewport.height / frame.height);
  const cover = Math.max(viewport.width / frame.width, viewport.height / frame.height);
  // Before detection show the full source. A cover crop could hide the face
  // the user is trying to bring into view, especially on a tall phone.
  let scale = contain;
  let centerX = frame.width / 2;
  let centerY = frame.height / 2;
  if (box && box.w > 0 && box.h > 0 && frontFaceDetail(box, frame).enough) {
    // Headroom is intentional: the front mesh stops below the actual hairline.
    scale = Math.min(viewport.width * 0.76 / (box.w * frame.width), viewport.height * 0.58 / (box.h * frame.height));
    scale = Math.max(contain, Math.min(cover * 1.6, scale));
    centerX = (box.x + box.w / 2) * frame.width;
    centerY = (box.y + box.h * 0.42) * frame.height;
  }
  const drawnW = frame.width * scale;
  const drawnH = frame.height * scale;
  const offset = (size: number, drawn: number, center: number) => drawn <= size
    ? (size - drawn) / 2
    : Math.max(size - drawn, Math.min(0, size / 2 - center * scale));
  return { scale, x: offset(viewport.width, drawnW, centerX), y: offset(viewport.height, drawnH, centerY) };
}

/** Deadband and time-based easing prevent landmark jitter from pumping the preview. */
export function settleFrontPreview(previous: PreviewFit | null, target: PreviewFit, elapsedMs: number, reducedMotion = false): PreviewFit {
  if (!previous) return target;
  const scaleClose = Math.abs(target.scale - previous.scale) / Math.max(0.001, previous.scale) < 0.035;
  const positionClose = Math.abs(target.x - previous.x) < 8 && Math.abs(target.y - previous.y) < 8;
  if (scaleClose && positionClose) return previous;
  // Reduced-motion users get one stationary fit for this camera attachment.
  // Frame-size/orientation changes reset the caller's attachment fit.
  if (reducedMotion) return previous;
  const blend = 1 - Math.exp(-Math.max(0, Math.min(200, elapsedMs)) / 650);
  return {
    scale: previous.scale + (target.scale - previous.scale) * blend,
    x: previous.x + (target.x - previous.x) * blend,
    y: previous.y + (target.y - previous.y) * blend,
  };
}
