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
    "mx-thought",
    "mx-arm-chin",
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

test("the sticker arrives at rest, with sparks", () => {
  const svg = maxStickerMarkup();
  // It used to assert `mx-arm waving`. The sticker mounts wherever it is
  // placed, so that put an arm up every time one appeared — a greeting nobody
  // triggered, which is exactly the tic greet() caps at two everywhere else.
  // He arrives still and earns attention with the idle repertoire instead.
  assert.ok(!svg.includes("waving"), "the sticker must not arrive mid-wave");
  assert.ok(svg.includes("mx-arm"));
  assert.equal(svg.match(/mx-spark/g)?.length, 4);
});

// ---------------------------------------------------------------------------
// The run-through fixes. Each of these was a real defect in the shipped
// drawing, and each is pinned from the source and the stylesheet because a
// still character still renders: nothing else would catch a regression.
// ---------------------------------------------------------------------------
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { maxLoaderMarkup } from "./maxCharacter.js";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const css = readFileSync(here("../style.css"), "utf8");
const source = readFileSync(here("./maxCharacter.ts"), "utf8");
const idleSource = readFileSync(here("./maxIdle.ts"), "utf8");

test("a poke wears off: the class comes off when the hop ends and cannot outrank an act", () => {
  // One tap used to leave `.poked` on the SVG for the session, and at
  // .mx-svg.poked its rule outranked the breathing and every act's body.
  assert.match(source, /animationName === "mx-hop"/);
  assert.match(source, /setTimeout\(unpoke, POKE_MS\)/);
  assert.ok(css.includes(".poked .mx-bob {"), "the poke rule is two classes deep");
  assert.ok(!css.includes(".mx-svg.poked .mx-bob"), "the poke rule must not carry the root class");
});

test("the gaze is a wrapper the keyframes compose with, never an inline override", () => {
  const svg = maxCharacterMarkup();
  assert.match(svg, /<g class="mx-gaze"><g class="mx-pupils">/);
  assert.ok(!source.includes("pupils.style.animation"), "an inline animation: none killed the glance for good");
  assert.match(css, /\.mx-gaze \{ transform: translate\(var\(--mx-gaze-x/);
});

test("the fight, the fall and the floating pet are gone from code and stylesheet", () => {
  assert.ok(!existsSync(here("./maxPet.ts")), "maxPet.ts should be deleted");
  for (const dead of ["wireFight", "mx-fight", "mx-arms-block", "fight?: boolean"]) {
    assert.ok(!source.includes(dead), `${dead} is still in maxCharacter.ts`);
  }
  for (const dead of ["mx-fight", ".maxpet", "mx-down", "mx-shock", "mx-rise", "mx-flyup", "mx-jab", "mx-stance", "mx-wave-idle", "mx-arms-block"]) {
    assert.ok(!css.includes(dead), `${dead} is still styled`);
  }
});

test("reduced motion cannot strobe a loop, and the Max block wins over the mood rules", () => {
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \* \{[^}]*animation-iteration-count: 1 !important/);
  assert.match(css, /\.mx-svg \.mx-bob, \.mx-svg \.mx-shadow \{ transform: none !important/);
});

test("a sleeping Max sleeps all the way down, and every drawing is put to sleep", () => {
  assert.match(css, /\.mx-asleep \.mx-svg \* \{ animation-play-state: paused !important; \}/);
  assert.match(source, /export function installMaxSleep/);
  assert.match(source, /new MutationObserver/);
  // The teardown rides on the same observer: a drawing leaving the document
  // destroys its idle handle at once.
  assert.match(source, /idle\.destroy\(\)/);
});

test("the loader is one drawing, not four", () => {
  const loader = maxLoaderMarkup("Loading");
  assert.equal((loader.match(/<svg /g) ?? []).length, 1);
  assert.match(css, /\.mx-load \.mx-eye-stars \{ display: block; animation: mx-load-stars/);
});

test("the idle repertoire needs 88 pixels and a hover lets the current act finish", () => {
  assert.match(source, /const IDLE_MIN_PX = 88/);
  assert.match(idleSource, /const onEnter = \(\): void => \{\n[^}]*hovered = true;\n  \};/);
  assert.ok(!/const onEnter[\s\S]{0,200}stopAct\(\)/.test(idleSource), "pointerenter must not cut the act dead");
});
