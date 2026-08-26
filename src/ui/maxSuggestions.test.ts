import test from "node:test";
import assert from "node:assert/strict";
import { OPENING_SUGGESTIONS, suggestFollowUps } from "./maxSuggestions.js";
import type { MaxChatContext } from "../engine/maxContext.js";

const CONTEXT = {
  sex: "male",
  tone: "direct",
  overall: 6,
  percentile: 55,
  pillars: [],
  regions: [
    { label: "Jaw", percentile: 12 },
    { label: "Eyes", percentile: 71 },
    { label: "Proportions", percentile: 94 },
  ],
  measurements: [],
  focus: [
    "Nose : intercanthal width, currently 1.31, essentially fixed skeletal geometry, not changeable",
    "Jaw : cheekbone width, currently 0.913, the measured outline responds to soft-tissue change",
  ],
  scans: 2,
} as unknown as MaxChatContext;

test("an offer from Max becomes the first chip", () => {
  const chips = suggestFollowUps(CONTEXT, "…that's the room. Want me to build a plan around leanness?", []);
  assert.equal(chips[0], "Yes, do that.");
});

test("a reply with no offer does not put words in his mouth", () => {
  const chips = suggestFollowUps(CONTEXT, "Your jaw reads low and that is structural.", []);
  assert.ok(!chips.includes("Yes, do that."));
});

test("body fat in the answer earns the obvious follow-up", () => {
  const chips = suggestFollowUps(CONTEXT, "Body fat is your biggest lever.", []);
  assert.ok(chips.includes("How lean would I need to get?"));
});

test("the weakest region and the strongest are both offered", () => {
  const chips = suggestFollowUps(CONTEXT, "Short answer: not much.", []);
  const joined = chips.join(" | ");
  assert.ok(/jaw/i.test(joined), joined);
});

test("a question already asked is never suggested back", () => {
  const asked = ["What would move my score the most?"];
  const chips = suggestFollowUps(CONTEXT, "Short answer.", asked);
  assert.ok(!chips.includes("What would move my score the most?"));
});

test("matching is case- and space-insensitive, because the chip was typed into the box", () => {
  const chips = suggestFollowUps(CONTEXT, "Short.", ["  what would move my score the most?  "]);
  assert.ok(!chips.includes("What would move my score the most?"));
});

test("no scan still produces something to tap", () => {
  const chips = suggestFollowUps(null, "I need a scan before I can be specific.", []);
  assert.ok(chips.length > 0);
  assert.ok(chips.every((c) => c.length < 60));
});

test("never more than three, and never a duplicate", () => {
  const chips = suggestFollowUps(CONTEXT, "Want me to? Body fat. Lighting. Weeks.", []);
  assert.ok(chips.length <= 3);
  assert.equal(new Set(chips).size, chips.length);
});

test("the openers are short enough to sit on one line of a phone", () => {
  for (const s of OPENING_SUGGESTIONS) assert.ok(s.length <= 34, s);
});
