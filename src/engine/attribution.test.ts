import test from "node:test";
import assert from "node:assert/strict";
import {
  captureAttribution,
  attributionForCheckout,
  attributionActionFor,
  claimAttribution,
  clearAttribution,
  expired,
  settleAttributionForAuth,
} from "./attribution.js";

// localStorage does not exist in node. A Map behind the three methods used is
// enough, and it keeps this a real behavioural test of the module rather than a
// source assertion.
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;

const reset = () => {
  store.clear();
};

test("a campaign click is remembered", () => {
  reset();
  captureAttribution("?utm_source=tiktok&utm_medium=cpc&utm_campaign=aug&utm_content=hook-3&ttclid=ABC123");
  const a = attributionForCheckout();
  assert.equal(a?.source, "tiktok");
  assert.equal(a?.medium, "cpc");
  assert.equal(a?.campaign, "aug");
  assert.equal(a?.content, "hook-3");
  assert.equal(a?.ttclid, "ABC123");
});

test("an ordinary visit writes nothing at all", () => {
  reset();
  captureAttribution("");
  captureAttribution("?ref=someone");
  assert.equal(attributionForCheckout(), null);
  assert.equal(store.size, 0, "a visit with no campaign parameters is not a touch");
});

test("FIRST touch wins", () => {
  reset();
  captureAttribution("?utm_source=tiktok&utm_content=hook-3");
  // They leave, come back through a search, and buy. The ad is what put us in
  // their head; last-touch would credit the search and switch the ad off.
  captureAttribution("?utm_source=google&utm_content=brand");
  const a = attributionForCheckout();
  assert.equal(a?.source, "tiktok");
  assert.equal(a?.content, "hook-3");
});

test("a stale touch expires and stops claiming purchases", () => {
  reset();
  captureAttribution("?utm_source=tiktok");
  const fortyDaysOn = Date.now() + 40 * 24 * 60 * 60 * 1000;
  assert.equal(attributionForCheckout(fortyDaysOn), null);
  // ...and once expired it no longer blocks a new first touch.
  const stored = JSON.parse(store.get("truemax.attribution")!) as { at: string };
  assert.ok(expired({ ...stored, at: new Date(Date.now() - 40 * 864e5).toISOString() }));
});

test("a nonsense timestamp is treated as expired, not as forever", () => {
  // Failing open here would let a corrupted record claim every future sale.
  assert.ok(expired({ at: "not a date" }));
  assert.ok(expired({ at: "" }));
});

test("values are capped and control characters stripped", () => {
  reset();
  const long = "x".repeat(500);
  captureAttribution(`?utm_campaign=${long}&utm_content=${encodeURIComponent("a\nb\u0000c")}`);
  const a = attributionForCheckout();
  assert.equal(a?.campaign?.length, 190, "capped well inside Stripe's 500-character metadata limit");
  assert.equal(a?.content, "abc", "newlines and nulls never reach a dashboard somebody reads");
});

test("a corrupted record reads as nothing rather than throwing", () => {
  reset();
  store.set("truemax.attribution", "{not json");
  assert.equal(attributionForCheckout(), null);
  store.set("truemax.attribution", JSON.stringify({ source: "tiktok" }));
  assert.equal(attributionForCheckout(), null, "no timestamp means it cannot be aged, so it is not trusted");
});

test("clearing forgets the touch", () => {
  reset();
  captureAttribution("?utm_source=tiktok");
  clearAttribution();
  assert.equal(attributionForCheckout(), null);
});

// ONE BROWSER, TWO PEOPLE.
//
// Alice arrives through an ad and browses signed out, so her click is stored.
// She signs out or hands the phone over. Bob signs in and buys, and without
// this his payment and his subscription carry Alice's click id — and Bob's own
// click is discarded on arrival, because first-touch sees a live record and
// declines to overwrite it. Shared phones are not an edge case here.
test("signing out forgets the touch", () => {
  reset();
  captureAttribution("?utm_source=tiktok&ttclid=ALICE");
  claimAttribution(null);
  assert.equal(attributionForCheckout(), null);
  // ...and the next person's click is a first touch rather than a queued one.
  captureAttribution("?utm_source=tiktok&ttclid=BOB");
  assert.equal(attributionForCheckout()?.ttclid, "BOB");
});

test("a touch binds to the first account that signs in", () => {
  reset();
  captureAttribution("?utm_source=tiktok&ttclid=ALICE");
  claimAttribution("alice-id");
  // The ordinary path: the click landed signed out, and this IS the person the
  // ad brought. It is kept.
  assert.equal(attributionForCheckout()?.ttclid, "ALICE");
  assert.equal(attributionForCheckout(Date.now(), "alice-id")?.ttclid, "ALICE");
});

