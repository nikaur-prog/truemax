// ---------------------------------------------------------------------------
// Where somebody came from, carried as far as the purchase.
//
// The funnel counter next door (/api/e) counts STAGES and refuses to know who
// anybody is — see _events.ts, which is explicit that a table quietly
// accumulating identities under the word "analytics" would cost more than a
// wrong number ever could. That principle is not being relaxed here. This is a
// different thing in a different place: it rides on the PURCHASE, which is
// already an authenticated, identified record with a person's card attached,
// and it never touches the anonymous counter.
//
// What it is for. Paid acquisition is a single arithmetic question: does a
// click cost less than the person it brings is worth. Nothing in the product
// could answer that, because a purchase knew it was a purchase and nothing
// else. This is the wire between the two.
//
// FIRST touch wins, deliberately. Somebody clicks an ad, closes the tab, comes
// back three days later through a search and buys. Last-touch credits the
// search and the ad looks unprofitable, so you switch it off — and the search
// traffic dries up, because the ad was what put you in their head. The click
// that started it is the one that earned it.
//
// It expires. A click from four months ago did not cause today's purchase, and
// crediting it would flatter a campaign that stopped running. Thirty days is
// wider than TikTok's own attribution windows and narrow enough to be honest.
// ---------------------------------------------------------------------------

const KEY = "truemax.attribution";
const MAX_AGE_DAYS = 30;

// Long enough for any real campaign name, short enough that a crafted URL
// cannot bloat storage or push a Stripe metadata value past its 500-character
// limit. Values are truncated rather than rejected: a long campaign name is
// somebody's naming convention, not an attack, and half a name still groups.
const MAX_VALUE = 190;

export interface Attribution {
  /** utm_source — the platform. "tiktok", "instagram". */
  source?: string;
  /** utm_medium — how it was paid for. "cpc", "organic", "bio". */
  medium?: string;
  /** utm_campaign — the campaign. */
  campaign?: string;
  /**
   * utm_content — THE CREATIVE, and the field the whole exercise is for.
   * Revenue per campaign says whether to keep spending; revenue per creative
   * says which video to make more of, which is the decision that actually
   * moves a paid channel.
   */
  content?: string;
  /** utm_term. */
  term?: string;
  /** TikTok's click identifier, appended to the destination URL by the ad. */
  ttclid?: string;
  /** TikTok's browser cookie parameter, for matching without a click id. */
  ttp?: string;
  /** When this first touch happened, ISO. Used only to expire it. */
  at: string;
}

function clean(value: string | null): string | undefined {
  if (!value) return undefined;
  // Control characters stripped, not escaped: these end up in Stripe metadata
  // and in a dashboard somebody reads, and a newline in a campaign name is
  // never intentional.
  const trimmed = value.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_VALUE);
}

/**
 * Read the current URL and remember where this visit came from.
 *
 * Called once, as early as possible, on every entry point. Does nothing at all
 * for a visit carrying no campaign parameters, which is most of them, so an
 * ordinary direct visit never writes storage.
 */
export function captureAttribution(search = location.search): void {
  try {
    const params = new URLSearchParams(search);
    const found: Attribution = {
      source: clean(params.get("utm_source")),
      medium: clean(params.get("utm_medium")),
      campaign: clean(params.get("utm_campaign")),
      content: clean(params.get("utm_content")),
      term: clean(params.get("utm_term")),
      ttclid: clean(params.get("ttclid")),
      ttp: clean(params.get("ttp")),
      at: new Date().toISOString(),
    };
    // Nothing to record. A visit with no campaign parameters is not a touch,
    // and writing an empty one would overwrite nothing while still claiming a
    // slot for the next real click to have to expire past.
    if (!hasSignal(found)) return;
    // First touch wins, so an existing LIVE record is never overwritten. An
    // expired one is, because at that point it is no longer evidence.
    const existing = readStored();
    if (existing && !expired(existing)) return;
    localStorage.setItem(KEY, JSON.stringify(found));
  } catch {
    // Private mode, storage full, a malformed URL. Attribution is a reporting
    // convenience and must never be able to stop somebody using the product.
  }
}

function hasSignal(a: Attribution): boolean {
  return Boolean(a.source || a.medium || a.campaign || a.content || a.term || a.ttclid || a.ttp);
}

export function expired(a: Attribution, now = Date.now()): boolean {
  const at = Date.parse(a.at);
  if (!Number.isFinite(at)) return true;
  return now - at > MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}

function readStored(): Attribution | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const a = parsed as Attribution;
    return typeof a.at === "string" ? a : null;
  } catch {
    return null;
  }
}

/**
 * The stored touch, if it is still live, for sending with a checkout.
 *
 * Returns null rather than an empty object when there is nothing to say, so
 * the caller sends no attribution field at all rather than an empty one.
 */
export function attributionForCheckout(now = Date.now()): Attribution | null {
  const stored = readStored();
  if (!stored || expired(stored, now)) return null;
  return stored;
}

/** Test seam and the reset path: forget the current touch. */
export function clearAttribution(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
