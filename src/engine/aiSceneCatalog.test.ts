import test from "node:test";
import assert from "node:assert/strict";

import { HANDHELD, sceneById, scenesFor } from "./aiSceneCatalog.js";
import { MAX_REDO_CHARS, scenePrompt } from "./aiPairPrompt.js";
import { flawsFromIds } from "./faceFlawCatalog.js";
import type { PairSpec } from "./aiPairPrompt.js";

const spec = (over: Partial<PairSpec> = {}): PairSpec => ({
  sex: "female",
  description: "20, brown hair, tan.",
  flaws: flawsFromIds(["dark-circles", "puffiness"]),
  afterScore: 8,
  beforeScore: 5,
  ...over,
});

// --- the catalogue ----------------------------------------------------------

test("both sexes get a full set of eight scenes", () => {
  // Eight rather than five so a set of five can be drawn without repeats, and
  // so a character can be filmed twice without producing the same contact
  // sheet.
  for (const sex of ["male", "female"] as const) {
    assert.equal(scenesFor(sex).length, 8, `${sex} needs eight`);
  }
});

test("every scene is fully specified", () => {
  // A scene missing its light or its camera is a scene the model fills in
  // itself, which is how a set drifts into looking like stock photography.
  for (const sex of ["male", "female"] as const) {
    for (const scene of scenesFor(sex)) {
      for (const field of ["label", "setting", "camera", "light", "action", "wardrobe"] as const) {
        assert.ok(scene[field]?.trim(), `${sex}/${scene.id} is missing ${field}`);
      }
    }
  }
});

test("scene ids are unique within a sex", () => {
  for (const sex of ["male", "female"] as const) {
    const ids = scenesFor(sex).map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, `${sex} has a duplicate id`);
  }
});

test("an unknown id is dropped rather than guessed at", () => {
  assert.equal(sceneById("female", "not-a-scene"), null);
  assert.equal(sceneById("female", ""), null);
  // And a scene belonging to the other sex is not silently accepted: the
  // framing and lighting are sex-specific, so crossing them would produce the
  // wrong shot rather than a near-enough one.
  assert.equal(sceneById("female", "led-portrait"), null, "a male-only scene must not resolve for a woman");
  assert.equal(sceneById("male", "bathroom-mirror"), null, "a female-only scene must not resolve for a man");
});

test("the sexes differ in framing and light, not only in location", () => {
  // The thing eight female and four male references showed that no written
  // location list would have: the men's set is tighter and lit hard, the
  // women's is wider and lit by the room.
  const women = scenesFor("female").map((s) => `${s.camera} ${s.light}`).join(" ").toLowerCase();
  const men = scenesFor("male").map((s) => `${s.camera} ${s.light}`).join(" ").toLowerCase();
  assert.match(women, /mid-thigh/, "the women's framing crops at mid-thigh");
  assert.match(men, /coloured directional light/, "hard coloured light is the male device");
  assert.match(men, /chin to hairline/, "the men's framing is far tighter");
});

// --- the prompt -------------------------------------------------------------

test("a scene carries its own setting, camera, light, action and wardrobe", () => {
  const scene = scenesFor("female")[0];
  const built = scenePrompt(scene, "after", spec());
  for (const part of [scene.setting, scene.camera, scene.light, scene.wardrobe]) {
    assert.ok(built.includes(part), `the prompt lost ${part.slice(0, 30)}`);
  }
});

test("every scene keeps the approved person", () => {
  // The set is an edit chain off one approved character. A set of five
  // near-identical strangers is worthless, and it is the failure a fresh
  // text-to-image call per scene would produce.
  for (const sex of ["male", "female"] as const) {
    for (const scene of scenesFor(sex)) {
      for (const side of ["before", "after"] as const) {
        const built = scenePrompt(scene, side, spec({ sex }));
        assert.match(built, /Keep this exact person/);
        assert.match(built, /Do not restructure the face/);
      }
    }
  }
});

test("a BEFORE scene carries the full structural refusal", () => {
  // A scene is where a structural change would be easiest to hide, because so
  // much else is legitimately different from the after.
  const scene = scenesFor("male")[0];
  const before = scenePrompt(scene, "before", spec({ sex: "male" }));
  assert.match(before, /Do not change the bone structure, the jaw width, the nose or the eye shape/);
  assert.match(before, /Do not make them a different person, older, or younger/);
});

