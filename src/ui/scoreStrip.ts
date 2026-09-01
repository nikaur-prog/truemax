import type { Report } from "../engine/types.js";

// ---------------------------------------------------------------------------
// The mobile photograph has two behaviours while somebody reads a report:
//
//   - the photograph SHRINKS once you start reading, because a face taking up
//     two thirds of the viewport is worth exactly one look and then becomes an
//     obstacle between the reader and the thing they came for;
//   - it grows back at the top, because that is where somebody has scrolled up
//     to look at the face again, which is the only reason to scroll up.
//
// The old implementation also built, animated and wired a score card here.
// That card is now superseded by the complete overall/front/side summary at the
// head of the report and is hidden in every layout. Keeping its invisible DOM
// meant count-up timers, typing intervals, a share renderer and layout reads
// still ran on every result. This module now owns only the photo lifecycle its
// public API has always bracketed.
// ---------------------------------------------------------------------------

// How far down the page the shrink triggers, and how far back up it releases.
// Two different numbers on purpose: a single threshold makes the photograph
// flicker between sizes when somebody rests a thumb near it, because the
// shrink itself changes the page height and can push the scroll position back
// across the line it just crossed.
const SHRINK_AT = 12;
const GROW_AT = 3;

let detach: (() => void) | null = null;

export function clearScoreStrip(): void {
  detach?.();
  detach = null;
  const pane = document.querySelector(".pane-photo");
  pane?.classList.remove("shrunk", "region-focus", "results-ready");
}

export function renderScoreStrip(_report: Report): void {
  clearScoreStrip();
  const pane = document.querySelector<HTMLElement>(".pane-photo");
  if (!pane) return;
  pane.classList.add("results-ready");
  detach = watchScroll(pane);
}

// The shrink. Returns its own teardown, so a re-render or a new scan cannot
// leave a scroll listener behind pointing at a detached element.
function watchScroll(pane: HTMLElement): () => void {
  let shrunk = false;
  let queued = false;
  let frame = 0;
  // Results do not always mount at document scroll zero: the upload card and
  // mobile browser chrome can leave the page at a non-zero offset. Measure the
  // person's movement FROM the finished report rather than against the page's
  // absolute origin, or the same gesture shrinks at a different time in Safari
  // and Google's in-app browser.
  const startY = window.scrollY;

  // How far down the screen the pinned photo column reaches, published so the
  // tab row can pin directly under it instead of behind it.
  //
  // Measured rather than assumed because the height is not a constant: the
  // column shrinks on scroll, the score strip grows a line when the ranking
  // wraps, and the quality chips move in and out of it at the breakpoint. A
  // hard-coded offset would be right in exactly one of those states.
  const main = pane.closest<HTMLElement>("#v-main") ?? pane.parentElement;
  const publish = (): void => {
    if (!main || !pane.isConnected) return;
    main.style.setProperty("--pin-top", `${Math.round(pane.getBoundingClientRect().height)}px`);
  };
  const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
  ro?.observe(pane);
  publish();

  const measure = (): void => {
    queued = false;
    if (!pane.isConnected) return;
    const y = Math.max(0, window.scrollY - startY);
    if (!shrunk && y > SHRINK_AT) {
      shrunk = true;
      pane.classList.add("shrunk");
    } else if (shrunk && y < GROW_AT) {
      shrunk = false;
      pane.classList.remove("shrunk");
    }
  };
  const onScroll = (): void => {
    if (queued) return;
    queued = true;
    frame = requestAnimationFrame(measure);
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  measure();
  return () => {
    window.removeEventListener("scroll", onScroll);
    if (frame) cancelAnimationFrame(frame);
    ro?.disconnect();
    main?.style.removeProperty("--pin-top");
    pane.classList.remove("shrunk", "region-focus");
  };
}
