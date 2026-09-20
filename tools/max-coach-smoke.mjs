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
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
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
    await page.locator(".maxchat-composer input").fill("Show a full reply so I can check the speech bubble.");
    await page.locator(".maxchat-composer button").click();
    await page.waitForFunction(() => !document.querySelector(".maxchat-composer input")?.disabled);
    assert.equal(await page.locator(".maxchat-speech .max-speech-bubble").count(), 1, "the local fixture reuses the chat's one bubble");
    await page.waitForFunction(() => document.querySelector(".maxchat-speech .max-speech-words")?.textContent.endsWith("sent or saved."));
    const replyLayout = await page.evaluate(() => {
      const words = document.querySelector(".maxchat-speech .max-speech-words");
      const close = document.querySelector(".maxchat-close").getBoundingClientRect();
      const input = document.querySelector(".maxchat-composer input").getBoundingClientRect();
      return { cropped: words.scrollHeight > words.clientHeight + 1, closeVisible: close.top >= 0 && close.bottom <= innerHeight,
        composerVisible: input.top >= 0 && input.bottom <= innerHeight };
    });
    assert.deepEqual(replyLayout, { cropped: false, closeVisible: true, composerVisible: true });
    await page.screenshot({ path: join(artifacts, `${viewport.width}-full-reply.png`) });
    let keyboardLayout = null;
    if (viewport.width < 500) {
      const keyboard = { width: viewport.width === 390 ? 375 : viewport.width, height: 330 };
      await page.setViewportSize(keyboard);
      await page.waitForFunction(() => document.querySelector(".maxchat")?.classList.contains("maxchat-compact"));
      await page.locator(".maxchat-composer input").focus();
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      keyboardLayout = await page.evaluate(() => {
        const close = document.querySelector(".maxchat-close").getBoundingClientRect();
        const input = document.querySelector(".maxchat-composer input").getBoundingClientRect();
        const log = document.querySelector(".maxchat-log").getBoundingClientRect();
        return { height: innerHeight, closeVisible: close.top >= 0 && close.bottom <= innerHeight,
          composerVisible: input.top >= 0 && input.bottom <= innerHeight,
          logHeight: log.height, presenceHidden: document.querySelector(".maxchat-presence").getClientRects().length === 0 };
      });
      assert.equal(keyboardLayout.closeVisible, true, "Close stays reachable above the phone keyboard");
      assert.equal(keyboardLayout.composerVisible, true, "the focused composer stays in the visible viewport");
      assert.equal(keyboardLayout.presenceHidden, true, "decorative presence yields space to the conversation");
      assert.ok(keyboardLayout.logHeight >= 60, "the compact transcript still has room to scroll");
      await page.screenshot({ path: join(artifacts, `${keyboard.width}-keyboard.png`) });
      await page.setViewportSize(viewport);
      await page.waitForFunction(() => !document.querySelector(".maxchat")?.classList.contains("maxchat-compact"));
      await page.waitForFunction(() => document.querySelector(".maxchat-face canvas[data-max3d]")?.style.visibility === "visible");
      assert.equal(await page.locator("canvas[data-max3d]").count(), 1, "closing the keyboard resumes the same renderer");
    }
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
    console.log(JSON.stringify({ viewport, oneRenderer: true, quietFrames, nativeBackground, replyLayout, keyboardLayout, reducedMotionFallback: true, overflow, paidRequests, errors }));
    await page.close();
  }
} finally { await browser.close(); }
console.log(`Screenshots: ${artifacts}`);
