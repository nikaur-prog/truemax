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
] as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];
