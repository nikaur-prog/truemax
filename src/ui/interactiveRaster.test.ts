import assert from "node:assert/strict";
import test from "node:test";
import { interactiveRasterSize, paintPhotoCanvas, resetCanvasState, sidePointsForRaster } from "./interactiveRaster.js";
import { drawSideRestingPoints } from "./sideMeasureOverlay.js";
import type { SidePoints } from "../engine/sideMetrics.js";

test("interactive raster follows the displayed size without upscaling source pixels", () => {
  assert.deepEqual(interactiveRasterSize(1440, 2160, 360, 540, 3), { width: 900, height: 1350 });
  assert.deepEqual(interactiveRasterSize(400, 600, 360, 540, 2), { width: 400, height: 600 });
  assert.deepEqual(interactiveRasterSize(1440, 2160, 0, 0, 2), { width: 1440, height: 2160 });
  const fit = interactiveRasterSize(2160, 1440, 360, 540, 2);
  assert.deepEqual(fit, { width: 900, height: 600 }, "letterboxing follows the contained photo, not the whole CSS box");
});

test("side raster conversion preserves normalized geometry and never mutates reviewed points", () => {
  const points = { gonion: { x: 400, y: 800 }, menton: { x: 900, y: 1300 } } as SidePoints;
  const before = JSON.stringify(points);
  const scaled = sidePointsForRaster(points, 1440, 2160, 900, 1350);
  for (const key of ["gonion", "menton"] as const) {
    assert.equal(scaled[key].x / 900, points[key].x / 1440);
    assert.equal(scaled[key].y / 1350, points[key].y / 2160);
    assert.notEqual(scaled[key], points[key]);
  }
  assert.equal(JSON.stringify(points), before);
  assert.equal(sidePointsForRaster(points, 1440, 2160, 1440, 2160), points);
});

test("main report photo swaps and side hover-out reuse unchanged canvas dimensions while fully resetting state", () => {
  let width = 0;
  let height = 0;
  let resizes = 0;
  let resets = 0;
  let clears = 0;
  let copies = 0;
  let dots = 0;
  const context = {
    reset() { resets++; }, clearRect() { clears++; }, drawImage() { copies++; },
    beginPath() {}, arc() { dots++; }, fill() {}, stroke() {},
  };
  const canvas = {
    get width() { return width; }, set width(n: number) { width = n; resizes++; },
    get height() { return height; }, set height(n: number) { height = n; resizes++; },
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  const photo = { width: 1440, height: 2160 } as HTMLCanvasElement;
  const points = { gonion: { x: 400, y: 800 }, menton: { x: 900, y: 1300 } } as SidePoints;
  for (let i = 0; i < 20; i++) {
    paintPhotoCanvas(canvas, photo);
    drawSideRestingPoints(canvas, points, photo.width, photo.height);
  }
  assert.equal(resizes, 2, "only the initial allocation changes backing dimensions");
  assert.equal(resets, 40, "transforms, alpha, composite, filters and clips cannot leak between paints");
  assert.equal(clears, 40);
  assert.equal(copies, 20);
  assert.equal(dots, 40);
  paintPhotoCanvas(canvas, { width: 2160, height: 1440 } as HTMLCanvasElement);
  assert.equal(resizes, 4, "actual orientation changes still resize correctly");
});

test("legacy canvas without reset retains the original complete-state fallback", () => {
  let resizes = 0;
  const context = {};
  const canvas = {
    get width() { return 1440; }, set width(_n: number) { resizes++; },
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  assert.equal(resetCanvasState(canvas), context);
  assert.equal(resizes, 1, "do not trade correctness of old clipping/state for an unsafe manual reset");
});
