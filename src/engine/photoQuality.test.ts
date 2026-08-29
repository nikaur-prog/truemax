import test from "node:test";
import assert from "node:assert/strict";
import { assessPhotoQuality, detailEnergy } from "./photoQuality.js";

// The module's own entry point needs a canvas, which node does not have. The
// measurement it rests on does not, so that is what is pinned here: the
// thresholds are only worth anything if a blurred face really does score below
// a sharp one, by a margin far wider than the gap between the thresholds.

const W = 120;
const H = 120;
const BOX = { x: 4, y: 4, w: W - 8, h: H - 8 };

function field(fill: (x: number, y: number) => number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = fill(x, y);
      const i = (y * W + x) * 4;
      px[i] = v;
      px[i + 1] = v;
      px[i + 2] = v;
      px[i + 3] = 255;
    }
  }
  return px;
}

/** A box blur of radius r over a greyscale field, to make a soft copy. */
function blur(px: Uint8ClampedArray, r: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(px.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const sx = Math.min(W - 1, Math.max(0, x + dx));
          const sy = Math.min(H - 1, Math.max(0, y + dy));
          sum += px[(sy * W + sx) * 4]!;
          n++;
        }
      }
      const i = (y * W + x) * 4;
      const v = sum / n;
      out[i] = v;
      out[i + 1] = v;
      out[i + 2] = v;
      out[i + 3] = 255;
    }
  }
  return out;
}

test("a blurred field scores far below the sharp one it came from", () => {
  const sharp = field((x, y) => (((x >> 2) + (y >> 2)) % 2 ? 210 : 40));
  const soft = blur(sharp, 2);
  const a = detailEnergy(sharp, W, BOX);
  const b = detailEnergy(soft, W, BOX);
  assert.ok(a > b, `sharp ${a} not above blurred ${b}`);
  // The thresholds sit at 0.09 and 0.045, one octave apart, so the measure is
  // only useful if blurring moves a reading by more than that. It moves this
  // one by 2.5x, and on the real photographs the thresholds were fitted to
  // (see photoQuality.ts) halving the resolution moves it by about 4x.
  assert.ok(a > b * 2, `sharp ${a} only ${(a / b).toFixed(2)}x the blurred ${b}`);
});

test("exposure does not move the reading, because contrast is divided out", () => {
  // The same pattern, once dark and once bright. A measure that did not
  // normalise would call the bright one sharper, and every photo taken in a
  // dim room would be told it is soft.
  const bright = field((x, y) => (((x >> 2) + (y >> 2)) % 2 ? 230 : 60));
  const dark = field((x, y) => (((x >> 2) + (y >> 2)) % 2 ? 115 : 30));
  const a = detailEnergy(bright, W, BOX);
  const b = detailEnergy(dark, W, BOX);
  assert.ok(Math.abs(a - b) / Math.max(a, b) < 0.12, `bright ${a} vs dark ${b}`);
});

test("a flat field is not reported as infinitely sharp", () => {
  // No contrast at all means dividing by roughly zero. The guard keeps that
  // from becoming a huge number that reads as the sharpest photo ever taken.
  const flat = field(() => 128);
  const v = detailEnergy(flat, W, BOX);
  assert.ok(Number.isFinite(v), "flat field produced a non-finite reading");
  assert.ok(v < 1, `flat field read as ${v}`);
});

test("a very large phone photo is sampled from a bounded face crop", () => {
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const priorImage = Object.getOwnPropertyDescriptor(globalThis, "HTMLImageElement");
  let requested = { width: 0, height: 0 };
  class FakeImage {}
  const sample = {
    width: 0,
    height: 0,
    getContext: () => ({
      drawImage: () => undefined,
      getImageData: (_x: number, _y: number, width: number, height: number) => {
        requested = { width, height };
        return { data: new Uint8ClampedArray(width * height * 4) };
      },
    }),
  };
  Object.defineProperty(globalThis, "HTMLImageElement", { configurable: true, value: FakeImage });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => sample },
  });
  try {
    assessPhotoQuality(
      { width: 12000, height: 9000 } as HTMLCanvasElement,
      [
        { x: 0.3, y: 0.2, z: 0, visibility: 1 },
        { x: 0.7, y: 0.8, z: 0, visibility: 1 },
      ],
    );
    assert.ok(requested.width <= 768 && requested.height <= 768, JSON.stringify(requested));
  } finally {
    if (priorDocument) Object.defineProperty(globalThis, "document", priorDocument);
    else delete (globalThis as { document?: unknown }).document;
    if (priorImage) Object.defineProperty(globalThis, "HTMLImageElement", priorImage);
    else delete (globalThis as { HTMLImageElement?: unknown }).HTMLImageElement;
  }
});
