import assert from "node:assert/strict";
import test from "node:test";
import { renderPreviewViews } from "./_previewProvider.js";

test("a front-only preview sends exactly one image request and returns no invented side", async () => {
  const front = Buffer.from("synthetic front");
  let calls = 0;
  const result = await renderPreviewViews({ front, instructions: "test recipe", deadline: 123 }, async (image, instructions, deadline) => {
    calls++;
    assert.equal(image, front);
    assert.equal(instructions, "test recipe");
    assert.equal(deadline, 123);
    return image;
  });
  assert.equal(calls, 1);
  assert.ok("front" in result);
  assert.equal(result.front, front);
  assert.equal("side" in result, false);
});

test("paired previews share a recipe and deadline and require both results", async () => {
  const front = Buffer.from("front"), side = Buffer.from("side");
  const seen: Buffer[] = [];
  const result = await renderPreviewViews({ front, side, instructions: "same bounded recipe", deadline: 123 }, async (image, instructions, deadline) => {
    seen.push(image);
    assert.match(instructions, /^same bounded recipe/);
    assert.equal(deadline, 123);
    return image === side ? { error: "Refused", status: 400 } : image;
  });
  assert.deepEqual(seen, [front, side]);
  assert.deepEqual(result, { error: "Refused", status: 400 });
});
