import test from "node:test";
import assert from "node:assert/strict";
import { buildCaption } from "./caption.js";
import type { CaptionInput } from "./caption.js";

const base: CaptionInput = {
  platform: "tiktok",
  who: "me",
  description: "",
  overall: 6.2,
  percentile: 71,
};

test("same inputs, same caption, every time", () => {
  const first = buildCaption(base);
  for (let i = 0; i < 5; i++) assert.deepEqual(buildCaption(base), first);
});

test("first person for 'me' and for an empty answer", () => {
  assert.match(buildCaption(base).caption, /^I let the math/);
  assert.match(buildCaption({ ...base, who: "" }).caption, /^I let the math/);
  assert.match(buildCaption({ ...base, who: " ME " }).caption, /^I let the math/);
});

test("a named subject is used as typed, with they/them", () => {
  const r = buildCaption({ ...base, who: "Jordan" });
  assert.match(r.caption, /^Jordan let the math rate their face/);
});

test("standing is claimed only above the median band", () => {
  // percentile 71 → top 29%
  assert.match(buildCaption(base).caption, /top 29%/);
  // Below it, the score is stated plainly — no "top 62%" consolation math,
  // and nothing demeaning either.
  const low = buildCaption({ ...base, percentile: 38, overall: 4.1 }).caption;
  assert.ok(!/top \d+%/.test(low));
  assert.match(low, /4\.1\/10/);
});

test("the description rides along as one line, never invented", () => {
  const r = buildCaption({ ...base, description: "  8 weeks\nof mewing  " });
  assert.match(r.caption, /8 weeks of mewing/);
  assert.ok(!buildCaption(base).caption.includes("undefined"));
});

test("a runaway description is capped, not pasted whole", () => {
  const r = buildCaption({ ...base, description: "x".repeat(400) });
  const line = r.caption.split("\n")[1];
  assert.ok(line.length <= 140);
  assert.ok(line.endsWith("…"));
});

test("platform picks the tag list; both carry the brand tag", () => {
  const tk = buildCaption(base);
  const ig = buildCaption({ ...base, platform: "instagram" });
  assert.ok(tk.hashtags.length <= 5, "TikTok rewards a short list");
  assert.ok(ig.hashtags.length > tk.hashtags.length);
  assert.ok(tk.hashtags.includes("#truemax"));
  assert.ok(ig.hashtags.includes("#truemax"));
});

test("the full block is caption plus tags, paste-ready", () => {
  const r = buildCaption(base);
  assert.equal(r.full, `${r.caption}\n\n${r.hashtags.join(" ")}`);
  assert.match(r.full, /truemax\.app/);
});

test("nothing demeaning can come out of it", () => {
  // The caption is the most public sentence the app writes. Walk the whole
  // score range and check the standing words never go below neutral.
  for (let pct = 1; pct <= 99; pct += 7) {
    const words = buildCaption({ ...base, percentile: pct, overall: pct / 10 }).full.toLowerCase();
    for (const banned of ["subhuman", "incel", "ugly", "hopeless", "bottom"]) {
      assert.ok(!words.includes(banned), `"${banned}" at percentile ${pct}`);
    }
  }
});
