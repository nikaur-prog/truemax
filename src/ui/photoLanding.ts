// ---------------------------------------------------------------------------
// The shutter's follow-through.
//
// Every capture in this product used to be a cut. One frame you were looking
// at a viewfinder; the next frame the scan stage was up with the photograph
// already sitting in it, motionless, and a hard line starting to travel across
// it. Nothing carried the eye over the join, so the single moment the whole
// product is built around — your photograph, taken — read as the screen
// glitching rather than as a camera working.
//
// So the picture arrives slightly too big and settles back into its frame with
// one short bloom of light over it, which is the move a camera makes: the
// image is caught, then it comes to rest. The animation itself lives in
// style.css under .face-frame.settling; this is only the part that has to be
// done in script, which is making it replay.
// ---------------------------------------------------------------------------

/** How long .face-frame.settling runs for. Must match capture-settle in style.css. */
export const SETTLE_MS = 640;

/**
 * Land a freshly captured photograph in its frame.
 *
 * Safe to call on the same element twice — the second front photo of a retake
 * has to play the same landing as the first. A CSS animation does not restart
 * when its class is re-added within the same frame, so the class comes off and
 * the layout is read once to force the reflow that ends the old run. Reading
 * offsetWidth is the standard way to do that and the only reason it is here.
 */
export function landPhoto(frame: HTMLElement | null | undefined): void {
  if (!frame) return;
  frame.classList.remove("settling");
  void frame.offsetWidth;
  frame.classList.add("settling");
  window.setTimeout(() => frame.classList.remove("settling"), SETTLE_MS + 60);
}
