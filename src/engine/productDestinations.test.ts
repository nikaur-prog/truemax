import assert from "node:assert/strict";
import test from "node:test";
import { RECS, buyGuideFor } from "./recommendations.js";
import type { Rec } from "./recommendations.js";
import { productDestinationFor, productExampleFor } from "./productDestinations.js";

function rec(id: string): Rec {
  const found = RECS.find((entry) => entry.id === id);
  assert.ok(found, `Missing recommendation: ${id}`);
  return found;
}

test("curated destinations match the actual named buying-guide examples", () => {
  for (const id of ["spf", "emollient", "niacinamide"]) {
    const recommendation = rec(id);
    const destination = productDestinationFor(recommendation);
    assert.ok(destination, `${id} has no curated destination`);
    assert.ok(buyGuideFor(recommendation)?.example.includes(destination.productName));
    assert.match(destination.label, /^View this example at /);
    assert.equal(destination.verificationScope, "product-identity-and-label");
  }
});

test("every catalogue URL is an exact official HTTPS product page without tracking", () => {
  const hosts = { spf: "www.laroche-posay.com.au", emollient: "www.cerave.com.au", "gentle-cleanse": "www.cetaphil.com.au", niacinamide: "www.theinkeylist.com" };
  for (const [id, host] of Object.entries(hosts)) {
    const destination = productExampleFor(id);
    assert.ok(destination);
    const url = new URL(destination.url);
    assert.equal(url.protocol, "https:");
    assert.equal(url.hostname, host);
    assert.ok(url.pathname.length > 15);
    assert.equal(url.username, "");
    assert.equal(url.password, "");
    assert.equal(url.search, "");
    assert.equal(url.hash, "");
    assert.equal(destination.region, id === "niacinamide" ? "United States" : "Australia");
    assert.equal(destination.checkedAt, "2026-09-10");
    assert.match(destination.disclosure, /Product information, not clinical validation/);
    assert.match(destination.disclosure, /not clinical validation or a promise of scan improvement/);
    assert.doesNotMatch(Object.values(destination).join(" "), /—|\b(?:cheapest|in stock|free shipping|guaranteed|best price)\b|\$\d/i);
  }
});

test("a changed example or category cannot retain a stale product destination", () => {
  const moisturiser = rec("emollient");
  assert.equal(productDestinationFor({ ...moisturiser, buy: { ...moisturiser.buy!, example: "A different product example" } }), null);
  assert.equal(productDestinationFor({ ...moisturiser, group: "habit" }), null);
  assert.equal(productDestinationFor({ ...moisturiser, evidence: "none" }), null);
  assert.equal(productDestinationFor({ ...moisturiser, otc: undefined }), null);
  assert.equal(productDestinationFor({ ...moisturiser, guardian: true }), null);
  assert.equal(productDestinationFor({ ...moisturiser, buy: undefined }), null);
});

test("medicine, unsupported products and non-product recommendations keep no curated buying destination", () => {
  for (const recommendation of RECS.filter((entry) => !["spf", "emollient", "niacinamide"].includes(entry.id))) {
    assert.equal(productDestinationFor(recommendation), null, recommendation.id);
  }
  assert.equal(productDestinationFor({ ...rec("emollient"), id: "unknown-product" }), null);
  assert.equal(productExampleFor("unknown-product"), null);
  assert.equal(productExampleFor("constructor"), null);
  assert.equal(productExampleFor("__proto__"), null);
});

test("the optional cleanser example does not convert the cleansing habit into a buying instruction", () => {
  const cleansing = rec("gentle-cleanse");
  assert.equal(cleansing.group, "habit");
  assert.equal(buyGuideFor(cleansing), null);
  assert.equal(productDestinationFor(cleansing), null);
  assert.equal(productExampleFor(cleansing.id)?.productName, "Cetaphil Gentle Skin Cleanser");
});
