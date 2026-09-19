// Inspect the production Max avatar/chat through a no-account, local-only fixture.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchChromium } from "./launchChromium.mjs";

const origin = process.argv[2] ?? "http://127.0.0.1:4189";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw new Error("Use a local dev server.");
const artifacts = await mkdtemp(join(tmpdir(), "truemax-coach-review-"));
const browser = await launchChromium({ headless: true });
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const errors = [];
    const paidRequests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/api/max-")) paidRequests.push(url.pathname);
      return url.origin === new URL(origin).origin ? route.continue() : route.abort();
    });
    await page.goto(`${origin}/?preview=max-coach`);
    await page.waitForSelector(".maxtab-stage canvas[data-max3d]", { timeout: 20000 });
    await page.waitForFunction(() => document.querySelector(".maxtab-stage canvas[data-max3d]")?.style.visibility === "visible");
    await page.screenshot({ path: join(artifacts, `${viewport.width}-coach.png`) });
    await page.locator("[data-preview-open-chat]").click();
    await page.waitForFunction(() => document.querySelector(".maxchat-face canvas[data-max3d]")?.style.visibility === "visible");
    assert.equal(await page.locator("canvas[data-max3d]").count(), 1);
    await page.locator("[data-preview-coach-state=speaking]").click();
    await page.waitForFunction(() => document.querySelector(".maxchat-face canvas[data-max3d]")?.dataset.animation === "speaking");
    await page.screenshot({ path: join(artifacts, `${viewport.width}-speaking.png`) });
    await page.locator("[data-preview-coach-state=quiet]").click();
    await page.waitForFunction(() => document.querySelector(".maxchat-face canvas[data-max3d]")?.dataset.animation === "quiet");
    // Quiet deliberately blends from the previous pose for 0.28 visible
    // seconds. Observe zero frames only after the renderer has stopped its RAF.
    await page.waitForFunction(() => document.querySelector(".maxchat-face canvas[data-max3d]")?.dataset.motion === "settled", undefined, { timeout: 3000 });
    const quietFrames = await page.evaluate(async () => {
      let count = 0;
      const stage = document.querySelector(".maxchat-face");
      const tick = () => { count++; };
      stage.addEventListener("max3dframe", tick);
      await new Promise((resolve) => setTimeout(resolve, 350));
      stage.removeEventListener("max3dframe", tick);
      return count;
    });
    assert.equal(quietFrames, 0, "quiet must not keep repainting");
    await page.locator("[data-preview-coach-state=speaking]").click();
    await page.waitForFunction(() => document.querySelector(".maxchat-face canvas[data-max3d]")?.dataset.motion === "animating");
    const nativeBackground = await page.evaluate(async () => {
      const { bindNativeAppLifecycle } = await import("/src/engine/nativeBridge.ts");
      let emit;
      const unbind = bindNativeAppLifecycle({
        addListener: async (_event, listener) => { emit = listener; return { remove: async () => {} }; },
        getState: async () => ({ isActive: true }),
      });
      await Promise.resolve(); await Promise.resolve();
      emit({ isActive: false });
      const stage = document.querySelector(".maxchat-face");
      let frames = 0;
      const tick = () => { frames++; };
      stage.addEventListener("max3dframe", tick);
      const paused = stage.querySelector("canvas").dataset.motion === "paused";
      await new Promise((resolve) => setTimeout(resolve, 350));
      stage.removeEventListener("max3dframe", tick);
      unbind();
      return { paused, frames };
    });
    assert.deepEqual(nativeBackground, { paused: true, frames: 0 });
    await page.waitForFunction(() => document.querySelector(".maxchat-face canvas[data-max3d]")?.style.visibility === "visible");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false);
    await page.locator(".maxchat-close").click();
    await page.waitForFunction(() => document.querySelector(".maxtab-stage canvas[data-max3d]")?.style.visibility === "visible");
    assert.equal(await page.locator("canvas[data-max3d]").count(), 1);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("[data-preview-open-chat]").click();
    assert.equal(await page.locator(".maxchat-face canvas[data-max3d]").count(), 0);
    assert.equal(await page.locator(".maxchat-face .mx-svg").isVisible(), true);
    assert.deepEqual(paidRequests, []);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ viewport, oneRenderer: true, quietFrames, nativeBackground, reducedMotionFallback: true, overflow, paidRequests, errors }));
    await page.close();
  }
} finally { await browser.close(); }
console.log(`Screenshots: ${artifacts}`);
