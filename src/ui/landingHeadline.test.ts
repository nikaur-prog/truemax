import test from "node:test";
import assert from "node:assert/strict";
import { pickHeadline } from "./landingHeadline.js";
import type { Headline, HeadlineContext } from "./landingHeadline.js";

function ctx(over: Partial<HeadlineContext> = {}): HeadlineContext {
  return { name: null, scanCount: 0, daysSinceLastScan: null, visit: 0, ...over };
}

function text(h: Headline): string {
  return `${h.lead}${h.em}${h.tail}`;
}

// Every context the picker can be handed, so the properties below can be
// asserted across all of them rather than the two or three that came to mind.
function everyContext(): HeadlineContext[] {
  const out: HeadlineContext[] = [];
  for (const name of [null, "Sam"]) {
    for (const [scanCount, daysSinceLastScan] of [
      [0, null],
      [1, 0],
      [1, 6],
      [1, 7],
      [9, 40],
    ] as const) {
      for (let visit = 0; visit < 8; visit++) {
        out.push({ name, scanCount, daysSinceLastScan, visit });
      }
    }
  }
  return out;
}

test("no headline claims the face has improved", () => {
  // THE test for this module. A greeting is written before anything has been
  // measured, so a greeting that says the user has improved is asserting a
  // result the scan has not produced — the same mistake as printing a
  // percentile the sample cannot support, made on the first line of the page.
  // "What's changed" is a question and is allowed; "your improvements" is a
  // finding and is not.
  // \b on both sides of "gain" — without the leading one it fires on "again",
  // which is the opposite of a claim.
  const claims = /improve|\bbetter\b|\bgains?\b|progress|you'?re up\b|\bhigher\b|increased/i;
  for (const c of everyContext()) {
    const t = text(pickHeadline(c));
    assert.doesNotMatch(t, claims, `headline asserts a result: "${t}"`);
  }
});

test("a signed-out visitor is never greeted by name", () => {
  for (const c of everyContext().filter((c) => c.name === null)) {
    const t = text(pickHeadline(c));
    assert.doesNotMatch(t, /\bnull\b|undefined|,\s*let's|^'s/i, `leaked a name slot: "${t}"`);
  }
});

test("the rotation never repeats twice in a row", () => {
  // Two identical headlines back to back read as a page that failed to reload,
  // which is why this rotates in order instead of picking at random.
  for (const base of [ctx(), ctx({ name: "Sam", scanCount: 3, daysSinceLastScan: 30 })]) {
    for (let v = 0; v < 12; v++) {
      const a = text(pickHeadline({ ...base, visit: v }));
      const b = text(pickHeadline({ ...base, visit: v + 1 }));
      assert.notEqual(a, b, `visit ${v} and ${v + 1} both said "${a}"`);
    }
  }
});

test("the rotation comes back round rather than running out", () => {
  const seen = new Set<string>();
  for (let v = 0; v < 30; v++) seen.add(text(pickHeadline(ctx({ visit: v }))));
  assert.equal(seen.size, 3, "the signed-out set should cycle through exactly its three lines");
});

test("visit 0 opens on the clearest product description", () => {
  // A stranger's first sight of the page says what the product does, not a
  // universal claim about attractiveness.
  assert.equal(text(pickHeadline(ctx())), "Your face score, measurement by measurement.");
});

test("a signed-in name appears in the headline", () => {
  for (const c of everyContext().filter((c) => c.name === "Sam")) {
    assert.match(text(pickHeadline(c)), /Sam/, "signed-in headline dropped the name");
  }
});

test("someone who has never scanned is not asked what has changed", () => {
  for (let v = 0; v < 6; v++) {
    const t = text(pickHeadline(ctx({ name: "Sam", scanCount: 0, visit: v })));
    assert.doesNotMatch(t, /changed|again|another/i, `nothing to compare against yet: "${t}"`);
  }
});

test("a rescan is only suggested once it could resolve a real move", () => {
  // Under a week apart, the instrument cannot separate a change from its own
  // photo-to-photo spread, so inviting a rescan would be inviting noise.
  for (let v = 0; v < 6; v++) {
    const fresh = text(pickHeadline({ name: "Sam", scanCount: 4, daysSinceLastScan: 6, visit: v }));
    assert.doesNotMatch(fresh, /what's changed|another read/i, `too soon to ask: "${fresh}"`);
  }
  const due = new Set<string>();
  for (let v = 0; v < 6; v++) {
    due.add(text(pickHeadline({ name: "Sam", scanCount: 4, daysSinceLastScan: 7, visit: v })));
  }
  assert.ok([...due].every((t) => /what's changed|another read/i.test(t)), "a week on, ask");
});

test("a name with surrounding whitespace is treated as a name, an empty one is not", () => {
  assert.match(text(pickHeadline(ctx({ name: "  Sam  " }))), /Sam/);
  assert.equal(text(pickHeadline(ctx({ name: "   " }))), "Your face score, measurement by measurement.");
});

test("no landing headline makes attractiveness objective or universally measurable", () => {
  for (const c of everyContext()) {
    assert.doesNotMatch(text(pickHeadline(c)), /no longer subjective|attractiveness.*measur|objective/i);
  }
});

test("a corrupted visit counter still picks a headline", () => {
  // The counter comes out of localStorage, which anyone can edit.
  for (const visit of [NaN, Infinity, -Infinity, -3, 1.7, Number.MAX_SAFE_INTEGER]) {
    const h = pickHeadline(ctx({ visit }));
    assert.ok(text(h).length > 0, `visit ${visit} produced nothing`);
  }
});

test("every headline is a complete sentence", () => {
  for (const c of everyContext()) {
    const t = text(pickHeadline(c));
    assert.match(t, /[.!?]$/, `unterminated: "${t}"`);
    assert.match(t, /^[A-Z]/, `uncapitalised: "${t}"`);
  }
});
