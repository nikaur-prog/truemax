/** Display geometry only. Never crop the retained capture or change landmarks. */
export interface PhotoBounds { x0: number; y0: number; x1: number; y1: number }
export interface PhotoFrameGeometry {
  imageWidth: number;
  imageHeight: number;
  boxWidth: number;
  boxHeight: number;
}

export function photoPointBounds(points: readonly { x: number; y: number }[]): PhotoBounds | null {
  const valid = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (valid.length < 2) return null;
  const bounds = {
    x0: Math.min(...valid.map(p => p.x)), y0: Math.min(...valid.map(p => p.y)),
    x1: Math.max(...valid.map(p => p.x)), y1: Math.max(...valid.map(p => p.y)),
  };
  if (bounds.x0 < 0 || bounds.y0 < 0 || bounds.x1 > 1 || bounds.y1 > 1 ||
      bounds.x1 - bounds.x0 < .02 || bounds.y1 - bounds.y0 < .02) return null;
  return bounds;
}

/**
 * Fit the face, not the photograph's shoulders/background, into a phone's
 * result stage. Both canvases use centred object-fit:contain and share this
 * one wrapper transform, so points and pixels remain registered.
 */
export function resultPhotoFrame(bounds: PhotoBounds | null, geometry: PhotoFrameGeometry): {
  scale: number; tx: number; ty: number;
} {
  const identity = { scale: 1, tx: 0, ty: 0 };
  const { imageWidth: iw, imageHeight: ih, boxWidth: bw, boxHeight: bh } = geometry;
  if (!bounds || ![iw, ih, bw, bh].every(n => Number.isFinite(n) && n > 0)) return identity;
  if (bounds.x1 <= bounds.x0 || bounds.y1 <= bounds.y0) return identity;
  if (!photoPointBounds([{ x: bounds.x0, y: bounds.y0 }, { x: bounds.x1, y: bounds.y1 }])) return identity;
  const width = bounds.x1 - bounds.x0;
  const height = bounds.y1 - bounds.y0;
  // Mesh forehead is not a hairline. Leave extra room above it, plus room for
  // chin/neck and measurement labels instead of framing skin edge-to-edge.
  const padded = {
    x0: Math.max(0, bounds.x0 - Math.max(.025, width * .22)),
    x1: Math.min(1, bounds.x1 + Math.max(.025, width * .22)),
    y0: Math.max(0, bounds.y0 - Math.max(.025, height * .30)),
    y1: Math.min(1, bounds.y1 + Math.max(.025, height * .18)),
  };
  const contain = Math.min(bw / iw, bh / ih);
  const drawnWidth = iw * contain;
  const drawnHeight = ih * contain;
  // Bounded magnification: a distant/low-detail face cannot be sharpened by
  // display zoom. No minimum zoom that could cut off an already-large face.
  const scale = Math.min(4, bw / ((padded.x1 - padded.x0) * drawnWidth),
    bh / ((padded.y1 - padded.y0) * drawnHeight));
  const axis = (box: number, drawn: number, low: number, high: number): number => {
    const inset = (box - drawn) / 2;
    const center = inset + drawn * (low + high) / 2;
    let translation = box / 2 - scale * center;
    if (drawn * scale >= box) {
      // Do not reveal empty background past an image edge when the photograph
      // can cover this axis. This still contains the entire padded face.
      translation = Math.max(box - scale * (inset + drawn), Math.min(-scale * inset, translation));
    } else {
      // If fitting the full face cannot cover this axis, balance the small
      // gutters instead of shifting all empty space to one side of a profile.
      translation = (box - drawn * scale) / 2 - scale * inset;
    }
    return translation / box * 100;
  };
  return { scale, tx: axis(bw, drawnWidth, padded.x0, padded.x1), ty: axis(bh, drawnHeight, padded.y0, padded.y1) };
}

export function resultPhotoTransform(frame: ReturnType<typeof resultPhotoFrame>): string {
  return `translate(${frame.tx.toFixed(3)}%, ${frame.ty.toFixed(3)}%) scale(${frame.scale.toFixed(4)})`;
}
