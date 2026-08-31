import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_REDO_CHARS,
  afterBodyPrompt,
  afterPortraitPrompt,
  beforeBodyPrompt,
  beforeFromAfterPrompt,
  redoPrompt,
  usableScore,
} from "./aiPairPrompt.js";
import { flawsFromIds } from "./faceFlawCatalog.js";
import type { PairSpec } from "./aiPairPrompt.js";

// These build the prompts and read them, rather than reading the file that
// builds them. The previous version of this coverage matched regexes against
// api/ai-image.ts as text, which meant every assertion described the shape of
// the source and none of them executed it: a rewrite that inverted the call
// order would have kept them all green.

const spec = (over: Partial<PairSpec> = {}): PairSpec => ({
  sex: "female",
  description: "20, brown hair, tan, great physique.",
  flaws: flawsFromIds(["dark-circles", "puffiness"]),
  afterScore: 8,
  beforeScore: 5,
  ...over,
});

// --- the after is where the face is decided ---------------------------------

test("only the after names a face; the before never describes one", () => {
  // The whole reason the pair holds together. A second description of the face
  // is how one person becomes two, and it is the failure every viewer spots
  // instantly without being able to say why.
  const after = afterPortraitPrompt(spec());
  const before = beforeFromAfterPrompt(spec());
  assert.match(after, /cheekbones/i, "the after carries the structural language");
  assert.doesNotMatch(before, /cheekbones/i, "the before must not re-describe the face");
  assert.doesNotMatch(before, /jawline/i);
  assert.match(before, /Keep this exact person/);
});

test("the after score actually changes the after prompt", () => {
  // The defect that started this: the form showed a before and an after field
  // under a note reading "these numbers steer the prompt", and the request body
  // never carried them. Asking for an eight and getting a five was the form
  // talking to itself.
  const eight = afterPortraitPrompt(spec({ afterScore: 8 }));
  const nine = afterPortraitPrompt(spec({ afterScore: 9.5 }));
  const five = afterPortraitPrompt(spec({ afterScore: 5 }));
  assert.notEqual(eight, nine);
  assert.notEqual(eight, five);
  assert.match(nine, /exceptionally good-looking/i);
  assert.match(eight, /strikingly good-looking/i);
  assert.match(five, /ordinary, pleasant-looking/i);
});

test("a wider gap applies the flaws harder", () => {
  const narrow = beforeFromAfterPrompt(spec({ afterScore: 8, beforeScore: 7.5 }));
  const wide = beforeFromAfterPrompt(spec({ afterScore: 8, beforeScore: 4 }));
  assert.match(narrow, /Apply these subtly/);
  assert.match(wide, /Apply these heavily/);
});

// --- the before adds; it never clears ---------------------------------------

test("the before carries the add half of each flaw, never the clear half", () => {
  const flaws = flawsFromIds(["dark-circles", "puffiness"]);
  const before = beforeFromAfterPrompt(spec({ flaws }));
  for (const flaw of flaws) {
    assert.ok(before.includes(flaw.add), `the before must add "${flaw.id}"`);
    assert.ok(!before.includes(flaw.clear), `the before must not clear "${flaw.id}"`);
  }
});

test("a pair with no chips is still two different photographs", () => {
  // Two identical images are not a before and after. The default is the mildest
  // honest version rather than a heavy one: an operator who picked nothing has
  // said nothing, not asked for the worst.
  const before = beforeFromAfterPrompt(spec({ flaws: [] }));
  assert.match(before, /dull and uneven|tired/i);
});

// --- what must never move ---------------------------------------------------

test("every before refuses to restructure the face", () => {
  for (const prompt of [beforeFromAfterPrompt(spec()), beforeBodyPrompt(spec())]) {
    assert.match(prompt, /Do not restructure the face/);
    assert.match(prompt, /Do not make them a different person/);
  }
});

test("every before holds the photograph itself constant", () => {
  // A before in flat light beside an after in good light is the standard lie of
  // glow-up content: nothing about the person changed. Holding the photograph
  // constant is what makes the difference attributable to the face.
  for (const prompt of [beforeFromAfterPrompt(spec()), beforeBodyPrompt(spec())]) {
    assert.match(prompt, /same background, same lighting, same camera/);
    assert.match(prompt, /same distance from the lens/);
  }
});

test("the beauty language never names colouring or ethnicity", () => {
  // Structure and grooming only. A house prompt that encoded a look would be
  // applying one standard of attractiveness to everybody, which is the thing
  // this product does not do anywhere else either. The operator's own
  // description is the only place colouring gets decided.
  const banned = /\b(?:white|black|asian|caucasian|european|african|latina|latino|hispanic|blonde|pale|fair[- ]skinned|light[- ]skinned|dark[- ]skinned)\b/i;
  const houseText = (built: string) => built.replace(spec().description, "");
  for (const built of [
    afterPortraitPrompt(spec({ sex: "female" })),
    afterPortraitPrompt(spec({ sex: "male" })),
    afterBodyPrompt(spec({ sex: "female" })),
    afterBodyPrompt(spec({ sex: "male" })),
  ]) {
    assert.doesNotMatch(houseText(built), banned);
  }
});

test("the two sexes get different structural language", () => {
  const woman = afterPortraitPrompt(spec({ sex: "female" }));
  const man = afterPortraitPrompt(spec({ sex: "male" }));
  assert.notEqual(woman, man);
  assert.match(man, /square jaw/i);
  assert.match(woman, /full lips/i);
});

// --- the body/face bleed ----------------------------------------------------

