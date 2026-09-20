import test from "node:test";
import assert from "node:assert/strict";
import { photoPointBounds, resultPhotoFrame, resultPhotoTransform } from "./resultPhotoFraming.js";

test("small face in a portrait gets useful framing without altering its points", () => {
  const points = [{ x: .3, y: .2 }, { x: .7, y: .5 }];
  const before = JSON.stringify(points);
  const frame = resultPhotoFrame(photoPointBounds(points), { imageWidth: 720, imageHeight: 1280, boxWidth: 354, boxHeight: 300 });
  assert.ok(frame.scale > 2 && frame.scale <= 4);
  assert.equal(JSON.stringify(points), before);
  assert.match(resultPhotoTransform(frame), /^translate\(.+%, .+%\) scale\(.+\)$/);
});

test("front/side/landscape and off-centre faces keep all points inside the frame", () => {
  for (const bounds of [
    { x0: .3, y0: .2, x1: .7, y1: .5 },
    { x0: .02, y0: .05, x1: .4, y1: .6 },
    { x0: .65, y0: .5, x1: .98, y1: .98 },
    { x0: 0, y0: 0, x1: 1, y1: 1 },
  ]) for (const [iw, ih] of [[720, 1280], [1280, 720], [1000, 1000]]) {
    const bw = 354, bh = 300;
    const frame = resultPhotoFrame(bounds, { imageWidth: iw, imageHeight: ih, boxWidth: bw, boxHeight: bh });
    const contain = Math.min(bw / iw, bh / ih);
    for (const [x, y] of [[bounds.x0, bounds.y0], [bounds.x1, bounds.y1]]) {
      const px = ((bw - iw * contain) / 2 + x * iw * contain) * frame.scale + frame.tx * bw / 100;
      const py = ((bh - ih * contain) / 2 + y * ih * contain) * frame.scale + frame.ty * bh / 100;
      assert.ok(px >= -.001 && px <= bw + .001, `${px} cropped horizontally`);
      assert.ok(py >= -.001 && py <= bh + .001, `${py} cropped vertically`);
    }
    assert.ok(frame.scale >= 1 && frame.scale <= 4);
  }
});

test("framing is deterministic on repeated calls and adapts to rotation", () => {
  const b = { x0: .3, y0: .2, x1: .7, y1: .6 };
  const geo = { imageWidth: 600, imageHeight: 1000, boxWidth: 354, boxHeight: 300 };
  const initial = resultPhotoFrame(b, geo);
  for (let i = 0; i < 20; i++) assert.deepEqual(resultPhotoFrame(b, geo), initial);
  assert.notDeepEqual(resultPhotoFrame(b, { ...geo, boxWidth: 720, boxHeight: 190 }), initial);
});

test("invalid, absent or degenerate geometry falls back to the whole photograph", () => {
  assert.equal(photoPointBounds([]), null);
  assert.equal(photoPointBounds([{ x: .5, y: NaN }, { x: .6, y: .4 }]), null);
  assert.equal(photoPointBounds([{ x: -.1, y: .2 }, { x: .8, y: .8 }]), null);
  const geo = { imageWidth: 600, imageHeight: 1000, boxWidth: 354, boxHeight: 300 };
  for (const b of [null, { x0: .9, y0: .1, x1: .1, y1: .9 }, { x0: 0, y0: 0, x1: NaN, y1: 1 }]) {
    assert.deepEqual(resultPhotoFrame(b, geo), { scale: 1, tx: 0, ty: 0 });
  }
  assert.deepEqual(resultPhotoFrame({ x0: .1, y0: .1, x1: .9, y1: .9 }, { ...geo, boxWidth: 0 }), { scale: 1, tx: 0, ty: 0 });
});
