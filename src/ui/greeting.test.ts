import assert from "node:assert/strict";
import test from "node:test";
import { nextVisit, subline } from "./greeting.js";
import { QUOTES } from "./quotes.js";
import type { GreetingCtx } from "./greeting.js";

const empty: GreetingCtx = {
  name: null,
  streak: { weeks: 0, alive: false, daysLeft: null, scannedThisWeek: false, total: 0 },
};

test("dashboard notes are concise original TrueMax guidance, not celebrity endorsements", () => {
  assert.ok(QUOTES.length >= 8);
  assert.equal(new Set(QUOTES.map(q => q.text)).size, QUOTES.length);
  for (const q of QUOTES) {
    assert.equal(q.who, "TrueMax");
    assert.ok(q.text.length <= 115, q.text);
    assert.doesNotMatch(q.text, /[—]|0\.9 points|nearly everything else|guarantee|scientifically proven/i);
  }
  assert.match(QUOTES.map(q => q.text).join(" "), /haircut/);
  assert.match(QUOTES.map(q => q.text).join(" "), /models/);
  assert.match(QUOTES.map(q => q.text).join(" "), /lighting/);
});

test("empty dashboard rotates through every practical note with attribution", () => {
  const expected = new Set(QUOTES.map(q => `${q.text} · ${q.who}`));
  const seen = new Set<string>();
  for (let i = 0; i < QUOTES.length; i++) {
    nextVisit();
    const line = subline(empty);
    assert.ok(expected.has(line), line);
    seen.add(line);
    assert.equal(subline(empty), line, "a render must not advance the rotation");
  }
  assert.deepEqual(seen, expected);
});

test("useful scan-streak information still takes priority over editorial notes", () => {
  assert.equal(subline({ ...empty, streak: { weeks: 3, alive: true, daysLeft: 1, scannedThisWeek: false, total: 3 } }), "1 day left to keep your 3-week streak.");
  assert.equal(subline({ ...empty, streak: { weeks: 3, alive: true, daysLeft: 4, scannedThisWeek: false, total: 3 } }), "Scan this week to keep your 3-week streak going.");
  assert.equal(subline({ ...empty, streak: { weeks: 3, alive: true, daysLeft: null, scannedThisWeek: true, total: 3 } }), "This week is in. 3 weeks without missing one.");
});
