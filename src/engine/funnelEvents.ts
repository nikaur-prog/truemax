// One allowlist shared by the browser sender and the server counter. Keeping
// this in one module prevents a typed client event from being silently dropped
// by a second, stale server list.
export const FUNNEL_EVENTS = [
  "visit",
  "scan-front-done",
  "scan-side-done",
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
] as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];
