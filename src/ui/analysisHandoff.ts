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

export function beginAnalysisHandoff(view: AnalysisHandoffView, paint: () => void): void {
  view.upload.classList.add("hidden");
  view.main.classList.remove("hidden");
  paint();

  view.analysis.innerHTML = "";
  view.frame.classList.add("scanning");
  view.capRight.textContent = "PREPARING ANALYSIS";
  view.status.classList.remove("swapping");
  view.status.innerHTML = `<b>Bringing both views together</b><span class="scan-ellipsis" aria-label="working"><i>.</i><i>.</i><i>.</i></span>`;
  view.barFill.parentElement?.classList.remove("spent");
  view.barFill.style.width = "8%";
}
