// ---------------------------------------------------------------------------
// Zooming the photograph, as one interpolable transform.
//
// Every zoom in this app used to be `transform-origin: X% Y%` plus `scale(s)`.
// That is the textbook way and it cannot animate between two zooms: CSS tweens
// the transform but applies a changed transform-origin INSTANTLY, so moving
// from the eyes to the jaw scaled smoothly around a point that had already
// teleported — a visible sideways jump at the start of every region change,
// which is most of why the transitions read as cheap.
//
// The fix is algebra, not animation code. Scaling about a point (ox, oy) is
// identical to scaling about the top-left corner and translating by
// (1−s)·(ox, oy). Keep the origin pinned at `0 0` forever and express the pan
// inside the transform itself, and the browser now interpolates translate and
// scale TOGETHER — the view glides from one facial point to the next along a
// straight path, which is the whole "premium" of a camera move.
//
// Percentages throughout, because translate() percentages are relative to the
// element's own box — so the same string is correct at any rendered size and
// nothing here ever needs to measure the DOM.
// ---------------------------------------------------------------------------

export interface ZoomSpec {
  scale: number;
  originX: number; // % of the element's width — the point that stays put
  originY: number; // % of its height
}

/**
 * The transform for "scale by `spec.scale` about (`originX`%, `originY`%)",
 * expressed against a fixed `transform-origin: 0 0`.
 *
 * Every element this is applied to must carry that origin (applyZoom sets it),
 * or the translation compensates for a pivot the browser is not using.
 */
export function zoomTransform(spec: ZoomSpec): string {
  const s = spec.scale;
  const tx = (1 - s) * spec.originX;
  const ty = (1 - s) * spec.originY;
  // Explicit identity rather than "none", so a return to rest interpolates
  // like any other move instead of snapping.
  return `translate(${tx.toFixed(3)}%, ${ty.toFixed(3)}%) scale(${s.toFixed(4)})`;
}

/** Apply a zoom to an element, pinning the origin the transform assumes. */
export function applyZoom(el: HTMLElement, spec: ZoomSpec): void {
  el.style.transformOrigin = "0 0";
  el.style.transform = zoomTransform(spec);
}

export const IDENTITY_ZOOM: ZoomSpec = { scale: 1, originX: 0, originY: 0 };

/**
 * A zoom that frames a normalized bounding box — the box a measurement's own
 * drawing touches, from measurementBounds / sideMeasurementBounds.
 *
 * `fill` is how much of the frame the box should occupy at full zoom; the rest
 * is air for the value chips, which are drawn just past the ends of their
 * lines and would otherwise be cropped by the very zoom meant to feature them.
 * Scale is clamped because a tiny construction (one eye) inverts into a huge
 * scale, and past ~3× the photograph is pixels rather than a face.
 */
export function zoomToBounds(
  b: { x0: number; y0: number; x1: number; y1: number },
  opts: { fill?: number; pad?: number; min?: number; max?: number } = {},
): ZoomSpec {
  const fill = opts.fill ?? 0.58;
  const pad = opts.pad ?? 0.05;
  const min = opts.min ?? 1.25;
  const max = opts.max ?? 2.8;
  const spanX = Math.max(0.01, b.x1 - b.x0 + pad * 2);
  const spanY = Math.max(0.01, b.y1 - b.y0 + pad * 2);
  const scale = Math.min(max, Math.max(min, fill / Math.max(spanX, spanY)));
  return {
    scale,
    // Any origin inside the element keeps a scale > 1 covering the frame, so
    // the centre needs no clamping — proven by the coverage interval
    // [o(1−s), o(1−s)+s] ⊇ [0,1] for every o ∈ [0,1] when s ≥ 1.
    originX: Math.min(100, Math.max(0, ((b.x0 + b.x1) / 2) * 100)),
    originY: Math.min(100, Math.max(0, ((b.y0 + b.y1) / 2) * 100)),
  };
}
