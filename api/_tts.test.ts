import assert from "node:assert/strict";
import test from "node:test";
import { validMp3Base64 } from "./tts.js";

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

test("MP3 validation requires a plausible audio frame, not only an ID3 label", () => {
  const tagOnly = new Uint8Array(256);
  tagOnly.set([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  assert.equal(validMp3Base64(base64(tagOnly)), false);

  const framed = new Uint8Array(834);
  // MPEG-1 Layer III, 128 kbps, 44.1 kHz.
  framed.set([0xff, 0xfb, 0x90, 0x00]);
  framed.set([0xff, 0xfb, 0x90, 0x00], 417);
  assert.equal(validMp3Base64(base64(framed)), true);

  const taggedAndFramed = new Uint8Array(844);
  taggedAndFramed.set([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  taggedAndFramed.set([0xff, 0xfb, 0x90, 0x00], 10);
  taggedAndFramed.set([0xff, 0xfb, 0x90, 0x00], 427);
  assert.equal(validMp3Base64(base64(taggedAndFramed)), true);
});

test("MP3 validation rejects malformed base64 and truncated responses", () => {
  assert.equal(validMp3Base64("not base64"), false);
  assert.equal(validMp3Base64(base64(new Uint8Array([0xff, 0xfb, 0x90, 0x00]))), false);
  const incompleteFrame = new Uint8Array(256);
  incompleteFrame.set([0xff, 0xfb, 0x90, 0x00]);
  assert.equal(validMp3Base64(base64(incompleteFrame)), false);
});
