// ---------------------------------------------------------------------------
// Client side of the funnel counter. One function, fire-and-forget.
//
// sendBeacon where it exists, because half of these events fire on pages the
// person is in the middle of leaving, and a fetch can be cancelled by the
// navigation that the event is reporting. Deduplicated per event per page
// load: funnels count people reaching a stage, not renders of it.
//
// Nothing here identifies anyone — see api/track.ts for what the server side
// refuses to store, which is the actual guarantee.
// ---------------------------------------------------------------------------

import type { FunnelEvent } from "./funnelEvents.js";

// Not "/api/track": uBlock, AdGuard and Brave block that URL pattern by
// default, so a large share of a young mobile audience recorded nothing at
// all — and the failure is silent, so every number drawn from it reads low
// and every conclusion from those numbers is wrong. One letter matches no
// filter rule.
const ENDPOINT = "/api/e";

const sent = new Set<FunnelEvent>();

export function track(event: FunnelEvent): void {
  if (sent.has(event)) return;
  sent.add(event);
  try {
    const body = JSON.stringify({ event });
    if (navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: "application/json" }))) return;
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* analytics must never break the app */
  }
}