test("a BEFORE scene applies the chips and an AFTER scene does not", () => {
  const flaws = flawsFromIds(["dark-circles", "puffiness"]);
  const scene = scenesFor("female")[0];
  const before = scenePrompt(scene, "before", spec({ flaws }));
  const after = scenePrompt(scene, "after", spec({ flaws }));
  for (const flaw of flaws) {
    assert.ok(before.includes(flaw.add), `the before scene must add ${flaw.id}`);
    assert.ok(!after.includes(flaw.add), `the after scene must not add ${flaw.id}`);
  }
  assert.match(after, /Clear healthy skin/);
});

test("every scene reads as a phone shot rather than a studio one", () => {
  // Left unsaid, the model returns a clean studio portrait, which is exactly
  // what makes AI UGC read as AI.
  for (const sex of ["male", "female"] as const) {
    for (const scene of scenesFor(sex)) {
      assert.ok(scenePrompt(scene, "after", spec({ sex })).includes(HANDHELD));
    }
  }
});

test("build wording stays fenced to the body in a scene", () => {
  assert.match(scenePrompt(scenesFor("female")[0], "after", spec()), /describes the BODY only/);
});

test("every scene states an adult", () => {
  for (const sex of ["male", "female"] as const) {
    for (const scene of scenesFor(sex)) {
      for (const side of ["before", "after"] as const) {
        assert.match(scenePrompt(scene, side, spec({ sex })), /An adult\./);
      }
    }
  }
});

test("no scene names colouring or ethnicity", () => {
  // Same rule as the beauty bands: one standard for everybody, and the
  // operator's description is the only place colouring is decided.
  const banned = /\b(?:white|black skin|asian|caucasian|european|african|latina|latino|hispanic|blonde|pale|fair[- ]skinned|dark[- ]skinned)\b/i;
  for (const sex of ["male", "female"] as const) {
    for (const scene of scenesFor(sex)) {
      const text = `${scene.setting} ${scene.camera} ${scene.light} ${scene.action} ${scene.wardrobe}`;
      assert.doesNotMatch(text, banned, `${sex}/${scene.id}`);
    }
  }
});

// --- redoing one shot with a change ----------------------------------------

test("a redo with no change reproduces the same prompt", () => {
  // The empty box is the commonest case: "that one just came out wrong, roll
  // it again". Making it differ from the original request would mean a reroll
  // silently asked for something else.
  const scene = scenesFor("female")[0];
  assert.equal(scenePrompt(scene, "after", spec()), scenePrompt(scene, "after", spec(), ""));
  assert.equal(scenePrompt(scene, "after", spec()), scenePrompt(scene, "after", spec(), "   "));
});

test("a change is carried, and sits between the scene and the refusals", () => {
  // After the scene so it wins on anything they disagree about; before the
  // structural refusals so it never wins on those.
  const scene = scenesFor("female")[0];
  const built = scenePrompt(scene, "before", spec(), "make the room darker");
  const sceneAt = built.indexOf(scene.setting);
  const changeAt = built.indexOf("make the room darker");
  const refusalAt = built.indexOf("Do not restructure the face");
  assert.ok(sceneAt > -1 && changeAt > sceneAt, "the change must follow the scene");
  assert.ok(refusalAt > changeAt, "the refusals must follow the change");
});

test("a change cannot restructure a face however it is worded", () => {
  const scene = scenesFor("male")[0];
  const built = scenePrompt(scene, "before", spec({ sex: "male" }), "give him a much weaker chin and a narrow jaw");
  assert.match(built, /Do not change the bone structure, the jaw width, the nose or the eye shape/);
  assert.ok(built.lastIndexOf("Do not restructure") > built.indexOf("weaker chin"));
});

test("a change is capped", () => {
  const scene = scenesFor("female")[0];
  const built = scenePrompt(scene, "after", spec(), "y".repeat(500));
  assert.ok(built.includes("y".repeat(MAX_REDO_CHARS)));
  assert.ok(!built.includes("y".repeat(MAX_REDO_CHARS + 1)));
});
