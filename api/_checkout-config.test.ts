import test from "node:test";
import assert from "node:assert/strict";
import { isStripePriceId } from "./create-checkout-session.js";

test("checkout accepts Stripe price ids and rejects product ids", () => {
  assert.equal(isStripePriceId("price_1ABCxyz"), true);
  assert.equal(isStripePriceId("prod_V9puPxFfb8TGOe"), false);
  assert.equal(isStripePriceId("sk_live_secret"), false);
  assert.equal(isStripePriceId(""), false);
});
