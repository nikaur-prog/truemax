// Label geometry, kept in one place because two of the numbers below are
// really CSS: .reel-caption is a DOM element sitting over this canvas at
// bottom 84px, about 58px tall (style.css). The callout placer used to know
// nothing about it and would happily draw a label straight through the score
// and the name — invisible in code review, obvious the moment you look at a
// frame. It is a pure function so that stays pinned by a test.
export const LABEL_W = 96;
export const LABEL_H = 34;
/** Top edge of the .reel-caption block, in canvas pixels. */
export const captionTop = (h: number): number => h - 150;

/** The exact drawImage destination rectangle, in canvas CSS pixels. */
export interface ReelPhotoRect {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/** Share the photo's centred cover-fit and push-in with every overlay. */
export function reelPhotoRect(
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  zoom = 1,
): ReelPhotoRect {
  // A hidden or not-yet-decoded element has no drawable geometry. Do not let
  // division by zero propagate NaN through the canvas while it is mounting.
  if (![sourceWidth, sourceHeight, width, height].every((value) => Number.isFinite(value) && value > 0)) {
    return { dx: 0, dy: 0, dw: 0, dh: 0 };
  }
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const push = Number.isFinite(zoom) ? Math.max(1, zoom) : 1;
  const dw = sourceWidth * scale * push;
  const dh = sourceHeight * scale * push;
  return { dx: (width - dw) / 2, dy: (height - dh) / 2, dw, dh };
}

/** Map original-image fractions through the same transform as the photo. */
export function reelPhotoPoint(point: { x: number; y: number }, rect: ReelPhotoRect): { x: number; y: number } {
  return { x: rect.dx + point.x * rect.dw, y: rect.dy + point.y * rect.dh };
}

export interface PlacedCallout {
  /** The measured point on the face. */
  ax: number;
  ay: number;
  /** Top-left of the label box. */
  lx: number;
  ly: number;
  /** True when the label sits to the left of the point. */
  left: boolean;
}

export function placeCallouts(
  outs: Array<{ x: number; y: number }>,
  w: number,
  h: number,
  /**
   * Pixels of the photo's bottom edge the labels must stay clear of.
   *
   * Undocked, that is the caption band the score sits in. Once the reel docks
   * the photograph into the top two thirds, the score has moved OFF the
   * picture onto its own panel, so the picture is entirely available — and
   * reserving the old band there squeezed every label into a sixty-pixel
   * strip at the top, three deep and overlapping the phase label.
   */
  reserve = 150,
  /** Cover-fit, crop and zoom must match the rectangle used to paint the image. */
  photoRect: ReelPhotoRect = { dx: 0, dy: 0, dw: w, dh: h },
): PlacedCallout[] {
  const top = 14;
  const lowest = Math.max(top, h - reserve - LABEL_H);
  const taken: PlacedCallout[] = [];
  return outs.map((r) => {
    const { x: ax, y: ay } = reelPhotoPoint(r, photoRect);
    // Labels may move into free space. The anchor never does: clamping it to
    // the card would silently point at a different facial feature after crop.
    const preferredLeft = ax > w * 0.5;
    const clampY = (value: number) => Math.max(top, Math.min(lowest, value));
    const preferredY = clampY(ay - 9);
    const ys = [preferredY, top, lowest];
    for (const other of taken) ys.push(clampY(other.ly - LABEL_H - 8), clampY(other.ly + LABEL_H + 8));
    let best: PlacedCallout | undefined;
    let bestPenalty = Infinity;
    for (const left of [preferredLeft, !preferredLeft]) {
      const desiredX = left ? ax - LABEL_W - 26 : ax + 26;
      const lx = Math.max(10, Math.min(Math.max(10, w - LABEL_W - 10), desiredX));
      // Keep the connector on the correct edge even if one column is too
      // narrow. On a very small card a finite, contained label takes priority.
      const crossesAnchor = left ? lx + LABEL_W > ax : lx < ax;
      for (const ly of ys) {
        const clashes = taken.filter((other) =>
          lx < other.lx + LABEL_W + 6 && lx + LABEL_W > other.lx - 6
          && ly < other.ly + LABEL_H + 6 && ly + LABEL_H > other.ly - 6).length;
        const penalty = clashes * 10_000 + (crossesAnchor ? 1_000 : 0)
          + Math.abs(ly - preferredY) + (left === preferredLeft ? 0 : LABEL_H);
        if (penalty < bestPenalty) {
          bestPenalty = penalty;
          best = { ax, ay, lx, ly, left };
        }
      }
    }
    const placed = best!;
    taken.push(placed);
    return placed;
  });
}
