import assert from "node:assert/strict";
import test from "node:test";
import { buildStoredZip } from "./zipArchive.js";

test("stored zip contains local, central and end records with every filename", () => {
  const zip = buildStoredZip({
    "01-before.jpg": new Uint8Array([1, 2, 3]),
    "caption.txt": new TextEncoder().encode("hello"),
  }, new Date("2026-09-02T12:00:00Z"));
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(zip.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(zip.length - 12, true), 2);
  const text = new TextDecoder().decode(zip);
  assert.match(text, /01-before\.jpg/);
  assert.match(text, /caption\.txt/);
});

test("stored zip sanitises path separators from supplied names", () => {
  const zip = buildStoredZip({ "folder/slide.jpg": new Uint8Array([4]) });
  const text = new TextDecoder().decode(zip);
  assert.match(text, /folder-slide\.jpg/);
  assert.doesNotMatch(text, /folder\/slide/);
});
