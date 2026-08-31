import assert from "node:assert/strict";
import test from "node:test";
import { automaticCaptureDetail, hasTouchFirstInput, sideCaptureInstruction } from "./captureCopy.js";

test("touch-first devices are never offered a keyboard shutter", () => {
  assert.equal(hasTouchFirstInput(1, false), true);
  assert.equal(hasTouchFirstInput(0, true), true);
  assert.equal(automaticCaptureDetail(true), "Taking it automatically");
  assert.doesNotMatch(sideCaptureInstruction(true), /space/i);
});

test("keyboard devices retain the immediate shutter shortcut", () => {
  assert.equal(hasTouchFirstInput(0, false), false);
  assert.match(automaticCaptureDetail(false), /space to take it now/i);
  assert.match(sideCaptureInstruction(false), /Space bar takes it immediately/);
});
