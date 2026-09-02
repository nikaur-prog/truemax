import assert from "node:assert/strict";
import test from "node:test";
import { MAX_CLIP_BYTES, validateLibraryFile } from "./clipLibrary.js";

test("clips library accepts images and videos", () => {
  assert.deepEqual(validateLibraryFile({ type: "video/mp4", size: 100 }), { ok: true, kind: "video" });
  assert.deepEqual(validateLibraryFile({ type: "image/jpeg", size: 100 }), { ok: true, kind: "image" });
});

test("clips library rejects unsupported, empty and oversized files", () => {
  assert.equal(validateLibraryFile({ type: "audio/mpeg", size: 100 }).ok, false);
  assert.equal(validateLibraryFile({ type: "video/mp4", size: 0 }).ok, false);
  assert.equal(validateLibraryFile({ type: "video/mp4", size: MAX_CLIP_BYTES + 1 }).ok, false);
});
