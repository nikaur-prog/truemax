import test from "node:test";
import assert from "node:assert/strict";
import { TIER_1, TIER_RULES, ruleFor, shortfall, statsArePossible, tierFor } from "./audience.js";
import type { AudienceStats } from "./audience.js";

const stats = (o: Partial<AudienceStats> = {}): AudienceStats => ({
  tier1Share: 0.5,
  usaShare: 0.45,
  views28d: 600_000,
  videos28d: 8,
  ...o,
});

test("shipping this changes nobody's money", () => {
  // The load-bearing promise of the whole file. Every multiplier is 1.0 out of
  // the box, so the migration that adds tiers pays every existing creator
  // exactly what it paid them yesterday. Turning geography on is a deliberate
  // act by the owner on a NEW sprint, not a silent repricing of a deal
  // somebody already accepted and has already posted under.
  for (const rule of TIER_RULES) {
    assert.equal(rule.rate, 1, `${rule.id} would reprice an existing creator`);
  }
});

test("an account has to clear every floor of a tier, not just the flattering one", () => {
  // Huge, wrong geography: Basic, not Elite.
  assert.equal(tierFor(stats({ usaShare: 0.05, tier1Share: 0.25 })), "basic");
  // Perfect geography, no traffic: Unrated, not Elite.
  assert.equal(tierFor(stats({ views28d: 900, videos28d: 1 })), "unrated");
  // One viral video carrying it: Basic, because Elite wants a body of work.
  assert.equal(tierFor(stats({ videos28d: 1 })), "basic");
  // Everything met.
  assert.equal(tierFor(stats()), "elite");
});

test("the tiers are a ladder: qualifying for the top means qualifying for the rest", () => {
  const elite = stats();
  for (const rule of TIER_RULES) {
    assert.ok(elite.tier1Share >= rule.minTier1Share, rule.id);
    assert.ok(elite.views28d >= rule.minViews28d, rule.id);
  }
});

test("an account just under a floor does not get the tier", () => {
  // The boundary, on each floor in turn, because "close enough" is how a
  // threshold quietly becomes a suggestion.
  const basic = ruleFor("basic");
  assert.equal(tierFor(stats({ tier1Share: 0.19, usaShare: 0.19, views28d: 50_000, videos28d: 3 })), "unrated");
  assert.equal(tierFor(stats({ tier1Share: basic.minTier1Share, usaShare: 0.1, views28d: 9_999, videos28d: 3 })), "unrated");
  assert.equal(tierFor(stats({ tier1Share: basic.minTier1Share, usaShare: 0.1, views28d: 10_000, videos28d: 3 })), "basic");
});

test("falling short says exactly which floor and by how much", () => {
  // "Rejected" with no reason is what makes a creator programme feel
  // arbitrary, and an arbitrary programme does not get posted in.
  const why = shortfall(ruleFor("elite"), stats({ usaShare: 0.12, views28d: 200_000, videos28d: 2 }));
  assert.equal(why.length, 3);
  assert.ok(why.some((w) => /40% of views from the US, you are at 12%/.test(w)), why.join(" | "));
  assert.ok(why.some((w) => /500,000 views in 28 days, you are at 200,000/.test(w)), why.join(" | "));
  assert.ok(why.some((w) => /5 videos in 28 days, you have 2/.test(w)), why.join(" | "));
});

test("a tier that is met has nothing to say about shortfall", () => {
  assert.deepEqual(shortfall(ruleFor("elite"), stats()), []);
  assert.deepEqual(shortfall(ruleFor("unrated"), stats({ views28d: 0, videos28d: 0, tier1Share: 0, usaShare: 0 })), []);
});

test("the US share can never exceed the Tier 1 share, because it is inside it", () => {
  // The commonest misread of an analytics screen: taking the wrong row. It
  // reaches the reviewer as a plausible-looking claim unless it is caught here.
  assert.equal(statsArePossible({ tier1Share: 0.2, usaShare: 0.6, views28d: 10, videos28d: 1 }), false);
  assert.equal(statsArePossible({ tier1Share: 0.6, usaShare: 0.6, views28d: 10, videos28d: 1 }), true);
});

test("impossible numbers are refused before a human is asked to review them", () => {
  const bad: Array<Partial<AudienceStats>> = [
    { tier1Share: 1.4, usaShare: 0.2, views28d: 10, videos28d: 1 },
    { tier1Share: -0.1, usaShare: 0, views28d: 10, videos28d: 1 },
    { tier1Share: 0.5, usaShare: -0.2, views28d: 10, videos28d: 1 },
    { tier1Share: 0.5, usaShare: 0.2, views28d: -5, videos28d: 1 },
    { tier1Share: 0.5, usaShare: 0.2, views28d: 10.5, videos28d: 1 },
    { tier1Share: 0.5, usaShare: 0.2, views28d: 5000, videos28d: 0 },
    { tier1Share: Number.NaN, usaShare: 0.2, views28d: 10, videos28d: 1 },
    { usaShare: 0.2, views28d: 10, videos28d: 1 },
  ];
  for (const b of bad) assert.equal(statsArePossible(b), false, JSON.stringify(b));
  assert.equal(statsArePossible(stats()), true);
});

test("a brand new account with nothing yet is possible, not an error", () => {
  assert.equal(statsArePossible({ tier1Share: 0, usaShare: 0, views28d: 0, videos28d: 0 }), true);
  assert.equal(tierFor({ tier1Share: 0, usaShare: 0, views28d: 0, videos28d: 0 }), "unrated");
});

test("the Tier 1 list is the countries the product can take money in", () => {
  // Not a judgement about anywhere: it is where a subscription can currently
  // be sold. Pinned so that growing it is a deliberate edit with a reason.
  assert.ok(TIER_1.includes("US"));
  assert.ok(TIER_1.includes("NZ"), "the product's own country");
  assert.equal(new Set(TIER_1).size, TIER_1.length, "duplicate country in the list");
  for (const c of TIER_1) assert.match(c, /^[A-Z]{2}$/, `${c} is not an ISO code`);
});

test("nothing in here reads a face, a scan, or an ethnicity", () => {
  // The rule this file sits closest to and must not be confused with. It reads
  // the country breakdown of an ACCOUNT'S VIEWERS, self-reported from platform
  // analytics. It says nothing about the creator and nothing about any face.
  const src = TIER_RULES.map((r) => `${r.id} ${r.label} ${r.blurb}`).join(" ");
  assert.doesNotMatch(src, /ethnic|race|racial|skin|face|scan/i);
});

test("an unknown tier id resolves to unrated rather than throwing", () => {
  assert.equal(ruleFor("nonsense" as never).id, "unrated");
});