test("build wording is fenced to the body in every framed shot", () => {
  // "Great physique, curvy body" came back as a fuller JAW, because a
  // head-and-shoulders prompt has nowhere else to put the word. Saying which
  // half of the description applies to the frame in view is the fix.
  assert.match(afterPortraitPrompt(spec()), /describes the BODY only/);
  assert.match(afterPortraitPrompt(spec()), /no softness or fullness under the chin/);
});

test("the full-length shots descend from the same person", () => {
  for (const prompt of [afterBodyPrompt(spec()), beforeBodyPrompt(spec())]) {
    assert.match(prompt, /Keep this exact person/);
  }
  assert.match(afterBodyPrompt(spec()), /head to toe/i);
  assert.match(afterBodyPrompt(spec()), /Athletic rather than heavy/);
});

test("the operator's own description reaches both framings", () => {
  const described = spec({ description: "26, freckles, shoulder-length hair." });
  assert.ok(afterPortraitPrompt(described).includes(described.description));
  assert.ok(afterBodyPrompt(described).includes(described.description));
});

// --- the score guard --------------------------------------------------------

test("scores are clamped to the scale rather than rejected", () => {
  // A number input is the wrong place to argue with somebody.
  assert.equal(usableScore(8.2, 7.5), 8.2);
  assert.equal(usableScore(99, 7.5), 10);
  assert.equal(usableScore(-4, 7.5), 1);
  assert.equal(usableScore("8.5", 7.5), 8.5);
});

test("a non-decimal numeric string cannot pick a band the form cannot produce", () => {
  // Number() reads "0x8" as 8, "0b10" as 2, "0o10" as 8 and "1e1" as 10, all
  // finite and all in range, so a crafted request could select a beauty band
  // by a syntax the number input never emits.
  for (const crafted of ["0x8", "0b10", "0o10", "1e1", "1e400", "Infinity", " 0x8 "]) {
    assert.equal(usableScore(crafted, 7.5), 7.5, `${crafted} must not be read as a score`);
  }
  // And the shapes a real form DOES emit still work.
  for (const [input, want] of [["8.5", 8.5], ["8", 8], [".5", 1], ["-4", 1], [" 7.5 ", 7.5]] as Array<[string, number]>) {
    assert.equal(usableScore(input, 7.5), want);
  }
});

test("the operator's description outranks the house template", () => {
  // Otherwise the fixed features quietly overrule what they actually asked
  // for, and the tool stops being theirs.
  const built = afterPortraitPrompt(spec());
  assert.match(built, /Where the description above conflicts with any of these features, follow the description\./);
  assert.ok(
    built.indexOf(spec().description) < built.indexOf("follow the description"),
    "the override must come after the description it defers to",
  );
});

test("the same bar is applied regardless of the description", () => {
  // What CLAUDE.md forbids is a standard that VARIES. One template for
  // everybody is the compliant shape; a different bar per description would
  // not be. Two very different descriptions must produce the same band text.
  const band = (description: string) =>
    afterPortraitPrompt(spec({ description })).replace(description, "");
  assert.equal(band("20, brown hair, tan."), band("40, grey hair, freckles, glasses."));
});

test("a missing or unusable score falls back rather than producing NaN", () => {
  // A NaN reaching beautyBand would fail every comparison and silently pick the
  // bottom band, which is the same defect as not sending the number at all.
  for (const bad of [undefined, null, "", "abc", NaN, {}]) {
    assert.equal(usableScore(bad, 7.5), 7.5);
  }
  assert.match(afterPortraitPrompt(spec({ afterScore: usableScore(undefined, 7.5) })), /notably good-looking/i);
});

// --- redoing one frame ------------------------------------------------------

test("a redo carries what was asked for", () => {
  const built = redoPrompt("after", "give her shorter hair");
  assert.match(built, /give her shorter hair/);
  assert.match(built, /Keep this exact person/);
});

test("the structural refusals come AFTER whatever was typed", () => {
  // The last word in a prompt is the one that holds, so everything this
  // product will not do to a face has to sit below the free text rather than
  // above it. Somebody typing the opposite must not be able to win.
  const built = redoPrompt("before", "make the jaw much narrower and the chin weaker");
  const typed = built.indexOf("make the jaw much narrower");
  const refusal = built.indexOf("Do not restructure the face");
  assert.ok(typed > -1 && refusal > typed, "the refusal must follow the instruction");
});

test("a redo of a BEFORE frame carries the full structural refusal", () => {
  // This is the frame that could quietly turn the pair into the structural lie
  // the catalogue exists to prevent, so it gets the long form.
  for (const frame of ["before", "beforeBody"] as const) {
    const built = redoPrompt(frame, "rougher skin");
    assert.match(built, /still the unflattering photograph of the SAME person/);
    assert.match(built, /Do not change the bone structure, the jaw width, the nose or the eye shape/);
    assert.match(built, /Do not make them a different person, older, or younger/);
  }
});

test("a redo holds the photograph and the framing constant", () => {
  assert.match(redoPrompt("after", "warmer tone"), /same background, same lighting, same camera/i);
  assert.match(redoPrompt("afterBody", "different shoes"), /full-length framing, head to toe/i);
  assert.match(redoPrompt("after", "different top"), /head-and-shoulders framing/i);
});

test("a redo instruction is capped", () => {
  // An unbounded box is an unbounded prompt, and the cost of a long one lands
  // on us rather than on whoever typed it.
  const built = redoPrompt("after", "x".repeat(MAX_REDO_CHARS + 500));
  assert.ok(built.includes("x".repeat(MAX_REDO_CHARS)));
  assert.ok(!built.includes("x".repeat(MAX_REDO_CHARS + 1)));
});

test("build wording is fenced to the body on a redo too", () => {
  // The same bleed that turned "curvy" into a fuller jaw would come straight
  // back through a redo box otherwise.
  assert.match(redoPrompt("after", "curvier figure"), /describes the BODY only/);
});
