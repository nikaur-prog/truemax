import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fingerprintCalibrationImage, snapshotCalibrationImageSource } from "./calibrationImageSource.js";

function canvas(width: number, height: number, bytes: Uint8ClampedArray): HTMLCanvasElement {
  return { width, height, getContext: () => ({ getImageData: () => ({ data: bytes }) }) } as unknown as HTMLCanvasElement;
}
const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const pixels = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);

test("a stable review fingerprint includes dimensions and raw RGBA bytes, while file hashing uses original bytes", async () => {
  const originalFile = new File(["original upload bytes"], "Private-Person.png");
  const source = await fingerprintCalibrationImage(canvas(2, 1, pixels), { originalFile });
  const same = await fingerprintCalibrationImage(canvas(2, 1, pixels), { originalFile });
  assert.deepEqual(source, same);
  assert.equal(source.originalFileSha256, digest("original upload bytes"));
  assert.equal(source.reviewPixelsSha256, createHash("sha256")
    .update("truemax-calibration-rgba8-v1\n2x1\n").update(pixels).digest("hex"));
  assert.equal(source.orientation, "review-image-as-displayed");
  assert.equal(source.width, 2);
  assert.equal(source.height, 1);
  assert.doesNotMatch(JSON.stringify(source), /Private-Person|original upload bytes|data:image|fileName|\.png/);
  assert.deepEqual(Object.keys(source).sort(), ["height", "orientation", "originalFileSha256", "pixelFormat", "reviewPixelsSha256", "schemaVersion", "width"]);
});

test("orientation, pixel and dimension changes cannot inherit another review image's fingerprint", async () => {
  const source = await fingerprintCalibrationImage(canvas(2, 1, pixels));
  const portrait = await fingerprintCalibrationImage(canvas(1, 2, pixels));
  const mirrored = await fingerprintCalibrationImage(canvas(2, 1, new Uint8ClampedArray([...pixels.slice(4), ...pixels.slice(0, 4)])));
  const changed = await fingerprintCalibrationImage(canvas(2, 1, new Uint8ClampedArray([11, ...pixels.slice(1)])));
  assert.notEqual(source.reviewPixelsSha256, portrait.reviewPixelsSha256);
  assert.notEqual(source.reviewPixelsSha256, mirrored.reviewPixelsSha256);
  assert.notEqual(source.reviewPixelsSha256, changed.reviewPixelsSha256);
  assert.equal("originalFileSha256" in source, false, "camera captures do not invent an upload hash");
});

test("a retake cannot change a pending hash because review pixels are copied before awaiting", async () => {
  const mutable = new Uint8ClampedArray(pixels);
  const pending = fingerprintCalibrationImage(canvas(2, 1, mutable));
  mutable.fill(0);
  const result = await pending;
  assert.equal(result.reviewPixelsSha256, (await fingerprintCalibrationImage(canvas(2, 1, pixels))).reviewPixelsSha256);
});

test("an already-cancelled capture never reads the canvas or file", async () => {
  const controller = new AbortController();
  controller.abort();
  const neverRead = { width: 2, height: 1, getContext: () => { throw new Error("canvas read after cancellation"); } } as unknown as HTMLCanvasElement;
  await assert.rejects(fingerprintCalibrationImage(neverRead, { signal: controller.signal }), { name: "AbortError" });
});

test("cancellation stops waiting for a file read and never publishes a late result", async () => {
  const controller = new AbortController();
  let release!: (value: ArrayBuffer) => void;
  let started!: () => void;
  const reading = new Promise<void>((resolve) => { started = resolve; });
  const originalFile = { arrayBuffer: () => { started(); return new Promise<ArrayBuffer>((resolve) => { release = resolve; }); } } as Blob;
  const pending = fingerprintCalibrationImage(canvas(2, 1, pixels), { originalFile, signal: controller.signal });
  await reading;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  release(new ArrayBuffer(1));
});

test("invalid or incomplete canvases fail rather than minting a match for missing pixels", async () => {
  for (const [width, height] of [[0, 1], [1, -1], [1.5, 1], [NaN, 2]]) {
    await assert.rejects(fingerprintCalibrationImage(canvas(width, height, pixels)), /dimensions/);
  }
  await assert.rejects(fingerprintCalibrationImage(canvas(2, 2, pixels)), /incomplete/);
  const noContext = { width: 1, height: 1, getContext: () => null } as unknown as HTMLCanvasElement;
  await assert.rejects(fingerprintCalibrationImage(noContext), /could not be matched/);
});

test("snapshot validation rejects inconsistent metadata and strips unrecognised private fields", async () => {
  const source = await fingerprintCalibrationImage(canvas(2, 1, pixels));
  assert.deepEqual(snapshotCalibrationImageSource({ ...source, name: "Private person", photo: "data:image/png;base64,secret", pixels: [1, 2] }), source);
  for (const invalid of [
    { ...source, reviewPixelsSha256: "not-a-hash" },
    { ...source, originalFileSha256: "private.png" },
    { ...source, orientation: "exif-raw" },
    { ...source, pixelFormat: "jpeg" },
    { ...source, width: 0 },
    { ...source, schemaVersion: 2 },
  ]) assert.throws(() => snapshotCalibrationImageSource(invalid), /invalid/);
  assert.throws(() => snapshotCalibrationImageSource(source, { width: 1, height: 2 }), /dimensions do not match/);
  assert.deepEqual(snapshotCalibrationImageSource(source, { width: 2, height: 1 }), source);
});

test("side hashing is calibration-only, source-bound and attempt-checked before placement publishes", () => {
  const flow = readFileSync(new URL("../ui/sideFlow.ts", import.meta.url), "utf8");
  assert.match(flow, /await loadCanvas\(c, ctx, signal, file\)/);
  assert.match(flow, /const imageSource = ctx.reviewMode === "calibration"\s*\? await fingerprintCalibrationImage\(snapshot, \{ originalFile, signal \}\)\s*: undefined;\s*if \(!sideAttempt.current\(signal\)\) return;/);
  assert.match(flow, /imageSource: seed.imageSource \? \{ \.\.\.seed.imageSource \} : undefined/);
  assert.match(flow, /if \(ctx.reviewMode !== "calibration" && seed.faceDir === -1/);
});
