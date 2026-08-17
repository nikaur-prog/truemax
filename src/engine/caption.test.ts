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

// ---------------------------------------------------------------------------
// One caption engine, four cuts.
//
// The three exports make three different claims, and a caption that ignores
// which one it is under undersells two of them. Adding the cut must not change
// what the callers that do not pass one produce.
// ---------------------------------------------------------------------------
const BASE = { platform: "tiktok" as const, who: "me", description: "", overall: 7.6, percentile: 92 };

test("an omitted cut produces exactly what it always did", () => {
  // Every existing caller passes no kind. If this drifts, captions already
  // copied and posted stop matching the ones the app now generates.
  assert.equal(buildCaption(BASE).full, buildCaption({ ...BASE, kind: "reel" }).full);
  assert.match(buildCaption(BASE).caption, /^I let the math rate my face\./);
});

test("a before/after leads with the change, not the number", () => {
  // A before/after captioned with only the new score throws away the reason
  // the video exists.
  const up = buildCaption({ ...BASE, kind: "beforeAfter", from: 6.1 });
  assert.match(up.caption, /6\.1 → 7\.6/);
  assert.match(up.caption, /What should I fix next\?/);

  // And a drop is stated, not hidden. A generator that only knows how to
  // report improvement is a generator nobody should believe about improvement.
  const down = buildCaption({ ...BASE, kind: "beforeAfter", overall: 5.4, percentile: 40, from: 6.1 });
  assert.match(down.caption, /6\.1 → 5\.4/);
  assert.match(down.caption, /went down/);
});

test("the verdict WORD never reaches a caption, on any cut", () => {
  // The tone rule at the top of this module: a caption is the most public
  // sentence the app writes, it outlives the video, and it gets read by people
  // who never watched it. The ladder holds "Chopped" and "You're cooked" — the
  // video may say them over a face, a caption under somebody's own photograph
  // may not.
  for (const kind of ["reel", "rundown", "breakdown", "verdict", "beforeAfter"] as const) {
    for (const percentile of [3, 12, 30, 50, 70, 92, 99]) {
      const text = buildCaption({ ...BASE, kind, percentile, overall: 4.1, from: 3.8 }).full;
      assert.doesNotMatch(text, /chopped|cooked|mogger|subhuman/i, `${kind} at p${percentile}: ${text}`);
    }
  }
});

test("a below-median score is stated plainly and never dressed up", () => {
  // Carried over from the original rules and now checked on every cut, since
  // each one assembles its own opening line.
  for (const kind of ["reel", "rundown", "breakdown", "verdict", "beforeAfter"] as const) {
    const text = buildCaption({ ...BASE, kind, overall: 3.9, percentile: 18 }).caption;
    assert.doesNotMatch(text, /top \d/i, `${kind} claimed standing it does not have: ${text}`);
    assert.match(text, /3\.9\/10/, `${kind} dropped the score: ${text}`);
  }
});

test("the ceiling appears only when it is above the score", () => {
  assert.match(buildCaption({ ...BASE, kind: "rundown", potential: 8.4 }).caption, /Ceiling: 8\.4/);
  // A ceiling equal to the score is not a target, it is a full stop, and
  // printing it reads as the product admitting it has nothing to sell.
  assert.doesNotMatch(buildCaption({ ...BASE, kind: "rundown", potential: 7.6 }).caption, /Ceiling/);
});

test("every cut still carries the address and the hashtags", () => {
  for (const kind of ["reel", "rundown", "breakdown", "verdict", "beforeAfter"] as const) {
    const out = buildCaption({ ...BASE, kind });
    assert.match(out.full, /truemax\.app/, kind);
    assert.ok(out.hashtags.length > 0, kind);
    assert.ok(out.full.endsWith(out.hashtags.join(" ")), kind);
  }
});
