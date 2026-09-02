// The instant between accepting the side landmarks and the measurement film.
//
// Authentication is checked at this boundary. That read is normally quick and
// is still a network read: on a real iPhone it took five seconds once. The side
// flow had already been removed and the main view was still hidden, so the
// whole document collapsed to its header and footer while the request ran.
//
// This function is deliberately synchronous. It restores the owned scan view
// and starts the existing reading treatment before anything is awaited. The
// measurement film then takes over the same frame instead of replacing a blank
// page with a loading screen after the wait has already happened.

export interface AnalysisHandoffView {
  upload: HTMLElement;
  main: HTMLElement;
  frame: HTMLElement;
  analysis: HTMLElement;
  capRight: HTMLElement;
  status: HTMLElement;
  barFill: HTMLElement;
}

export interface AnalysisHandoffRun {
  /** Stop the bridge animation and return the exact progress already shown. */
  finish(): number;
}

const START = 0.08;
const CEILING = 0.28;
const TRAVEL_MS = 5_000;

export function beginAnalysisHandoff(view: AnalysisHandoffView, paint: () => void): AnalysisHandoffRun {
  view.upload.classList.add("hidden");
  view.main.classList.remove("hidden");
  paint();

  view.analysis.innerHTML = "";
  view.frame.classList.add("scanning");
  view.capRight.textContent = "PREPARING ANALYSIS";
  view.status.classList.remove("swapping");
  view.status.innerHTML = `<b>Bringing both views together</b><span class="scan-ellipsis" aria-label="working"><i>.</i><i>.</i><i>.</i></span>`;
  view.barFill.parentElement?.classList.remove("spent");
  view.barFill.style.width = `${START * 100}%`;

  // Authentication and entitlement reads can take several seconds on a real
  // mobile connection. A bar frozen at 8% during that wait reads as a hang, so
  // let it travel slowly through the first quarter. It never approaches the
  // end: the measurement pass still owns the work that follows and resumes
  // from the exact number returned by finish().
  const started = performance.now();
  let progress = START;
  let raf = 0;
  let done = false;
  const tick = (now: number) => {
    if (done) return;
    progress = START + (CEILING - START) * Math.min(1, (now - started) / TRAVEL_MS);
    view.barFill.style.width = `${(progress * 100).toFixed(2)}%`;
    if (progress < CEILING) raf = requestAnimationFrame(tick);
  };
  if (typeof requestAnimationFrame === "function") raf = requestAnimationFrame(tick);

  return {
    finish: () => {
      if (!done) {
        done = true;
        if (raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
      }
      return progress;
    },
  };
}
