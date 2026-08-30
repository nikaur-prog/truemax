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
  /**
   * TikTok's `_ttp` value, if an ad ever appends one to the destination URL.
   *
   * NOT A FALLBACK, whatever it looks like. `_ttp` is normally a first-party
   * cookie written by TikTok's browser Pixel, and this product deliberately
   * runs no Pixel — the conversion goes back server-side from the Stripe
   * webhook precisely so no ad-network script touches a page where somebody's
   * face is on screen. With no Pixel there is usually no `_ttp` to read, so
   * `ttclid` is what actually carries attribution here.
   *
   * Kept because it costs one URL parameter and is occasionally present, and
   * documented as marginal so nobody plans a match-rate around it.
   */
  ttp?: string;
  /** When this first touch happened, ISO. Used only to expire it. */
  at: string;
  /**
   * The account this touch has been claimed by, once one has signed in.
   *
   * Absent while nobody has signed in, which is the normal state for a first
   * touch: the click lands on a signed-out landing page. It is stamped the
   * first time an identity appears and is what makes the record refuse to
   * follow a second person. See claimAttribution.
   */
  owner?: string;
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
export function attributionForCheckout(now = Date.now(), owner?: string | null): Attribution | null {
  const stored = readStored();
  if (!stored || expired(stored, now)) return null;
  // Belt and braces against a missed claim: the checkout knows who is paying,
  // and a record stamped for somebody else never rides on their card.
  if (owner && stored.owner && stored.owner !== owner) return null;
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

/**
 * Bind the stored touch to whoever is signed in, or forget it.
 *
 * ONE BROWSER, TWO PEOPLE. Alice arrives through an ad, browses signed out so
 * the click is stored, and signs out or simply hands the phone over. Bob signs
 * in and buys. Without this, Bob's payment and his subscription carry Alice's
 * ttclid, the campaign is credited with a sale it did not make, and Bob's own
 * click is discarded on arrival because first-touch sees a live record and
 * declines to overwrite it. Shared phones are not an edge case in this
 * product's audience.
 *
 * Three cases, and only the first keeps anything:
 *
 *   unclaimed   nobody had signed in when the click landed, which is the
 *               ordinary path. It is stamped with this owner and kept: this
 *               IS the person the ad brought.
 *   same owner  nothing to do.
 *   different   forgotten outright, so the next campaign click for this person
 *               is a first touch rather than something queued behind a stale
 *               one.
 *
 * Signing OUT forgets it too, by passing null. There is no way to know whether
 * the next person at this browser is the same one, and crediting a stranger's
 * purchase to somebody else's click is the failure worth avoiding.
 */
export function claimAttribution(userId: string | null): void {
  try {
    const stored = readStored();
    if (!stored) return;
    if (!userId) {
      clearAttribution();
      return;
    }
    if (!stored.owner) {
      localStorage.setItem(KEY, JSON.stringify({ ...stored, owner: userId }));
      return;
    }
    if (stored.owner !== userId) clearAttribution();
  } catch {
    /* storage disabled: there is nothing stored to bind */
  }
}

/**
 * What an auth event should do to the stored touch.
 *
 * SIGNED OUT IS NOT THE SAME AS NOT SIGNED IN, and conflating them broke the
 * entire feature. Supabase emits INITIAL_SESSION on every page load with a
 * null session when nobody is signed in, which is the ordinary state of a
 * visitor arriving from an advert. Treating that null the same as a sign-out
 * cleared the click that had been captured moments earlier, on the very first
 * event of the very first page view: every ad visitor lost their attribution
 * before they had scrolled, and the purchase that followed carried none.
 *
 * So only a real SIGNED_OUT forgets. An event with no user and no sign-out is
 * simply somebody who has not signed in, and their touch waits for them.
 *
 * Split out as a pure function on purpose. The bug above lived in a callback
 * wired to a Supabase subscription, which is exactly the shape a source-level
 * assertion cannot check and a behavioural test can: this takes an event name
 * and a user id and returns a decision, so the lifecycle can be exercised
 * directly.
 */
export type AttributionAction = "bind" | "forget" | "leave";

export function attributionActionFor(event: string, userId: string | null): AttributionAction {
  if (userId) return "bind";
  return event === "SIGNED_OUT" ? "forget" : "leave";
}

/** Apply that decision. The one place an auth event touches attribution. */
export function settleAttributionForAuth(event: string, userId: string | null): void {
  const action = attributionActionFor(event, userId);
  if (action === "bind") claimAttribution(userId);
  else if (action === "forget") claimAttribution(null);
}
