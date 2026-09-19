import test from "node:test";
import assert from "node:assert/strict";
import { maxReplyText } from "./maxReplyText.js";

test("Max replies keep readings and useful lists, without markup or theatrical punctuation", () => {
  assert.equal(maxReplyText("**The angle is 126°** \u2014 not a diagnosis.\n* Check the photo.\n* Keep the 0.86 ratio in context."), "The angle is 126°, not a diagnosis.\n- Check the photo.\n- Keep the 0.86 ratio in context.");
  const clean = "A reference band is not a treatment target.\n- Check the points first.";
  assert.equal(maxReplyText(clean), clean);
  assert.equal(maxReplyText(maxReplyText(clean)), clean);
});
