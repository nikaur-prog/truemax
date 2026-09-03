// ---------------------------------------------------------------------------
// Was the app opened from a home screen icon?
//
// The manifest declares display: standalone, so a launch from an installed
// icon renders without browser chrome and matches the display-mode media
// query. iOS Safari predates that query and exposes navigator.standalone
// instead. Both are read; neither identifies anyone. The answer feeds one
// funnel count, launch-standalone, which is the number the home-screen
// decision is read from.
// ---------------------------------------------------------------------------

export interface StandaloneProbe {
  matchMedia?: (query: string) => { matches: boolean };
  navigator?: { standalone?: boolean };
}

export function isStandaloneLaunch(probe: StandaloneProbe = typeof window === "undefined" ? {} : (window as unknown as StandaloneProbe)): boolean {
  try {
    if (probe.matchMedia?.("(display-mode: standalone)").matches) return true;
  } catch {
    // An environment without media queries answers no, not with a throw.
  }
  return probe.navigator?.standalone === true;
}
