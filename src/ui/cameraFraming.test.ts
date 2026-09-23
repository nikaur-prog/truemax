import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyFrontFit, frontPreviewMap } from "./camera.js";
import { fitFrontPreview } from "../engine/frontFraming.js";

test("preview and guide map use one transform on portrait, landscape and rotated viewports", () => {
  for (const source of [{ width: 1080, height: 1920 }, { width: 1920, height: 1080 }]) {
    for (const view of [{ width: 390, height: 844 }, { width: 1440, height: 900 }, { width: 844, height: 390 }]) {
      const fit = fitFrontPreview(source, view, { x: 0.3, y: 0.22, w: 0.32, h: 0.52 });
      const map = frontPreviewMap(source, fit);
      for (const unmirrored of [false, true]) {
        const video = { style: {} } as HTMLVideoElement;
        applyFrontFit(video, source, view, fit, unmirrored);
        const values = video.style.transform.slice(7, -1).split(",").map(Number);
        const [sx, skewY, skewX, sy, x, y] = values;
        assert.equal(skewY, 0); assert.equal(skewX, 0);
        assert.equal(Math.abs(sx), sy, "never stretch facial geometry");
        for (const [nx, ny] of [[0, 0], [0.3, 0.22], [0.62, 0.74], [1, 1]]) {
          const point = map(nx, ny);
          const videoX = nx * source.width * sx + x;
          const videoY = ny * source.height * sy + y;
          assert.ok(Math.abs(videoX - (unmirrored ? point.x : view.width - point.x)) < 1e-8);
          assert.ok(Math.abs(videoY - point.y) < 1e-8);
          const recoveredX = (videoX - x) / sx / source.width;
          const recoveredY = (videoY - y) / sy / source.height;
          assert.ok(Math.abs(recoveredX - nx) < 1e-8);
          assert.ok(Math.abs(recoveredY - ny) < 1e-8);
        }
      }
    }
  }
});

test("camera checks original frame dimensions and never samples the display crop", () => {
  const camera = readFileSync(new URL("./camera.ts", import.meta.url), "utf8");
  assert.match(camera, /const source = \{ width: v\.videoWidth, height: v\.videoHeight \}/);
  assert.match(camera, /checkFrame\(result, stats, source, glasses\)/);
  const capture = camera.slice(camera.indexOf("    capture() {"), camera.indexOf("    async swap()"));
  assert.match(capture, /c\.width = v\.videoWidth;\s*c\.height = v\.videoHeight/);
  assert.match(capture, /ctx\.drawImage\(v, 0, 0\)/);
  assert.doesNotMatch(capture, /frontFit|clientWidth|clientHeight|applyConstraints/);
});

test("front frame reset is scoped to the owned stream and side capture keeps its separate mapping", () => {
  const camera = readFileSync(new URL("./camera.ts", import.meta.url), "utf8");
  assert.match(camera, /if \(ownedPreview\) \{\s*opts\.video\.srcObject = null;\s*restoreVideoStyle\(\)/);
  assert.match(camera, /stream = nextStream;\s*restoreVideoStyle\(\)/);
  assert.match(camera, /if \(frontFitSize !== sizeKey\) \{[\s\S]*?frontFit = fitFrontPreview\(source, size, null\)/);
  assert.match(camera, /if \(side\) drawGuide\(opts\.guideCanvas, v\)/);
  assert.match(camera, /drawGuide\(opts\.guideCanvas, v, frontFit\)/);
  assert.match(camera, /now - lastFaceAt > 1200/);
  assert.match(camera, /prefers-reduced-motion: reduce/);
});

test("countdown can lock display fitting while quality checks and frame cadence stay live", () => {
  const camera = readFileSync(new URL("./camera.ts", import.meta.url), "utf8");
  assert.match(camera, /setFramingLocked\(locked\) \{ framingLocked = locked; \}/);
  assert.match(camera, /if \(!framingLocked\) frontFit = settleFrontPreview/);
  assert.ok(camera.indexOf("cadence.measured(ts, performance.now());") < camera.indexOf("if (!framingLocked) frontFit = settleFrontPreview"));
  assert.match(camera, /frontTarget = stableFrontPreviewTarget\(frontTarget, target, source\)/);
  assert.match(camera, /frontSource = null;\s*frontViewport = null;\s*framingLocked = false/);
});
