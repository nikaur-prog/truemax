import test from "node:test";
import assert from "node:assert/strict";
import {
  BACK_LANDMARK_IDS,
  LANDMARK_TOOL,
  LANDMARK_VERSION,
  SIDE_LANDMARK_IDS,
  landmarkPrompt,
  landmarksToPixels,
  parseLandmarkToolInput,
} from "./_sideLandmarks.js";

// A profile facing image-right: nose at the left of the frame is NOT this;
// the nose tip sits further right than the ear notch.
function facingRight(): Record<string, { x: number; y: number; confidence: number }> {
  const at = (x: number, y: number, confidence = 0.9) => ({ x, y, confidence });
  return {
    trichion: at(0.42, 0.18),
    glabella: at(0.47, 0.3),
    nasion: at(0.46, 0.34),
    pronasale: at(0.55, 0.45),
    subnasale: at(0.5, 0.49),
    labialeSuperius: at(0.51, 0.53),
    labialeInferius: at(0.5, 0.57),
    pogonion: at(0.49, 0.63),
    menton: at(0.45, 0.67),
    cervicale: at(0.35, 0.7),
    gonion: at(0.28, 0.62, 0.6),
    condylion: at(0.24, 0.44, 0.5),
    tragion: at(0.22, 0.44, 0.7),
  };
}

test("the tool schema requires every one of the thirteen points and nothing else", () => {
  const schema = LANDMARK_TOOL.input_schema as unknown as { required: string[]; properties: Record<string, unknown>; additionalProperties: boolean };
  assert.deepEqual([...schema.required].sort(), [...SIDE_LANDMARK_IDS].sort());
  assert.deepEqual(Object.keys(schema.properties).sort(), [...SIDE_LANDMARK_IDS].sort());
  assert.equal(schema.additionalProperties, false);
  // The five the seeder infers are a subset, and the split is exact.
  for (const id of BACK_LANDMARK_IDS) assert.ok(SIDE_LANDMARK_IDS.includes(id));
  assert.equal(BACK_LANDMARK_IDS.length, 5);
});

test("the prompt names every landmark, asks for fractions, and describes nobody", () => {
  const prompt = landmarkPrompt();
  for (const id of SIDE_LANDMARK_IDS) assert.ok(prompt.includes(`- ${id}:`), id);
  assert.match(prompt, /fractions of the image/);
  assert.match(prompt, /Do not describe the person/);
  assert.doesNotMatch(prompt, /—/, "no em dash");
  for (const word of ["attractive", "ethnic", "race", "age", "gender"]) {
    assert.doesNotMatch(prompt, new RegExp(`\\b${word}\\b`, "i"), word);
  }
});

test("a complete answer parses, with the facing taken from the points", () => {
  const result = parseLandmarkToolInput(facingRight());
  assert.equal(result.faceDir, 1);
  assert.equal(result.points.pronasale.x, 0.55);
  assert.equal(result.confidence.condylion, 0.5);
  // Mirror it and the facing flips.
  const mirrored = Object.fromEntries(
    Object.entries(facingRight()).map(([id, p]) => [id, { ...p, x: 1 - p.x }]),
  );
  assert.equal(parseLandmarkToolInput(mirrored).faceDir, -1);
});

test("a missing or out-of-image point is a refusal, not a guess", () => {
  const missing = facingRight();
  delete missing.gonion;
  assert.throws(() => parseLandmarkToolInput(missing), /gonion is missing/);
  const outside = facingRight();
  outside.tragion = { x: 1.2, y: 0.4, confidence: 0.9 };
  assert.throws(() => parseLandmarkToolInput(outside), /tragion is outside/);
  const nan = facingRight();
  nan.menton = { x: Number.NaN, y: 0.6, confidence: 0.9 };
  assert.throws(() => parseLandmarkToolInput(nan), /menton is outside/);
  assert.throws(() => parseLandmarkToolInput(null), /not an object/);
});

test("a nose on top of the ear is not a profile", () => {
  const flat = facingRight();
  flat.tragion = { x: 0.53, y: 0.44, confidence: 0.9 };
  assert.throws(() => parseLandmarkToolInput(flat), /too close together/);
});

test("confidence outside 0 to 1 falls back to the middle rather than failing the pass", () => {
  const odd = facingRight();
  odd.trichion = { x: 0.42, y: 0.18, confidence: 7 };
  assert.equal(parseLandmarkToolInput(odd).confidence.trichion, 0.5);
});

test("pixels are fractions times the frame", () => {
  const result = parseLandmarkToolInput(facingRight());
  const px = landmarksToPixels(result, 480, 640);
  assert.equal(px.pronasale.x, 0.55 * 480);
  assert.equal(px.pronasale.y, 0.45 * 640);
});

test("the version stamp is a short tag, not a model name", () => {
  assert.match(LANDMARK_VERSION, /^vision-\d+$/);
});