test("a different account never inherits it", () => {
  reset();
  captureAttribution("?utm_source=tiktok&ttclid=ALICE");
  claimAttribution("alice-id");
  claimAttribution("bob-id");
  assert.equal(attributionForCheckout(), null, "Bob does not buy on Alice's click");
});

test("the checkout read refuses a mismatch even if the claim was missed", () => {
  // Belt and braces: the sign-in that should have cleared it may not have
  // fired, and the checkout knows exactly who is paying.
  reset();
  captureAttribution("?utm_source=tiktok&ttclid=ALICE");
  claimAttribution("alice-id");
  assert.equal(attributionForCheckout(Date.now(), "bob-id"), null);
});

test("claiming when nothing is stored does nothing at all", () => {
  reset();
  claimAttribution("alice-id");
  claimAttribution(null);
  assert.equal(attributionForCheckout(), null);
  assert.equal(store.size, 0, "an ordinary signed-in visit still writes nothing");
});

// ---------------------------------------------------------------------------
// THE AUTH LIFECYCLE, EXERCISED RATHER THAN ASSERTED ABOUT.
//
// The first version of the identity binding called claimAttribution(null) for
// every event carrying no session. Supabase emits INITIAL_SESSION on every page
// load, with a null session when nobody is signed in, which is the ordinary
// state of a visitor arriving from an advert. So the click captured moments
// earlier was erased on the first event of the first page view, and the whole
// feature was dead for exactly the journey it was built for.
//
// It survived a review, a full test run and a green build because everything
// guarding it was a source-level assertion about the code's SHAPE. Nothing ran
// the sequence. These do.
// ---------------------------------------------------------------------------

/** The real sequence a visitor from an advert produces, in order. */
function visitorFromAnAd(): void {
  reset();
  captureAttribution("?utm_source=tiktok&utm_content=hook-3&ttclid=CLICK");
  settleAttributionForAuth("INITIAL_SESSION", null);
}

test("a signed-out page load does NOT erase a fresh click", () => {
  visitorFromAnAd();
  assert.equal(attributionForCheckout()?.ttclid, "CLICK", "INITIAL_SESSION with no user is not a sign-out");
});

test("the click survives every event a signed-out visitor generates", () => {
  visitorFromAnAd();
  for (const event of ["INITIAL_SESSION", "TOKEN_REFRESHED", "USER_UPDATED", "PASSWORD_RECOVERY"]) {
    settleAttributionForAuth(event, null);
  }
  assert.equal(attributionForCheckout()?.ttclid, "CLICK", "only a real sign-out forgets");
});

test("...and is still there when they sign up and pay", () => {
  visitorFromAnAd();
  settleAttributionForAuth("SIGNED_IN", "new-user");
  const a = attributionForCheckout(Date.now(), "new-user");
  assert.equal(a?.ttclid, "CLICK");
  assert.equal(a?.content, "hook-3", "the creative that earned the sale is what reaches Stripe");
});

test("INITIAL_SESSION WITH a user binds rather than leaving it loose", () => {
  // A returning visitor who is already signed in gets INITIAL_SESSION with a
  // session, and that is a real identity: it must bind, or the touch stays
  // unowned and the next person to sign in inherits it.
  reset();
  captureAttribution("?utm_source=tiktok&ttclid=CLICK");
  settleAttributionForAuth("INITIAL_SESSION", "alice-id");
  assert.equal(attributionForCheckout(Date.now(), "bob-id"), null, "bound to Alice, refused for Bob");
  assert.equal(attributionForCheckout(Date.now(), "alice-id")?.ttclid, "CLICK");
});

test("SIGNED_OUT, and only SIGNED_OUT, forgets", () => {
  visitorFromAnAd();
  settleAttributionForAuth("SIGNED_OUT", null);
  assert.equal(attributionForCheckout(), null);
});

test("the decision itself is exhaustive over the three cases", () => {
  assert.equal(attributionActionFor("SIGNED_IN", "u"), "bind");
  assert.equal(attributionActionFor("INITIAL_SESSION", "u"), "bind");
  // A user id present always wins, even on a sign-out event: there is an
  // identity in hand, and binding to it is never worse than forgetting.
  assert.equal(attributionActionFor("SIGNED_OUT", "u"), "bind");
  assert.equal(attributionActionFor("SIGNED_OUT", null), "forget");
  assert.equal(attributionActionFor("INITIAL_SESSION", null), "leave");
  assert.equal(attributionActionFor("TOKEN_REFRESHED", null), "leave");
});
