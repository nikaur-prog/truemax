import test from "node:test";
import assert from "node:assert/strict";
import type { FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { checkFrame, type FrameStats } from "./captureGuide.js";
import { assessQuality } from "./quality.js";
import { faceBounds, fitFrontPreview, frontFaceDetail, frontSourceFraming, settleFrontPreview, type FaceBounds } from "./frontFraming.js";

const goodStats: FrameStats = { luma: 120, lumaHigh: 180, darkShare: 0, sharpness: 0.45 };
function detection(box: FaceBounds, yaw = 0): FaceLandmarkerResult {
  const lm = Array.from({ length: 478 }, () => ({ x: box.x + box.w / 2, y: box.y + box.h / 2, z: 0, visibility: 1 }));
  lm[234].x = box.x; lm[454].x = box.x + box.w;
  lm[10].y = box.y; lm[152].y = box.y + box.h;
  const r = yaw * Math.PI / 180;
  return { faceLandmarks: [lm], faceBlendshapes: [], facialTransformationMatrixes: [{ rows: 4, columns: 4, data: [Math.cos(r), 0, Math.sin(r), 0, 0, 1, 0, 0, -Math.sin(r), 0, Math.cos(r), 0, 0, 0, 0, 1] }] };
}
const centered = (w: number, h: number): FaceBounds => ({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });

test("portrait phones no longer reject a clear 70%-wide face just because of preview width", () => {
  const source = { width: 1080, height: 1920 };
  const result = checkFrame(detection(centered(0.7, 0.54)), goodStats, source);
  assert.equal(result.gates.distance, true);
  assert.equal(result.ready, true);
  assert.doesNotMatch(result.hint, /back|close/i);
});

test("landscape webcams accept a clear normally framed face below the old 30% width floor", () => {
  const source = { width: 1920, height: 1080 };
  const det = detection(centered(0.18, 0.45));
  assert.equal(checkFrame(det, goodStats, source).ready, true);
  assert.equal(assessQuality(det, source).largeEnough, true, "post-capture advice agrees with live guidance");
});

test("equal source-pixel faces have equal detail checks in portrait and landscape", () => {
  const portrait = frontFaceDetail(centered(300 / 1080, 440 / 1920), { width: 1080, height: 1920 });
  const landscape = frontFaceDetail(centered(300 / 1920, 440 / 1080), { width: 1920, height: 1080 });
  assert.deepEqual(portrait, landscape);
  assert.equal(portrait.enough, true);
});

test("display zoom cannot rescue tiny faces or source clipping", () => {
  const source = { width: 1920, height: 1080 };
  const tiny = centered(0.05, 0.1);
  assert.equal(checkFrame(detection(tiny), goodStats, source).gates.distance, false);
  assert.match(checkFrame(detection(tiny), goodStats, source).hint, /closer/i);
  for (const box of [
    { x: -0.03, y: 0.2, w: 0.3, h: 0.6 },
    { x: 0.7, y: 0.2, w: 0.3, h: 0.6 },
    { x: 0.3, y: 0, w: 0.3, h: 0.6 },
    { x: 0.3, y: 0.5, w: 0.3, h: 0.5 },
  ]) assert.equal(frontSourceFraming(box, source).distance, false);
});

test("pose, strong glasses and actual blur still prevent automatic capture", () => {
  const source = { width: 1080, height: 1920 };
  const box = centered(0.65, 0.5);
  assert.equal(checkFrame(detection(box, 24), goodStats, source).ready, false);
  assert.equal(checkFrame(detection(box), { ...goodStats, sharpness: 0.1 }, source).ready, false);
  assert.equal(checkFrame(detection(box), goodStats, source, { advise: true, block: true }).ready, false);
});

test("invalid source dimensions or landmarks fail closed", () => {
  assert.equal(faceBounds([{ x: NaN, y: 0.3 }]), null);
  assert.equal(frontFaceDetail(centered(0.5, 0.5), { width: 0, height: 1080 }).enough, false);
  const det = detection(centered(0.5, 0.5));
  det.faceLandmarks[0][6].x = NaN;
  assert.equal(checkFrame(det, goodStats, { width: 1080, height: 1920 }).ready, false);
});

test("automatic fit preserves aspect ratio, keeps facial bounds visible and leaves headroom", () => {
  for (const source of [{ width: 1080, height: 1920 }, { width: 1920, height: 1080 }, { width: 640, height: 480 }]) {
    for (const view of [{ width: 390, height: 844 }, { width: 1440, height: 900 }, { width: 844, height: 390 }]) {
      const box = centered(0.36, 0.5);
      const fit = fitFrontPreview(source, view, box);
      assert.ok(Number.isFinite(fit.scale) && fit.scale > 0);
      assert.ok(fit.x + box.x * source.width * fit.scale >= 0);
      assert.ok(fit.x + (box.x + box.w) * source.width * fit.scale <= view.width);
      assert.ok(fit.y + box.y * source.height * fit.scale >= 0);
      assert.ok(fit.y + (box.y + box.h) * source.height * fit.scale <= view.height);
      assert.ok(box.w * source.width * fit.scale <= view.width * 0.77);
      assert.ok(box.h * source.height * fit.scale <= view.height * 0.6);
    }
  }
});

test("default and tiny-face fits show the full source without artificial magnification", () => {
  const source = { width: 1920, height: 1080 };
  const viewport = { width: 390, height: 844 };
  const empty = fitFrontPreview(source, viewport, null);
  assert.deepEqual(fitFrontPreview(source, viewport, centered(0.04, 0.08)), empty);
  assert.equal(empty.scale, 390 / 1920);
});

test("preview settles with a deadband and honors reduced motion", () => {
  const initial = { scale: 0.5, x: -10, y: -20 };
  assert.equal(settleFrontPreview(initial, { scale: 0.51, x: -12, y: -22 }, 100), initial);
  const target = { scale: 0.8, x: -100, y: -200 };
  const moved = settleFrontPreview(initial, target, 100);
  assert.ok(moved.scale > initial.scale && moved.scale < target.scale);
  assert.deepEqual(settleFrontPreview(initial, target, 100, true), initial);
  assert.equal(settleFrontPreview(null, target, 100), target);
});
