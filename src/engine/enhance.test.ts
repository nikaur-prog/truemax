import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEnhance, edgeEnergy, LOOKS, lookFor, upscaleFor } from "./enhance.js";

// A soft vertical edge: dark left half blending to bright right half over a
// few columns — the shape compression smearing leaves behind.
function softEdge(w: number, h: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = Math.max(0, Math.min(1, (x - w / 2 + 3) / 6));
      const v = 60 + t * 140;
      const i = (y * w + x) * 4;
      px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255;
    }
  }
  return px;
}

test("sharpening raises the edge energy of a soft edge", () => {
  const w = 40, h = 24;
  const px = softEdge(w, h);
  const before = edgeEnergy(px, w, h);
  applyEnhance(px, w, h, { ...LOOKS.standard, saturation: 1, contrast: 1 });
  const after = edgeEnergy(px, w, h);
  assert.ok(after > before * 1.15, `edge energy ${before} -> ${after} should rise by >15%`);
});

test("a flat field passes through untouched — no ringing where there is nothing to ring", () => {
  const w = 16, h = 16;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    px[i * 4] = 120; px[i * 4 + 1] = 120; px[i * 4 + 2] = 120; px[i * 4 + 3] = 255;
  }
  applyEnhance(px, w, h, { sharpen: 1.0, saturation: 1.2, contrast: 1, radius: 2 });
  for (let i = 0; i < w * h; i++) {
    assert.equal(px[i * 4], 120);
    assert.equal(px[i * 4 + 1], 120);
    assert.equal(px[i * 4 + 2], 120);
  }
});

test("saturation pushes chroma apart and leaves grey alone", () => {
  const w = 4, h = 1;
  const px = new Uint8ClampedArray(w * h * 4);
  // one reddish pixel, one grey pixel, padding
  px.set([180, 90, 90, 255], 0);
  px.set([140, 140, 140, 255], 4);
  px.set([140, 140, 140, 255], 8);
  px.set([140, 140, 140, 255], 12);
  const spreadBefore = px[0] - px[1];
  applyEnhance(px, w, h, { sharpen: 0, saturation: 1.3, contrast: 1, radius: 1 });
  assert.ok(px[0] - px[1] > spreadBefore, "red pixel chroma should widen");
  assert.equal(px[4], px[5]);
  assert.equal(px[5], px[6]);
});

test("contrast expands values away from mid-grey and clamps at the rails", () => {
  const w = 3, h = 1;
  const px = new Uint8ClampedArray([40, 40, 40, 255, 128, 128, 128, 255, 250, 250, 250, 255]);
  applyEnhance(px, w, h, { sharpen: 0, saturation: 1, contrast: 1.3, radius: 1 });
  assert.ok(px[0] < 40, "dark should get darker");
  assert.equal(px[4], 128, "mid-grey is the pivot");
  assert.equal(px[8], 255, "bright clamps at 255, not wraps");
});

test("lookFor scales the mask radius with the frame and never drops below 1px", () => {
  assert.equal(lookFor(LOOKS.standard, 1920).radius, LOOKS.standard.radius);
  assert.ok(lookFor(LOOKS.standard, 3840).radius > LOOKS.standard.radius);
  assert.equal(lookFor(LOOKS.subtle, 100).radius, 1);
});

test("upscaleFor targets 1920 on the long edge, caps at 2x, never downscales", () => {
  assert.equal(upscaleFor(576, 1024), 1920 / 1024);
  assert.equal(upscaleFor(480, 640), 2);
  assert.equal(upscaleFor(1080, 1920), 1);
  assert.equal(upscaleFor(2160, 3840), 1);
});
