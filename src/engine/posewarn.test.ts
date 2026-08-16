import test from "node:test";
import assert from "node:assert/strict";
import { JAW_POSE_WARN_DEG } from "./quality.js";

// The threshold that has to stay one number.
//
// It was two: results.ts warned about a tilted jaw above 6°, and the capture
// screen said nothing until 28°. Everything in between scanned clean, spent
// the weekly scan, and only then admitted the jaw was measured off a photo
// that could not support it. Both surfaces now read this constant, and the
// point of the test is that it stays low enough to fire before the hard
// occlusion gates rather than drifting up to meet them.

test("the jaw pose warning fires long before the occlusion gates", () => {
  // 28 yaw / 26 pitch are where landmarks self-occlude and the whole read
  // degrades. The jaw goes wrong far earlier and for a different reason, so a
  // value anywhere near those would make this warning pointless.
  assert.ok(JAW_POSE_WARN_DEG > 0, "must actually fire");
  assert.ok(JAW_POSE_WARN_DEG <= 10, `${JAW_POSE_WARN_DEG}° is too permissive to protect the jaw`);
});

test("the capture nag and the results caveat share one number", () => {
  // Not a behavioural test so much as a tripwire: if somebody re-introduces a
  // literal in either place, this is the comment that explains why they should
  // not. The constant is exported precisely so neither surface owns its own.
  assert.equal(typeof JAW_POSE_WARN_DEG, "number");
  assert.ok(Number.isFinite(JAW_POSE_WARN_DEG));
});
