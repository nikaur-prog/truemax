import test from "node:test";
import assert from "node:assert/strict";

import { preparedScale } from "./rundownExport.js";

// The sizing half of the pre-render resample, which is the half that can go
// quietly wrong. The canvas work around it needs a DOM; this does not, and it
// is what decides whether a photograph arrives at the encoder sharper or
// softer than it started.

const OUT_H = 1920;

test("a small capture is enlarged toward what the crop will ask for", () => {
  // The rundown shows roughly a face and a half blown up to fill 1920 rows, so
  // a 1280-tall source is magnified past 2x inline. Resampling it once, up
  // front, is what stops the browser doing that per frame at whatever quality
  // it feels like.
  const scale = preparedScale(960, 1280, OUT_H);
  assert.ok(scale > 1, "a 1280-tall source needs help");
  assert.ok(scale <= 2, "and never more than double");
});

test("it NEVER shrinks the photograph", () => {
  // The failure that would look like a fix while making things worse. A factor
  // below 1 downscales on the way into the render, which is precisely the
  // damage this pass exists to undo.
  for (const [w, h] of [
    [4032, 3024],
    [3024, 4032],
    [6000, 4000],
    [400, 300],
    [1, 1],
  ]) {
    assert.ok(preparedScale(w, h, OUT_H) >= 1, `${w}x${h} must not be reduced`);
  }
});

test("a photo already big enough is left alone", () => {
  // 3200 tall covers a 1920-row crop at the 0.6 fraction with room over, so
  // there is nothing to gain and a full resample to pay for.
  assert.equal(preparedScale(2400, 3200, OUT_H), 1);
});

test("the enlargement is capped, so a phone is not asked for an unbounded canvas", () => {
  // The measurement overlay allocates a canvas at the photo's own size, so this
  // ceiling is a memory budget as much as a quality one.
  for (const [w, h] of [
    [600, 800],
    [240, 320],
    [120, 160],
  ]) {
    const scale = preparedScale(w, h, OUT_H);
    assert.ok(scale <= 2, "never more than double");
    assert.ok(Math.max(w, h) * scale <= 3200 + 1, "and never past the long-edge ceiling");
  }
});

test("the long-edge ceiling binds before the doubling does", () => {
  // A source already near the ceiling gets the part of the enlargement that
  // fits, not the whole of it.
  const scale = preparedScale(1500, 2000, OUT_H);
  assert.ok(scale > 1);
  assert.ok(2000 * scale <= 3200 + 1);
});

test("a degenerate size is passed through rather than producing NaN or Infinity", () => {
  // A zero-height canvas is a broken capture, not a reason to lose the export
  // or to ask for an infinitely large one.
  for (const [w, h, out] of [
    [0, 0, OUT_H],
    [1080, 0, OUT_H],
    [1080, 1920, 0],
    [Number.NaN, 1920, OUT_H],
    [1080, Number.POSITIVE_INFINITY, OUT_H],
  ]) {
    const scale = preparedScale(w, h, out);
    assert.ok(Number.isFinite(scale), `${w}x${h} -> ${out} must be finite`);
    assert.ok(scale >= 1);
  }
});

test("a taller output asks for more enlargement than a shorter one", () => {
  // The 1080p encode and the 720p compatibility fallback do not need the same
  // source. Sizing to the raster that will actually be encoded is the point of
  // doing this after the codec fallback has settled.
  const at1080 = preparedScale(1080, 1440, 1920);
  const at720 = preparedScale(1080, 1440, 1280);
  assert.ok(at1080 > at720);
});
