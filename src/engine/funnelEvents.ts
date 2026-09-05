// One allowlist shared by the browser sender and the server counter. Keeping
// this in one module prevents a typed client event from being silently dropped
// by a second, stale server list.
export const FUNNEL_EVENTS = [
  "visit",
  "scan-front-done",
  "scan-side-done",
  "scan-side-skipped",
  "gate-shown",
  "account-created",
  "results-shown",
  "plan-opened",
  "offer-shown",
  // Reached the end of the pathway questions already holding a live
  // subscription, so the plan cards were replaced by "you are already on X".
  // Counted separately from offer-shown because it is not an offer: a rise
  // here means people are being walked through onboarding they did not need.
  "offer-already-subscribed",
  "checkout-started",
  "single-scan-started",
  "quick-visit",
  "quick-scan-done",
  "quick-video-downloaded",
  "quick-rundown-downloaded",
  "quick-card-downloaded",
  "max-chat-opened",
  "scan-gate-shown",
  "scan-gate-buy",
  // Took the way out that costs nothing: scanned a friend instead of buying a
  // scan or waiting. Worth counting separately, because a gate somebody walks
  // around is a different outcome from a gate they pay through.
  "scan-gate-guest",
  // Pressed "Not now" under the plan cards and got the are-you-sure sheet.
  // Not yet a decline: this is the population the sheet has to talk to.
  "offer-declined-asked",
  // Confirmed it, with the consequences named on screen. The pair of these two
  // is the whole reason the sheet exists — if most people who are asked go on
  // to confirm, the wall is in the right place and the SHEET is doing the
  // wrong job, which is a different fix from moving the wall.
  "offer-declined-confirmed",
  // Backed out of the sheet and stayed in the offer.
  "offer-declined-kept",
  // The one offer after the no: the analysis they already have, unlocked once
  // at the member price. Counted as three separate events because the useful
  // question is which of the two steps loses people. A high shown-to-declined
  // ratio says the offer is wrong; a high checkout-to-nothing gap says the
  // checkout is.
  "downsell-shown",
  "downsell-checkout",
  "downsell-declined",
  // The guest-recovery pair. A guest who signed up at the wall either landed
  // on their analysis or landed somewhere else. The ratio is the recovery
  // bug as a number, before and after the fix, and the morning report
  // prints it.
  "signup-return-analysis",
  "signup-return-lost",
  // Home screen first, the store after. The prompt was offered (Chrome and
  // Android), it was accepted, and the app was opened from a home screen
  // icon (read from display-mode: standalone; see src/engine/standalone.ts).
  // Thirty days of the last one against return visits is the store decision.
  "install-prompt-shown",
  "install-accepted",
  "launch-standalone",
  // The daily streak. Bumped by the server when a day is newly counted and
  // when a run ends, so the streak's effect on return visits can be read
  // without anything about whose streak it was.
  "streak-day-counted",
  "streak-ended",
] as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];
