// ---------------------------------------------------------------------------
// The full-screen viewfinder, shared by both capture screens.
//
// The front camera got this first and the side profile did not, which left the
// scan with two different cameras: the front took over the screen like a
// camera app, and then the profile step — the harder shot, the one you take
// with your head turned away from the display — went back to a small frame in
// a card with its shutter below the fold. The step that needs the most screen
// had the least.
//
// So the mechanics live here rather than in either flow. Both screens mark
// their stage with `cam-stage`, their frame with `cam-frame` and their button
// row with `cam-actions`; the stylesheet dresses those three classes once, and
// `body.cam-takeover` is the switch.
//
// The expansion is a FLIP: measure the stage where it sits, let the class
// land, measure the full-screen rectangle it produced, then play the transform
// from the inverse of the difference. The browser animates on the compositor
// and cannot disagree with the final layout, because the final layout is what
// it was measured against. Reduced-motion skips straight to the end state.
// ---------------------------------------------------------------------------

function flip(stage: HTMLElement | null, applyClass: () => void): void {
  if (!stage || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    applyClass();
    return;
  }
  const first = stage.getBoundingClientRect();
  applyClass();
  // Read back on the next frame: style recalculation has happened by then,
  // where a microtask would land before it.
  requestAnimationFrame(() => {
    const last = stage.getBoundingClientRect();
    if (!first.width || !first.height || !last.width || !last.height) return;
    const sx = first.width / last.width;
    const sy = first.height / last.height;
    const dx = first.left + first.width / 2 - (last.left + last.width / 2);
    const dy = first.top + first.height / 2 - (last.top + last.height / 2);
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) {
      return;
    }
    stage.animate(
      [
        {
          transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`,
        },
        { transform: "none" },
      ],
      { duration: 560, easing: "cubic-bezier(.22, .61, .36, 1)", fill: "none" },
    );
  });
}

/** Lift a capture stage into the full-screen viewfinder. */
export function enterCameraTakeover(stage: HTMLElement | null): void {
  flip(stage, () => document.body.classList.add("cam-takeover"));
}

/** Fold the viewfinder back into the card it came from. */
export function exitCameraTakeover(stage: HTMLElement | null): void {
  flip(stage, () => document.body.classList.remove("cam-takeover"));
}

/**
 * Drop the takeover with no animation.
 *
 * For teardown paths that are not the user closing the camera — a failed
 * acquire, a scan reset, an unrecoverable swap — where animating a fold-back
 * of a stage that is about to be hidden anyway just delays the recovery the
 * person is waiting for.
 */
export function clearCameraTakeover(): void {
  document.body.classList.remove("cam-takeover");
}
