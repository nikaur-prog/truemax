/** Report navigation owns its listeners for exactly one mounted report. */
export function mountTabScrollbar(tabs: HTMLElement, track: HTMLElement): () => void {
  let frame = 0;
  let dead = false;
  let previous = "";
  const sync = (): void => {
    frame = 0;
    if (dead) return;
    const { scrollWidth, clientWidth, scrollLeft } = tabs;
    const overflow = scrollWidth - clientWidth;
    if (overflow <= 2) {
      track.hidden = true;
      return;
    }
    track.hidden = false;
    const fraction = clientWidth / scrollWidth;
    // Safari rubber-banding can report negative or over-limit scrollLeft.
    const offset = Math.max(0, Math.min(overflow, scrollLeft));
    const width = `${(fraction * 100).toFixed(2)}%`;
    const position = `${((offset / overflow) * (1 - fraction) * 100).toFixed(2)}%`;
    const next = `${width}:${position}`;
    if (next === previous) return;
    previous = next;
    track.style.setProperty("--thumb-w", width);
    track.style.setProperty("--thumb-x", position);
  };
  const schedule = (): void => {
    if (!dead && !frame) frame = requestAnimationFrame(sync);
  };
  const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
  // Changing from front to side changes scrollWidth without necessarily
  // changing the tab container's border box, so ResizeObserver is not enough.
  const mutation = typeof MutationObserver === "undefined" ? null : new MutationObserver(schedule);
  resize?.observe(tabs);
  mutation?.observe(tabs, { childList: true });
  tabs.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  schedule();
  return () => {
    dead = true;
    if (frame) cancelAnimationFrame(frame);
    resize?.disconnect();
    mutation?.disconnect();
    tabs.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
  };
}

/**
 * Only elevation depends on this state. CSS always pins the photo and rail.
 * Observe the natural-flow marker, not the sticky rail, and update the
 * observer boundary on a header/photo resize. Normal scrolling needs no
 * getComputedStyle or bounding-box reads on the main thread.
 */
export function mountReportRailState(rail: HTMLElement, sentinel: HTMLElement): () => void {
  let frame = 0;
  let dead = false;
  let boundary: number | null = null;
  let observer: IntersectionObserver | null = null;
  let generation = 0;
  const mobile = (): boolean => window.matchMedia?.("(max-width: 850px)").matches ?? window.innerWidth <= 850;
  const syncFallback = (): void => {
    frame = 0;
    if (dead) return;
    const stickyTop = Number.parseFloat(getComputedStyle(rail).top) || 0;
    rail.classList.toggle("is-stuck", mobile() && sentinel.getBoundingClientRect().top <= stickyTop + 1);
  };
  const syncBoundary = (): void => {
    frame = 0;
    if (dead) return;
    if (!mobile()) {
      generation++;
      observer?.disconnect();
      observer = null;
      boundary = null;
      rail.classList.remove("is-stuck");
      return;
    }
    const next = Number.parseFloat(getComputedStyle(rail).top) || 0;
    if (next === boundary && observer) return;
    observer?.disconnect();
    boundary = next;
    const current = ++generation;
    observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (dead || current !== generation || !entry) return;
      rail.classList.toggle("is-stuck", entry.boundingClientRect.top <= next + 1);
    }, { rootMargin: `-${Math.max(0, next)}px 0px 0px 0px`, threshold: 0 });
    observer.observe(sentinel);
  };
  const hasIntersectionObserver = typeof IntersectionObserver !== "undefined";
  const schedule = (): void => {
    if (!dead && !frame) frame = requestAnimationFrame(hasIntersectionObserver ? syncBoundary : syncFallback);
  };
  const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
  for (const element of [rail, document.querySelector(".topbar"), document.querySelector(".pane-photo")]) {
    if (element) resize?.observe(element);
  }
  if (!hasIntersectionObserver) window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  schedule();
  return () => {
    dead = true;
    if (frame) cancelAnimationFrame(frame);
    observer?.disconnect();
    resize?.disconnect();
    window.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    rail.classList.remove("is-stuck");
  };
}

/** A sticky element's visible top never tells us how far its content moved. */
export function scrollReportPanelToStart(rail: HTMLElement, sentinel: HTMLElement): void {
  const stickyTop = Number.parseFloat(getComputedStyle(rail).top) || 0;
  const naturalTop = sentinel.getBoundingClientRect().top;
  // Do not drag somebody down past the score summary when they are above it.
  if (naturalTop >= stickyTop - 1) return;
  window.scrollTo({
    top: Math.max(0, window.scrollY + naturalTop - stickyTop),
    behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
  });
}
