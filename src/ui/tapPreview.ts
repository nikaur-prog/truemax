// ---------------------------------------------------------------------------
// Two taps on a phone, one click on a desktop.
//
// A metric row does two things. Pointing at it DRAWS the measurement on the
// photograph above — the two lines between the eyes, the angle across the jaw
// — and clicking it opens the full breakdown. On a mouse those are separate
// gestures and both are available. On a phone there is no hover, so the first
// press did both at once: the drawing appeared underneath a modal that had
// already covered it.
//
// Which means the single best thing on the results screen — watching a number
// turn into a pair of callipers on your own face — was reachable on a desktop
// and not on a phone, where nearly everybody is.
//
// So a touch press is staged. The first press arms the row: it lights up the
// way a hovered row does and draws its measurement on the photograph, which is
// pinned at the top of the screen and therefore visible. The second press on
// the SAME row opens the breakdown. Pressing a different row moves the drawing
// there and re-arms from the beginning, because that press was somebody
// looking at a different measurement, not somebody confirming this one.
//
// Nothing changes for a mouse: pointerenter still draws, click still opens.
// ---------------------------------------------------------------------------

/** Which row a touch has armed, across every deck on the screen. */
let armed: string | null = null;

/** Forget the armed row. Called whenever the deck is rebuilt or left. */
export function resetTapPreview(): void {
  armed = null;
}

export interface TapPreviewHandlers {
  /** Draw this row's measurement and light the row. */
  preview(id: string): void;
  /** Open the full breakdown. */
  open(id: string): void;
  /** Cancel any pending "stop drawing" timer. */
  disarm?(): void;
  /** A mouse left the row — start the grace period before undrawing. */
  leave?(): void;
}

/**
 * Wire one row for both input kinds.
 *
 * `id` is whatever the caller uses to identify the row; it is compared by
 * value only, so a front deck and a side deck can share this module without
 * colliding as long as their ids differ — which they do, since one is keyed on
 * the metric id and the other on the side metric id.
 */
export function wireTapPreview(row: HTMLElement, id: string, h: TapPreviewHandlers): void {
  row.onpointerenter = (e) => {
    if (e.pointerType === "touch") return;
    h.disarm?.();
    h.preview(id);
  };
  row.onpointerleave = (e) => {
    if (e.pointerType === "touch") return;
    h.leave?.();
  };
  // pointerup rather than click, so the armed flag is set before any click
  // handler further up the tree sees the press.
  row.onclick = (e) => {
    h.disarm?.();
    // A mouse or a pen has already had its hover; there is nothing to stage.
    const touch = (e as PointerEvent).pointerType === "touch"
      // A click synthesised from a tap reports pointerType "" in some
      // browsers, so fall back to asking whether hover exists at all.
      || (!(e as PointerEvent).pointerType && !window.matchMedia("(hover: hover)").matches);
    if (!touch || armed === id) {
      armed = null;
      h.open(id);
      return;
    }
    armed = id;
    row.classList.add("armed");
    for (const other of document.querySelectorAll(".metric.armed")) {
      if (other !== row) other.classList.remove("armed");
    }
    h.preview(id);
  };
}
