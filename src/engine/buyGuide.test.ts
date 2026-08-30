import test from "node:test";
import assert from "node:assert/strict";
import { RECS, buyGuideFor, productSearchUrl } from "./recommendations.js";

// Step 14 turned "here is a search box" into "here is the thing, by name".
// That is a bigger promise than a link, so these are the rules it has to keep.

const topicals = RECS.filter((r) => r.group === "topical");

test("every topical we say works names what to buy", () => {
  // The whole point of the step. A recommendation that ends at a search box
  // hands the person back the problem they came with.
  for (const r of topicals) {
    if (r.evidence === "none") continue;
    const g = buyGuideFor(r);
    assert.ok(g, `${r.id} has no buying guide`);
  }
});

test("a thing we say does not work is never given a buying guide", () => {
  // brow-oils is the entry that exists to say castor oil does not grow hair.
  // Telling somebody that and then showing them where to get it would be the
  // worst of both, and the rule lives in the accessor rather than in whether
  // somebody remembered to leave the field out.
  const none = topicals.filter((r) => r.evidence === "none");
  assert.ok(none.length, "no zero-evidence topical left to check the rule against");
  for (const r of none) assert.equal(buyGuideFor(r), null, `${r.id} offered a buying guide`);
});

test("nothing but a product ever gets a buying guide", () => {
  // Food, habits and professionals have nothing to buy, and an "order it" box
  // under "see a dermatologist" would be grotesque.
  for (const r of RECS.filter((x) => x.group !== "topical")) {
    assert.equal(buyGuideFor(r), null, `${r.id} (${r.group}) offered a buying guide`);
  }
});

test("the guide names a category, a strength and a shop, not just a brand", () => {
  for (const r of topicals) {
    const g = buyGuideFor(r);
    if (!g) continue;
    for (const [field, value] of Object.entries(g)) {
      assert.ok(value.trim().length > 8, `${r.id}.${field} is empty or a stub`);
    }
  }
});

test("an example always reads as an example", () => {
  // The file's standing rule is that we name generic actives, not brands. A
  // brand appears here only because "an adapalene gel" is not findable by
  // somebody who has never bought one. So the sentence has to carry the words
  // that make it one option among several, every time.
  const hedges = /\b(sold as|for example|such as|own-brand|own brand|several|most ranges|any |every mainstream|and as )/i;
  for (const r of topicals) {
    const g = buyGuideFor(r);
    if (!g) continue;
    assert.match(g.example, hedges, `${r.id}: "${g.example}" reads as the answer, not an example`);
  }
});

test("no buying guide points at a merchant", () => {
  // No affiliate anywhere in this file, and no "buy it here". `where` names a
  // kind of shop; the only link is a search.
  for (const r of topicals) {
    const g = buyGuideFor(r);
    if (!g) continue;
    const all = Object.values(g).join(" ");
    assert.doesNotMatch(all, /https?:\/\/|www\.|\.com|amazon|ebay|\baff\b/i, `${r.id} links a merchant`);
  }
  for (const r of RECS) {
    const url = productSearchUrl(r);
    if (url) assert.match(url, /^https:\/\/www\.google\.com\/search\?q=/, `${r.id}: ${url}`);
  }
});

test("no buying guide sends anyone after a prescription-only thing", () => {
  // Rule 1 of this file, restated where a new field could break it. The words
  // are allowed in a `caution` (which exists to say "this one is prescription
  // where you live"); they are not allowed in the instruction to go and buy.
  for (const r of topicals) {
    const g = buyGuideFor(r);
    if (!g) continue;
    const buyIt = `${g.category} ${g.strength} ${g.example}`;
    assert.doesNotMatch(
      buyIt,
      /tretinoin|isotretinoin|bimatoprost|latanoprost|hydroquinone|spironolactone|finasteride|dutasteride|antibiotic|steroid/i,
      `${r.id}: "${buyIt}"`,
    );
  }
});

test("no supplement or pill is ever the thing to buy", () => {
  // Rule 2. Food is food, a capsule is a dose.
  for (const r of topicals) {
    const g = buyGuideFor(r);
    if (!g) continue;
    assert.doesNotMatch(
      `${g.category} ${g.strength}`,
      /\b(supplement|capsule|tablet|pill|gummy|gummies)\b/i,
      `${r.id}: ${g.category}`,
    );
  }
});

test("no buying guide states a calorie or weight target", () => {
  // Rule 4, not anywhere, no exceptions.
  for (const r of topicals) {
    const g = buyGuideFor(r);
    if (!g) continue;
    assert.doesNotMatch(Object.values(g).join(" "), /\bkcal\b|calorie|\bkg\b|\blbs?\b/i, r.id);
  }
});

test("no em dash anywhere in a recommendation the user reads", () => {
  // A house copy rule, and one entry had drifted: silicone's `what` carried an
  // em dash. Pinned across every field rather than just the new ones.
  for (const r of RECS) {
    const g = buyGuideFor(r);
    const text = [r.title, r.what, r.detail, r.caution ?? "", ...(g ? Object.values(g) : [])].join(" ");
    assert.doesNotMatch(text, /—/, `${r.id} uses an em dash`);
  }
});

test("the search link is built from the category, not the advice headline", () => {
  // "Daily sunscreen" finds opinion pieces and "A broad-spectrum face
  // sunscreen" finds bottles. The link and the named category have to be the
  // same claim, or the box the person lands in disagrees with the box above it.
  const spf = RECS.find((r) => r.id === "spf")!;
  const url = productSearchUrl(spf)!;
  assert.ok(
    url.includes(encodeURIComponent(buyGuideFor(spf)!.category)),
    `search link "${url}" does not carry the named category`,
  );
});

test("a topical whose legal status varies says where it does not sit on a shelf", () => {
  // Adapalene is genuinely over the counter in the US and much of the EU, so
  // a blanket ban on naming it would be wrong: it is the one retinoid a
  // person can usually just buy. What is wrong is implying that is true
  // everywhere. "At the counter in most other places" read as an assurance,
  // and in the UK, Australia and New Zealand it is prescription-only.
  //
  // The rule this pins is narrow and checkable: if the guide sends somebody
  // to a pharmacy for something whose status differs by country, the `where`
  // line has to name the places it is not simply on sale.
  const adapalene = topicals.find((r) => r.id === "adapalene");
  assert.ok(adapalene, "the adapalene recommendation is still in the engine");
  const guide = buyGuideFor(adapalene!);
  assert.ok(guide, "adapalene still carries a buying guide");
  assert.match(guide!.where, /prescription/i, guide!.where);
  assert.match(guide!.where, /UK|United Kingdom/, guide!.where);
  // And it must not overstate the restriction either. A first attempt at this
  // called adapalene prescription-only in Australia and New Zealand, which is
  // wrong in both: Australia's Poisons Standard puts topical adapalene at or
  // below 0.1% in Schedule 3, pharmacist-only, and New Zealand allows
  // pharmacist supply up to 1 mg/g in packs of 30 g or less. Telling somebody
  // they need a doctor when a pharmacist can hand it over is its own kind of
  // wrong answer: it costs them an appointment they did not need.
  assert.match(guide!.where, /Australia and New Zealand a pharmacist/, guide!.where);
  assert.doesNotMatch(
    guide!.where,
    /Prescription-only in the UK, Australia and New Zealand/,
    guide!.where,
  );
});
