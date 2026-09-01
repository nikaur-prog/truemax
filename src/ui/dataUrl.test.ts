import assert from "node:assert/strict";
import test from "node:test";
import { decodeImageDataUrl } from "./dataUrl.js";

test("image data URLs decode locally with their real file type", async () => {
  for (const [mime, extension] of [
    ["jpeg", "jpg"],
    ["png", "png"],
    ["webp", "webp"],
  ] as const) {
    const decoded = decodeImageDataUrl(`data:image/${mime};base64,AA==`);
    assert.ok(decoded);
    assert.equal(decoded.extension, extension);
    assert.equal(decoded.blob.type, `image/${mime}`);
    assert.deepEqual([...new Uint8Array(await decoded.blob.arrayBuffer())], [0]);
  }
});

test("image data URL decoder rejects unsupported and malformed input", () => {
  assert.equal(decodeImageDataUrl("data:image/gif;base64,AA=="), null);
  assert.equal(decodeImageDataUrl("data:image/jpeg;base64,A"), null);
  assert.equal(decodeImageDataUrl("data:image/jpeg;base64,AA==\n"), null);
  assert.equal(decodeImageDataUrl("https://example.com/photo.jpg"), null);
});
