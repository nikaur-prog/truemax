// Label geometry, kept in one place because two of the numbers below are
// really CSS: .reel-caption is a DOM element sitting over this canvas at
// bottom 84px, about 58px tall (style.css). The callout placer used to know
// nothing about it and would happily draw a label straight through the score
// and the name — invisible in code review, obvious the moment you look at a
// frame. It is a pure function so that stays pinned by a test.
export const LABEL_W = 74;
export const LABEL_H = 26;
/** Top edge of the .reel-caption block, in canvas pixels. */
export const captionTop = (h: number): number => h - 150;

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
): PlacedCallout[] {
  const lowest = h - reserve - LABEL_H;
  const taken: Array<[number, number, boolean]> = [];
  return outs.map((r) => {
    const ax = r.x * w;
    const ay = r.y * h;
    // The label sits on whichever side has room, so it never covers the face.
    const left = ax > w * 0.5;
    const lx = left ? Math.max(10, ax - LABEL_W - 26) : Math.min(w - LABEL_W - 10, ax + 26);
    const clashAt = (y: number) =>
      taken.find(([ty, by, tl]) => tl === left && y < by + 6 && y + LABEL_H > ty - 6);

    let ly = Math.max(14, Math.min(lowest, ay - 9));
    // Slide down past anything already occupying this column.
    for (let guard = 0; guard < 8 && ly <= lowest; guard++) {
      const clash = clashAt(ly);
      if (!clash) break;
      ly = clash[1] + 12;
    }
    // Sliding down has a floor now that the caption band is reserved, and the
    // old code answered a full column by clamping back to that floor — which
    // put the label straight back on top of whatever it had just slid past.
    // The room is above the stack, so go there.
    if (ly > lowest || clashAt(ly)) {
      const tops = taken.filter(([, , tl]) => tl === left).map(([ty]) => ty);
      ly = Math.max(14, Math.min(...tops, lowest) - LABEL_H - 12);
    }
    ly = Math.max(14, Math.min(lowest, ly));
    taken.push([ly, ly + LABEL_H, left]);
    return { ax, ay, lx, ly, left };
  });
}
