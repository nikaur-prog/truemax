import { getSupabaseAdmin, safeMessage } from "./_shared.js";

// ---------------------------------------------------------------------------
// The funnel counter. Counts, not people.
//
// Receives an event name, increments today's bucket for it, returns 204.
// Deliberately unauthenticated — requiring a session would blind the counter
// to the whole top of the funnel, which is the part that matters most — so
// its abuse surface is managed by construction instead:
//
//   - an allowlist of event names, so junk cannot create rows;
//   - a counter as the only write, so the worst any abuser achieves is a
//     wrong number, never stored content;
//   - nothing about the sender is read, let alone stored. No IP, no user
//     agent, no cookie. The request body is one short string.
//
// A wrong count is survivable. A table that quietly accumulated identities
// under the word "analytics" would not be, on a product whose privacy story
// is the moat.
// ---------------------------------------------------------------------------

const EVENTS = new Set([
  // The main funnel, in order.
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
  // The TikTok page.
  "quick-visit",
  "quick-scan-done",
  "quick-video-downloaded",
  "max-chat-opened",
  // The weekly scan gate: how often it is hit, and how often it converts.
  "scan-gate-shown",
  "scan-gate-buy",
]);

export async function handleEvent(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => null)) as { event?: unknown } | null;
    const event = typeof body?.event === "string" ? body.event : "";
    // Unknown names are dropped with a 204, not a 400: an error response would
    // invite the client to retry, and there is nothing to retry into.
    if (EVENTS.has(event)) {
      const { error } = await getSupabaseAdmin().rpc("bump_funnel_event", { p_event: event });
      if (error) throw new Error(error.message);
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("track", safeMessage(error));
    // Analytics must never surface a failure to the person using the app.
    return new Response(null, { status: 204 });
  }
}
