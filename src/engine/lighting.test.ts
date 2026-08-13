import test from "node:test";
import assert from "node:assert/strict";
import { FACE_HIGHLIGHT_MIN, PHOTO_BRIGHT, lightOk } from "./captureGuide.js";
import type { FrameStats } from "./captureGuide.js";

// ---------------------------------------------------------------------------
// The lighting gate, and the bias that was in it.
//
// Reported from a real session: somebody in clear light told to turn a light
// on. The gate was "mean luma of the face above 38", and that question has a
// skin tone in it — a well-lit dark-skinned face means in the forties and
// fifties, a well-lit pale one means over a hundred. The app was refusing to
// scan people on the basis of their complexion and telling them their room was
// too dim.
//
// Exposure and pigment separate once you stop averaging: on any adequately lit
// face something is bright — forehead, nose bridge, a specular highlight — at
// every skin tone, and real underexposure crushes detail to black where dark
// skin in good light does not.
// ---------------------------------------------------------------------------

const stats = (over: Partial<FrameStats>): FrameStats => ({
  luma: 120,
  lumaHigh: 190,
  darkShare: 0.02,
  sharpness: 0.4,
  ...over,
});

test("a well-lit dark-skinned face passes", () => {
  // The reported case. Mean well under the old floor of 38 in the deepest
  // readings, but the forehead and nose still carry a real highlight and
  // nothing is crushed — which is what "the room is bright" actually looks
  // like on this face.
  assert.equal(lightOk(stats({ luma: 34, lumaHigh: 96, darkShare: 0.08 })), true);
  assert.equal(lightOk(stats({ luma: 47, lumaHigh: 132, darkShare: 0.03 })), true);
  assert.equal(lightOk(stats({ luma: 58, lumaHigh: 150, darkShare: 0.01 })), true);
});

test("a genuinely underexposed face still fails", () => {
  // Nothing on the face is even moderately lit.
  assert.equal(lightOk(stats({ luma: 22, lumaHigh: 40, darkShare: 0.3 })), false);
  // Or most of it is crushed past recovery, whatever the odd highlight says.
  assert.equal(lightOk(stats({ luma: 30, lumaHigh: 120, darkShare: 0.7 })), false);
});

test("the two failure modes are independent", () => {
  // A dim face with no crushing fails on the highlight test alone, and a
  // crushed face with a bright highlight fails on the clipping test alone.
  // Either one is sufficient; neither is required.
  assert.equal(lightOk(stats({ lumaHigh: FACE_HIGHLIGHT_MIN - 1, darkShare: 0 })), false);
  assert.equal(lightOk(stats({ lumaHigh: 255, darkShare: 0.9 })), false);
  assert.equal(lightOk(stats({ lumaHigh: FACE_HIGHLIGHT_MIN, darkShare: 0.44 })), true);
});

test("blown-out is still blocked", () => {
  // Overexposure has no pigment problem: a face washed to white has lost the
  // geometry the measurement depends on, whoever it belongs to.
  assert.equal(lightOk(stats({ luma: PHOTO_BRIGHT + 1, lumaHigh: 255 })), false);
  assert.equal(lightOk(stats({ luma: PHOTO_BRIGHT, lumaHigh: 255 })), true);
});

test("the highlight floor is low enough to clear real photographs", () => {
  // Guards the constant. Anything much above ~80 starts excluding correctly
  // exposed dark skin under warm indoor light, which is the bug this replaced.
  assert.ok(FACE_HIGHLIGHT_MIN <= 80, `${FACE_HIGHLIGHT_MIN} is too high`);
  // And low enough that a nearly black frame cannot sneak through.
  assert.ok(FACE_HIGHLIGHT_MIN >= 40, `${FACE_HIGHLIGHT_MIN} is too low`);
});

test("no threshold in the gate reads the mean except for overexposure", () => {
  // The regression guard. If somebody reintroduces a mean-luma floor, a face
  // with a low mean and a healthy highlight will start failing again and this
  // will catch it — that combination is exactly what dark skin in good light
  // looks like.
  for (let mean = 10; mean <= 60; mean += 5) {
    assert.equal(lightOk(stats({ luma: mean, lumaHigh: 140, darkShare: 0.05 })), true, `mean ${mean}`);
  }
});
