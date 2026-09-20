// Real camera module and local detector, synthetic pixels only. No camera
// permission, authenticated storage, external requests or image uploads.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchChromium } from "./launchChromium.mjs";

const origin = process.argv[2] ?? "http://127.0.0.1:4193";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw new Error("Use a local dev server.");
const artifacts = await mkdtemp(join(tmpdir(), "truemax-camera-framing-"));
const browser = await launchChromium({ headless: true });
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    for (const source of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }]) {
      const page = await browser.newPage({ viewport, hasTouch: viewport.width < 850 });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.routeWebSocket("**/*", () => {});
      await page.route("**/*", route => {
        const url = new URL(route.request().url());
        return url.origin === origin && !url.pathname.startsWith("/api/") ? route.continue() : route.abort();
      });
      await page.goto(origin);
      await page.locator("#btn-upload").waitFor();
      await page.evaluate(async source => {
        const { startCamera } = await import("/src/ui/camera.ts");
        const image = new Image(); image.src = "/demo/dev.jpg"; await image.decode();
        const sourceCanvas = document.createElement("canvas");
        sourceCanvas.width = source.width; sourceCanvas.height = source.height;
        const ctx = sourceCanvas.getContext("2d");
        const draw = () => {
          ctx.fillStyle = "#314f77"; ctx.fillRect(0, 0, source.width, source.height);
          const s = Math.min(source.width * .85 / image.naturalWidth, source.height * .84 / image.naturalHeight);
          const w = image.naturalWidth * s, h = image.naturalHeight * s;
          ctx.drawImage(image, (source.width - w) / 2, (source.height - h) / 2, w, h);
          // Asymmetric stable markers expose accidental crop or mirror changes.
          ctx.fillStyle = "#aa3333"; ctx.fillRect(0, 0, 40, 40);
          ctx.fillStyle = "#33aa33"; ctx.fillRect(source.width - 40, 0, 40, 40);
        };
        draw();
        const timer = setInterval(draw, 33);
        const streams = [];
        const requests = [];
        Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async constraints => {
          requests.push(constraints);
          const stream = sourceCanvas.captureStream(30); streams.push(stream); return stream;
        } });
        document.body.classList.add("cam-takeover");
        document.querySelector("#oval-frame").classList.add("live");
        const video = document.querySelector("#cam-video");
        const guideCanvas = document.querySelector("#cam-guide");
        const originalStyle = video.getAttribute("style");
        const state = { checks: [], sourceCanvas, timer, video, guideCanvas, streams, requests, originalStyle };
        window.cameraFramingFixture = state;
        state.handle = await startCamera({ video, guideCanvas, onCheck: check => {
          state.checks.push({ face: check.gates.face, distance: check.gates.distance, hint: check.hint, transform: video.style.transform });
        } });
      }, source);
      await page.waitForFunction(() => {
        const state = window.cameraFramingFixture;
        return state.checks.filter(check => check.face).length >= 12;
      }, null, { timeout: 30_000 });
      // Observe multiple real detector frames settling rather than one chosen transform.
      const startCount = await page.evaluate(() => window.cameraFramingFixture.checks.length);
      await page.waitForFunction(count => window.cameraFramingFixture.checks.length > count + 20, startCount, { timeout: 15_000 });
      const report = await page.evaluate(() => {
        const state = window.cameraFramingFixture;
        const { video, handle, sourceCanvas } = state;
        const last = state.checks.slice(-8);
        const matrix = new DOMMatrixReadOnly(video.style.transform);
        const before = handle.capture();
        // An extreme display change must not alter one source pixel captured.
        video.style.transform = "matrix(-0.2, 0, 0, 0.2, 800, -30)";
        const after = handle.capture();
        const a = before.getContext("2d").getImageData(0, 0, before.width, before.height).data;
        const b = after.getContext("2d").getImageData(0, 0, after.width, after.height).data;
        let changed = 0;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed++;
        video.style.transform = last[last.length - 1].transform;
        const map = (x, y) => ({ x: matrix.a * x + matrix.e, y: matrix.d * y + matrix.f });
        const rectangle = video.getBoundingClientRect();
        const parent = video.offsetParent;
        const parentRect = parent.getBoundingClientRect();
        const content = { x: rectangle.x, y: rectangle.y, width: rectangle.width, height: rectangle.height };
        const values = { dimensions: [before.width, before.height], source: [sourceCanvas.width, sourceCanvas.height],
          changed, matrix: [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f],
          last, checks: state.checks.length, content, corner: map(0, 0), requests: state.requests.length,
          parentOrigin: { x: parentRect.x + parent.clientLeft, y: parentRect.y + parent.clientTop },
          overflow: document.documentElement.scrollWidth > innerWidth };
        return values;
      });
      assert.deepEqual(report.dimensions, [source.width, source.height]);
      assert.equal(report.changed, 0, "display crop must not change native capture pixels");
      assert.equal(report.requests, 1);
      assert.ok(report.matrix.every(Number.isFinite));
      assert.equal(Math.abs(report.matrix[0]), report.matrix[3]);
      const [sx, , , sy, tx, ty] = report.matrix;
      assert.ok(Math.abs(report.content.width - source.width * Math.abs(sx)) < .02);
      assert.ok(Math.abs(report.content.height - source.height * sy) < .02);
      assert.ok(Math.abs(report.content.x - report.parentOrigin.x - (tx + Math.min(0, sx * source.width))) < .02,
        "browser video placement agrees with mirrored source-coordinate mapping");
      assert.ok(Math.abs(report.content.y - report.parentOrigin.y - ty) < .02);
      assert.equal(report.last.every(check => check.face), true);
      assert.equal(report.last.every(check => check.distance), true, JSON.stringify(report.last));
      const scales = report.last.map(check => new DOMMatrixFallback(check.transform).scale);
      assert.ok(Math.max(...scales) - Math.min(...scales) < .03, "stationary subject preview should settle");
      await page.screenshot({ path: join(artifacts, `${viewport.width}-${source.width}x${source.height}.png`) });
      const cleanup = await page.evaluate(() => {
        const state = window.cameraFramingFixture;
        clearInterval(state.timer); state.handle.stop();
        return { style: state.video.getAttribute("style"), original: state.originalStyle,
          source: state.video.srcObject, capture: state.handle.capture(),
          stopped: state.streams.every(stream => stream.getTracks().every(track => track.readyState === "ended")) };
      });
      assert.equal(cleanup.style || null, cleanup.original || null);
      assert.equal(cleanup.source, null);
      assert.equal(cleanup.capture, null);
      assert.equal(cleanup.stopped, true);
      assert.deepEqual(errors, []);
      console.log(`${viewport.width}x${viewport.height}, source ${source.width}x${source.height}: real detector, stable fit, unchanged capture pixels and stop cleanup passed`);
      await page.close();
    }
  }
  console.log(`Screenshots: ${artifacts}`);
} finally { await browser.close(); }

function DOMMatrixFallback(text) {
  const [scale] = text.slice(7, -1).split(",").map(Number);
  this.scale = Math.abs(scale);
}
