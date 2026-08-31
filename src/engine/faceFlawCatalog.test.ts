import test from "node:test";
import assert from "node:assert/strict";

import { FACE_FLAWS, concernsFor, flawsFromIds, unknownConcernIds } from "./faceFlawCatalog.js";

// The catalogue exists to stop the generator producing two people and calling
// it a before and after. These are the rules that keeps true.

test("no flaw implies bone structure can be changed", () => {
  // A glow-up does not change your skull. These are the words that would mean
  // it had, and they are also the measurements the product SCORES: a demo
  // implying a routine moves them contradicts the report it advertises.
  const structural = [
    /\bbone\b(?!\s+structure\b)/i, /\bskull\b/i, /\bcheekbone(?!s\b.*same)/i,
    /\bnarrow(er)? face\b/i, /\bwiden\b/i, /\bchin projection\b/i,
    /\bfacial third/i, /\bslim(mer)? the face\b/i, /\breshape\b/i,
  ];
  for (const flaw of FACE_FLAWS) {
    for (const pattern of structural) {
      // The clear half is allowed to say "do not reshape the bone", which is a
      // prohibition rather than a promise, so it is checked separately below.
      assert.doesNotMatch(flaw.add, pattern, `${flaw.id}.add implies structure`);
    }
  }
});

test("the one flaw that touches the jaw is explicit that it is fat, not bone", () => {
  // The sharp case. A layer of facial fat over a jaw is genuinely reversible;
  // the jaw underneath is the same jaw in both shots and must be.
  const jaw = FACE_FLAWS.find((f) => f.id === "soft-jawline");
  assert.ok(jaw, "the chip exists");
  assert.match(jaw.add, /fat/i, "the before adds fat, not a different jaw");
  assert.match(jaw.clear, /same underlying jawline/i);
  assert.match(jaw.clear, /Do not reshape the bone/i);
});

test("no flaw is a scar or anything a procedure would be needed for", () => {
  // Scars fade; they do not clear. Showing one gone in an after promises
  // something no protocol delivers.
  for (const flaw of FACE_FLAWS) {
    for (const word of [/\bscar/i, /\bsurgery\b/i, /\bfiller/i, /\bimplant/i, /\bbotox\b/i]) {
      assert.doesNotMatch(`${flaw.add} ${flaw.clear}`, word, `${flaw.id} is not reversible by a routine`);
    }
  }
});

test("no flaw is about the photograph rather than the person", () => {
  // THE LIE IN GLOW-UP CONTENT. A before in flat light beside an after in good
  // light changed nothing about the face. If the shot moves, the comparison is
  // worthless, so the shot is never something a chip can pick.
  for (const flaw of FACE_FLAWS) {
    for (const word of [/\blighting\b/i, /\bcamera\b/i, /\bangle\b/i, /\bfilter\b/i, /\bblurry\b/i]) {
      assert.doesNotMatch(`${flaw.add} ${flaw.clear}`, word, `${flaw.id} describes the shot, not the face`);
    }
  }
});

test("every flaw carries both halves and a unique id", () => {
  const ids = new Set<string>();
  for (const flaw of FACE_FLAWS) {
    assert.ok(flaw.label.trim(), `${flaw.id} has a chip label`);
    assert.ok(flaw.add.trim(), `${flaw.id} has a before fragment`);
    assert.ok(flaw.clear.trim(), `${flaw.id} has an after fragment`);
    assert.ok(!ids.has(flaw.id), `${flaw.id} is used twice`);
    ids.add(flaw.id);
  }
  assert.ok(FACE_FLAWS.length >= 12, "enough to describe a real before");
});

test("every concern reference points at a concern that exists", () => {
  // The link that stops this being decoration: a generated before carries
  // something the plan can genuinely speak to.
  assert.deepEqual(unknownConcernIds(), []);
  assert.ok(concernsFor([...FACE_FLAWS]).length > 0, "at least some map to the catalogue");
});

test("unknown ids are dropped, never passed through", () => {
  // Same rule as the attribution allowlist: the client is not trusted, and the
  // worst a crafted body achieves is fewer flaws than asked for, never
  // arbitrary wording in a prompt we pay to run.
  const picked = flawsFromIds(["redness", "not-a-flaw", "", "../../etc/passwd", "puffiness"]);
  assert.deepEqual(picked.map((f) => f.id), ["redness", "puffiness"]);
  assert.deepEqual(flawsFromIds([]), []);
  assert.deepEqual(flawsFromIds([null, 7, {}] as unknown[]), []);
});

test("selection order does not change the result", () => {
  // Two operators picking the same chips in a different sequence must get the
  // same prompt, or nobody can reproduce a look they liked.
  const a = flawsFromIds(["puffiness", "redness", "dark-circles"]).map((f) => f.id);
  const b = flawsFromIds(["dark-circles", "puffiness", "redness"]).map((f) => f.id);
  assert.deepEqual(a, b);
});

// How the ENDPOINT uses this catalogue is tested in aiPairPrompt.test.ts, by
// building the prompts and reading them, rather than here by regexing the file
// that contains them. Three separate rounds of review landed on the same
// criticism of the old assertions: they pinned the SHAPE of the source and
// would keep passing through a rewrite that broke the behaviour they described.
