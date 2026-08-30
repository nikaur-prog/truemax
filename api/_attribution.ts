import { safeMessage } from "./_shared.js";

// ---------------------------------------------------------------------------
// The source of a purchase, sanitised on the way in and reported on the way
// out.
//
// TWO RULES SHAPE ALL OF THIS.
//
// 1. The client is not trusted. Attribution arrives in a request body that
//    anybody can craft, and it ends up in Stripe metadata that a human reads
//    in a dashboard. So it is allowlisted by key, capped by length, and
//    stripped of control characters here rather than being believed because
//    the browser sent it. The worst a crafted body can achieve is a wrong row
//    in a revenue report.
//
// 2. NO PERSON IS DESCRIBED TO AN AD NETWORK. The conversion below carries a
//    click identifier, an amount and a currency. It does not carry an email,
//    hashed or otherwise, nor a phone number, an IP address or a user agent.
//
//    That is a deliberate cost. Hashed-email matching is the industry default
//    and it measurably lifts match rates, which means this reports fewer
//    conversions than it could and TikTok's optimiser learns more slowly than
//    it might. It is not built, and not built as an off-by-default flag
//    either, because a switch is an invitation. TrueMax tells people their
//    photographs never leave the device and lists every processor that touches
//    their data on one page; quietly adding an advertising network to that list
//    to improve a match rate would trade the thing the product is trusted for
//    against a number on a dashboard. If it is ever wanted it should arrive as
//    a deliberate decision with a privacy-page change beside it, not as a
//    boolean somebody flips.
// ---------------------------------------------------------------------------

// Mirrors src/engine/attribution.ts. Kept as a literal rather than imported so
// the API surface cannot silently widen when the client type gains a field.
const FIELDS = {
  source: "attr_src",
  medium: "attr_med",
  campaign: "attr_cmp",
  content: "attr_cnt",
  term: "attr_trm",
  ttclid: "attr_ttclid",
  ttp: "attr_ttp",
  at: "attr_at",
} as const;

const MAX_VALUE = 190;

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  return trimmed ? trimmed.slice(0, MAX_VALUE) : null;
}

/**
 * Flatten a client-supplied attribution into Stripe metadata keys.
 *
 * Individual keys rather than one JSON blob, because the point of this is to
 * filter and group in the Stripe dashboard: "show me every payment where
 * attr_cnt is hook-3" is the question being asked, and it cannot be asked of a
 * string containing JSON.
 *
 * Returns an empty object for anything unrecognisable, so the caller can spread
 * it unconditionally.
 */
export function attributionMetadata(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const input = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [field, key] of Object.entries(FIELDS)) {
    const value = clean(input[field]);
    if (value) out[key] = value;
  }
  return out;
}

/** The click id back out of Stripe metadata, for the conversion report. */
export function clickIdFrom(metadata: Record<string, string> | null | undefined): {
  ttclid?: string;
  ttp?: string;
} {
  return {
    ttclid: metadata?.[FIELDS.ttclid] || undefined,
    ttp: metadata?.[FIELDS.ttp] || undefined,
  };
}

const ENDPOINT = "https://business-api.tiktok.com/open_api/v1.3/event/track/";

/**
 * How long the conversion report may hold the webhook open. IN TOTAL.
 *
 * A budget shared across both attempts rather than a timeout applied to each,
 * and the difference is not pedantry: settle() awaits this before the response
 * is constructed, so Stripe has NOT been answered while it runs. Three seconds
 * per attempt with one retry is a six second bound on a webhook, described in
 * the code as three.
 *
 * Sharing the deadline keeps the retry worth having, because the failure it
 * exists for is a fast one: a 500 or a rejected code comes back in
 * milliseconds and leaves nearly the whole budget for a second try. Only a
 * timeout consumes the budget, and a timeout is the case where retrying
 * immediately was least likely to help anyway.
 */
const TOTAL_BUDGET_MS = 3000;

/** Below this there is not enough left for a second attempt to be worth making. */
const MIN_RETRY_MS = 300;

/**
 * Tell TikTok a purchase happened, server side.
 *
 * From the WEBHOOK, not the browser, and that is the whole reason this exists
 * rather than a pixel. A browser pixel on the success page is blocked by a
 * meaningful share of a young mobile audience, fires before money has actually
 * settled, and can be fired again by anyone who reloads the page. The webhook
 * is the one place that knows a payment completed, knows the amount, and
 * cannot be replayed by a person.
 *
 * Silent and optional. Unconfigured, it does nothing and says nothing, so this
 * ships now and starts working the day the credentials exist. A failure is
 * logged and swallowed: a reporting call must never be able to fail a
 * fulfilment that has already taken somebody's money.
 */
