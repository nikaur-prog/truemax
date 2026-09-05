import type { Report } from "../engine/types.js";

// ---------------------------------------------------------------------------
// The mobile report has one scroll-state transition: its ordinary app chrome
// becomes a compact header once somebody starts reading, and stays compact
// until they return to the actual top of the report.
//
// The photograph never shrinks. On a phone it remains pinned at a useful size
// for the entire report, and the facial-category rail pins directly beneath
// it. That compact photo-and-controls stack is the report's persistent header.
//
// The old implementation also built, animated and wired a score card here.
// That card is superseded by the complete overall/front/side summary at the
// head of the report. This module remains deliberately small: one passive
// scroll listener, one resize observer and no rendered DOM of its own.
// ---------------------------------------------------------------------------

const COMPACT_AFTER = 2;

let detach: (() => void) | null = null;

export function clearScoreStrip(): void {
  detach?.();
  detach = null;
  const pane = document.querySelector(".pane-photo");
  pane?.classList.remove("region-focus", "results-ready", "report-photo-pinned");
  document.querySelector(".topbar")?.classList.remove("report-compact");
  document.querySelector<HTMLElement>("#v-main")?.style.removeProperty("--report-header-h");
  document.querySelector<HTMLElement>("#v-main")?.style.removeProperty("--report-photo-h");
}

export function renderScoreStrip(_report: Report): void {
  clearScoreStrip();
  const pane = document.querySelector<HTMLElement>(".pane-photo");
  if (!pane) return;
  pane.classList.add("results-ready", "report-photo-pinned");
  detach = watchReportScroll(pane);
}

// Returns its own teardown, so a re-render or new scan cannot leave a listener
// behind compacting an unrelated page.
function watchReportScroll(pane: HTMLElement): () => void {
  let compact = false;
  let queued = false;
  let frame = 0;
  // Results do not always mount at document scroll zero: the upload card and
  // mobile browser chrome can leave the page at a non-zero offset. Measure the
  // person's movement FROM the finished report so "the top" stays stable.
  const startY = window.scrollY;

  // The rail sticks under the app chrome. Measure the real header rather than
  // duplicating a pixel value in TypeScript: signed-in avatars, guest buttons
  // and accessibility font settings can all change its height.
  const header = document.querySelector<HTMLElement>(".topbar");
  const main = pane.closest<HTMLElement>("#v-main") ?? pane.parentElement;
  const publishStickyHeights = (): void => {
    if (!main || !header?.isConnected || !pane.isConnected) return;
    main.style.setProperty("--report-header-h", `${Math.round(header.getBoundingClientRect().height)}px`);
    main.style.setProperty("--report-photo-h", `${Math.round(pane.getBoundingClientRect().height)}px`);
  };
  const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publishStickyHeights);
  if (header) ro?.observe(header);
  ro?.observe(pane);
  publishStickyHeights();

  const measure = (): void => {
    queued = false;
    if (!pane.isConnected) return;
    const y = Math.max(0, window.scrollY - startY);
    const next = y > COMPACT_AFTER;
    if (next !== compact) {
      compact = next;
      header?.classList.toggle("report-compact", compact);
      // ResizeObserver publishes each transition frame in modern browsers.
      // This direct read keeps the rail correctly placed in older ones too.
      publishStickyHeights();
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
    main?.style.removeProperty("--report-header-h");
    main?.style.removeProperty("--report-photo-h");
    header?.classList.remove("report-compact");
    pane.classList.remove("region-focus");
  };
}
