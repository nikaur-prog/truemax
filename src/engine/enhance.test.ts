import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyEnhance,
  edgeEnergy,
  IMAGE_TARGET,
  LOOKS,
  lookFor,
  MAX_UPSCALE,
  upscaleFor,
  upscalePlan,
  VIDEO_TARGET,
} from "./enhance.js";

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

// --- how big the output gets ------------------------------------------------

test("the sizes people actually upload are upscaled, which is the whole bug", () => {
  // The regression that started this. Every one of these came back at its
  // input size under a button promising a 4K upscale, because the target was
  // 1920 and all of them were already at or past it. A phone screen recording
  // and a TikTok download are the two commonest inputs this tool has.
  for (const [w, h] of [[1080, 1920], [1920, 1080], [1440, 2560]] as Array<[number, number]>) {
    const plan = upscalePlan(w, h, IMAGE_TARGET);
    assert.ok(plan.scale > 1, `${w}x${h} must actually be upscaled, got ${plan.scale}`);
    assert.equal(plan.reason, "upscaled");
  }
  // And the headline case reaches true 4K rather than something near it.
  assert.deepEqual(upscalePlan(1080, 1920, IMAGE_TARGET), { scale: 2, w: 2160, h: 3840, reason: "upscaled" });
});

test("a source already past the target is left alone, and says so", () => {
  // A 12MP phone photo is 4032 on the long edge, which is past 4K. Leaving it
  // is correct. Reporting it as an upscale would be a lie, and reporting
  // nothing at all is what made the tool look broken.
  const plan = upscalePlan(3024, 4032, IMAGE_TARGET);
  assert.equal(plan.scale, 1);
  assert.equal(plan.w, 3024);
  assert.equal(plan.h, 4032);
  assert.equal(plan.reason, "already-sharp");
});

test("nothing is ever downscaled and nothing is invented past 2x", () => {
  // The ceiling is the honesty rule: this is a clean resample plus edge
  // recovery, so past 2x it would be enlarging mush and calling it detail.
  const small = upscalePlan(480, 640, IMAGE_TARGET);
  assert.equal(small.scale, MAX_UPSCALE);
  assert.equal(small.reason, "capped");
  assert.deepEqual([small.w, small.h], [960, 1280]);
  // Never below 1, whatever it is handed.
  for (const [w, h] of [[8000, 6000], [3840, 2160], [4032, 3024]] as Array<[number, number]>) {
    assert.equal(upscalePlan(w, h, IMAGE_TARGET).scale, 1);
  }
});

test("images aim at 4K and video does not, and neither can inherit the other", () => {
  // They were one hidden constant, which is how the image path ended up with
  // video's ceiling. Every caller now names its target, and the two differ:
  // a video frame is resampled and unsharp masked in plain JS on the person's
  // own device, so 4x the pixels is 4x the slowest cost in the tool.
  assert.equal(IMAGE_TARGET, 3840);
  assert.equal(VIDEO_TARGET, 1920);
  assert.equal(upscaleFor(1080, 1920, IMAGE_TARGET), 2);
  assert.equal(upscaleFor(1080, 1920, VIDEO_TARGET), 1);
});

test("a degenerate size cannot produce a NaN scale or a zero-pixel canvas", () => {
  // These reach the function straight off an <img> or <video> that has not
  // loaded, where naturalWidth is 0. A NaN scale would take the canvas with it.
  for (const [w, h] of [[0, 0], [0, 1080], [NaN, NaN], [-10, -10], [Infinity, 100]] as Array<[number, number]>) {
    const plan = upscalePlan(w, h, IMAGE_TARGET);
    assert.ok(Number.isFinite(plan.scale), `${w}x${h} gave a non-finite scale`);
    assert.ok(plan.scale >= 1);
  }
});
