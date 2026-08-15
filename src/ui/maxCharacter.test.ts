import test from "node:test";
import assert from "node:assert/strict";
import { maxCharacterMarkup, maxStickerMarkup } from "./maxCharacter.js";
import type { MaxMood } from "./maxCharacter.js";

const MOODS: MaxMood[] = ["happy", "excited", "thinking", "concerned", "sad", "mad"];

test("every mood carries every expression part, and picks one with a class", () => {
  // The whole point of the rig: one drawing, four faces, switched by class.
  // If a mood ever started omitting parts, a surface that changes mood at
  // runtime would tear rather than swap.
  const parts = [
    "mx-brows-happy",
    "mx-brows-thinking",
    "mx-brows-concerned",
    "mx-mouth-open",
    "mx-mouth-flat",
    "mx-mouth-down",
    "mx-mouth-frown",
    "mx-mouth-grit",
    "mx-brows-sad",
    "mx-brows-mad",
    "mx-eye-stars",
  ];
  for (const mood of MOODS) {
    const svg = maxCharacterMarkup({ mood });
    assert.match(svg, new RegExp(`mx-mood-${mood}\\b`), mood);
    for (const part of parts) assert.ok(svg.includes(part), `${mood} is missing ${part}`);
  }
});

test("the default face is the neutral one", () => {
  assert.match(maxCharacterMarkup(), /mx-mood-happy/);
});

test("he has the moving parts the stylesheet animates", () => {
  // These class names are the contract between the drawing and style.css.
  // Renaming one silently freezes part of him, which no test would otherwise
  // catch because a still character still renders.
  const svg = maxCharacterMarkup();
  for (const hook of ["mx-bob", "mx-arm", "mx-lid", "mx-pupils", "mx-antenna", "mx-pulse", "mx-shadow"]) {
    assert.ok(svg.includes(hook), `missing animation hook ${hook}`);
  }
});

test("waving is opt-in", () => {
  assert.ok(!maxCharacterMarkup().includes('class="mx-arm waving"'));
  assert.ok(maxCharacterMarkup({ waving: true }).includes("mx-arm waving"));
});

test("he is self-contained: no network, no script, no external asset", () => {
  // He renders inside a strict-CSP page and inside exported video frames. A
  // sneaked-in <image href> or url() would break both, silently.
  const svg = maxStickerMarkup();
  for (const banned of ["<script", "http://", "https://", "<image", "<foreignObject"]) {
    assert.ok(!svg.includes(banned), `character markup must not contain ${banned}`);
  }
  // url(#id) is how the gradients are referenced and is purely internal; any
  // OTHER url() would be an outbound fetch.
  assert.ok(!/url\((?!#)/.test(svg), "no external url() references");
});

test("the sticker arrives waving, with sparks", () => {
  const svg = maxStickerMarkup();
  assert.ok(svg.includes("mx-arm waving"));
  assert.equal(svg.match(/mx-spark/g)?.length, 4);
});