export async function reportPurchase(opts: {
  eventId: string;
  ttclid?: string;
  ttp?: string;
  valueMinor: number;
  currency: string;
  occurredAt?: number;
}): Promise<"sent" | "skipped" | "failed"> {
  const pixel = process.env.TIKTOK_PIXEL_ID;
  const token = process.env.TIKTOK_EVENTS_TOKEN;
  if (!pixel || !token) return "skipped";
  // Without a click identifier there is nothing to match the conversion to, so
  // the call would cost a round trip to report an unattributable sale.
  if (!opts.ttclid && !opts.ttp) return "skipped";

  // ONE RETRY, AND IT IS FREE TO TAKE.
  //
  // settle() waits for this result before answering Stripe, but returns 200
  // even when reporting fails. A three second timeout or a momentary 500
  // therefore loses that sale from the report for good. A single immediate
  // retry recovers the common case, which is a blip rather than an outage.
  //
  // Safe to repeat because the payload carries the Stripe event id as
  // `event_id`, which is what TikTok deduplicates on: if the first attempt
  // actually landed and only the response was lost, the second is discarded at
  // their end rather than double-counting the sale.
  //
  // This is NOT a durable outbox and does not pretend to be. A real outage
  // still loses the conversion, and closing that properly needs a table, a
  // retry worker and a migration. Left as a decision rather than built
  // silently.
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const first = await attemptReport(pixel, token, opts, deadline);
  if (first !== "failed") return first;
  if (deadline - Date.now() < MIN_RETRY_MS) return "failed";
  return attemptReport(pixel, token, opts, deadline);
}

async function attemptReport(
  pixel: string,
  token: string,
  opts: {
    eventId: string;
    ttclid?: string;
    ttp?: string;
    valueMinor: number;
    currency: string;
    occurredAt?: number;
  },
  deadline: number,
): Promise<"sent" | "skipped" | "failed"> {

  // BOUNDED, because an unbounded call to somebody else's server inside a
  // payment webhook is a way to strand a paying customer. fetch has no default
  // timeout: a host that accepts the connection and never answers holds this
  // open until the platform kills the whole function. Reporting runs after
  // fulfilment now, so a timeout costs one unreported conversion and nothing
  // else, which is the correct thing for it to cost.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), Math.max(0, deadline - Date.now()));

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      signal: abort.signal,
      headers: { "Content-Type": "application/json", "Access-Token": token },
      body: JSON.stringify({
        event_source: "web",
        event_source_id: pixel,
        data: [
          {
            // TikTok's CURRENT standard event name. It was CompletePayment,
            // and the old name is still accepted and mapped on their side, so
            // this is not a conversion-loss fix. It is that a configuration
            // being set up now should be set up against the standard as it
            // stands, or the next person reading either end has to know the
            // history to see that the two agree.
            event: "Purchase",
            // Seconds, and the payment's own time rather than now: a webhook
            // retried an hour later must not report an hour-late conversion.
            event_time: Math.floor((opts.occurredAt ?? Date.now()) / 1000),
            // The Stripe event id, so TikTok's own deduplication drops a
            // replayed webhook instead of double-counting the sale.
            event_id: opts.eventId,
            user: {
              ...(opts.ttclid ? { ttclid: opts.ttclid } : {}),
              ...(opts.ttp ? { ttp: opts.ttp } : {}),
            },
            properties: {
              // Stripe counts in minor units; TikTok wants the major one.
              value: opts.valueMinor / 100,
              currency: opts.currency.toUpperCase(),
            },
          },
        ],
      }),
    });
    if (!response.ok) {
      console.error("tiktok-events", `HTTP ${response.status}`);
      return "failed";
    }

    // HTTP 200 IS NOT SUCCESS HERE.
    //
    // The Events API answers 200 and puts the outcome in the body: a non-zero
    // `code` is a rejected request, and `partial_failure` with a populated
    // `failed_events` means some of the batch was dropped while the envelope
    // succeeded. Checking only the status code recorded every one of those as
    // "sent", which is worse than not reporting at all — a silent zero looks
    // like an ad that is not converting, and the response said so plainly the
    // whole time.
    const payload = (await response.json().catch(() => null)) as {
      code?: number;
      message?: string;
      data?: { partial_failure?: unknown; failed_events?: unknown[] } | null;
    } | null;
    // `=== 0`, never "not a non-zero number". A 200 carrying `{}` has no code
    // at all, and the earlier check let it through as a success: the one shape
    // most likely to arrive from a proxy, a gateway error page, or an API
    // version that moved the field was the one shape reported as sent. Success
    // has to be stated by the response, not inferred from the absence of a
    // failure.
    if (!payload || payload.code !== 0) {
      // The message describes OUR request, not the customer, so it is worth
      // logging: "invalid pixel code" and "event_time too old" are the two
      // failures somebody would otherwise spend a week not seeing.
      console.error("tiktok-events", `code ${payload?.code ?? "none"}`, payload?.message ?? "");
      return "failed";
    }
    const failed = payload.data?.failed_events;
    if (payload.data?.partial_failure || (Array.isArray(failed) && failed.length > 0)) {
      console.error("tiktok-events", "partial failure", Array.isArray(failed) ? failed.length : "?");
      return "failed";
    }
    return "sent";
  } catch (error) {
    console.error("tiktok-events", safeMessage(error));
    return "failed";
  } finally {
    clearTimeout(timer);
  }
}
