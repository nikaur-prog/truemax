// Isolated browser verification of the real guide modules. No login, scans,
// personal storage, external requests or automatic landmark-provider calls.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = await mkdtemp(path.join(tmpdir(), "truemax-side-guide-"));
const server = await createServer({ root, server: { host: "127.0.0.1", port: 0, hmr: false } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  for (const [name, viewport, dir] of [
    ["desktop", { width: 1280, height: 900 }, 1],
    ["mobile", { width: 390, height: 844 }, 1],
    ["mobile-left", { width: 390, height: 844 }, -1],
    ["small-mobile", { width: 320, height: 568 }, 1],
    ["small-landscape", { width: 667, height: 375 }, 1],
  ]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => route.request().url().startsWith(base) ? route.continue() : route.abort());
    await page.route(`${base}/__guide_check`, (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/style.css"></head><body>
      <button id="hinge">Open hinge guide</button><button id="all">All points</button>
      <canvas id="thumb"></canvas>
      <script type="module">
        import {openPointReference} from '/src/ui/sidePointReference.ts';
        import {openReferenceOverlay} from '/src/ui/sideReference.ts';
        import {drawGuideCrop, playGuideZoom, GUIDE_PHOTO_URL} from '/src/ui/sideGuidePhoto.ts';
        const image = new Image(); image.src = GUIDE_PHOTO_URL; await image.decode();
        document.querySelector('#hinge').onclick = () => openPointReference(image, 'condylion', ${dir});
        document.querySelector('#all').onclick = () => openReferenceOverlay(${dir});
        drawGuideCrop(document.querySelector('#thumb'), image, 'condylion', ${dir});
        window.guideTest = { image, drawGuideCrop, playGuideZoom, openPointReference };
      </script></body></html>` }));
    await page.goto(`${base}/__guide_check`);
    await page.waitForFunction(() => !!window.guideTest);
    await page.locator("#hinge").click();
    const dialog = page.getByRole("dialog", { name: "Jaw hinge (estimate) placement guide", exact: true });
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /Green: Jaw hinge \(estimate\).*White: Ear notch/s);
    const before = await dialog.locator("canvas").evaluate((canvas) => ({ width: canvas.width, image: canvas.toDataURL() }));
    await dialog.getByRole("button", { name: "Whole face", exact: true }).click();
    assert.notEqual(await dialog.locator("canvas").evaluate((canvas) => canvas.toDataURL()), before.image);
    await dialog.getByRole("button", { name: "Close-up", exact: true }).click();
    assert.equal(await dialog.locator("canvas").evaluate((canvas) => canvas.toDataURL()), before.image);
    // Run the actual animation quickly and compare pixels with the still.
    await page.evaluate(async (dir) => {
      const canvas = document.querySelector('.refcrop-full canvas');
      await new Promise((resolve) => window.guideTest.playGuideZoom(canvas, window.guideTest.image, 'condylion', dir,
        { durationMs: 30, holdMs: 0, onDone: resolve }));
    }, dir);
    const after = await dialog.locator("canvas").evaluate((canvas) => ({ width: canvas.width, image: canvas.toDataURL() }));
    assert.deepEqual(after, before, "animation and static close-up must retain both pixels and resolution");
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1);
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height + 1);
    const canvasBounds = await dialog.locator("canvas").boundingBox();
    assert.ok(Math.abs(canvasBounds.width - canvasBounds.height) < 1, "guide photo must not stretch on small screens");
    await page.screenshot({ path: path.join(output, `${name}.png`) });
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".refcrop-full").count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement.id), "hinge");
    await page.locator("#all").click();
    await page.getByRole("button", { name: "Find the ear notch", exact: true }).click();
    assert.match(await page.locator(".refcrop-full").innerText(), /Green: Ear notch.*White: Jaw hinge \(estimate\)/s);
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog", { name: "Landmark reference", exact: true }).count(), 1,
      "closing a point guide must not dismiss its parent reference");
    await page.keyboard.press("Escape");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("#hinge").click();
    await page.getByRole("button", { name: "Show location", exact: true }).click();
    assert.equal(await dialog.locator("canvas").evaluate((canvas) => canvas.toDataURL()), before.image);
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      const broken = new Image();
      window.guideTest.openPointReference(broken, 'condylion', 1);
    });
    assert.equal(await page.locator(".refcrop-load-error").isVisible(), true);
    assert.equal(await page.getByRole("button", { name: "Show location", exact: true }).isDisabled(), true);
    await page.close();
    console.log(`${name}: guide rendering, mirrored coordinates, controls, zoom, sizing, Escape, reduced motion and image failure passed`);
  }
  assert.deepEqual(errors, []);
  console.log(`Screenshots: ${output}`);
} finally {
  await browser.close();
  await server.close();
}
