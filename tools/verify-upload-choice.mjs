// Real app upload entry points in a fresh, signed-out browser. This stops at
// the reference confirmation: no scan, purchase, account or provider request.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const photo = fileURLToPath(new URL("../public/side-guide/reference.jpg", import.meta.url));
const server = await createServer({ root, server: { host: "127.0.0.1", port: 0, hmr: false } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.setDefaultTimeout(15_000);
    await page.route("**/*", (route) => {
      const url = route.request().url();
      return url.startsWith(base) && !url.startsWith(`${base}/api/`) ? route.continue() : route.abort();
    });
    await page.goto(base);
    await page.locator("#btn-upload").waitFor();
    // A remembered browser selection must not answer for a new photo.
    await page.evaluate(async () => (await import('/src/engine/sexPref.ts')).storeSex('female'));
    async function picker() {
      const picked = page.waitForEvent("filechooser");
      await page.locator("#btn-upload").click();
      await page.locator(".tut-ask").waitFor();
      assert.equal(await page.locator(".sexpick").count(), 0, "no gender question before choosing a file");
      await page.locator(".tut-ask").getByRole("button", { name: "Skip", exact: true }).click();
      return picked;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const chooser = await picker();
      await chooser.setFiles(photo);
      await page.waitForFunction(() => document.querySelector('.sexpick-preview img')?.naturalWidth > 0);
      assert.equal(await page.locator('.sexpick-side[aria-pressed="true"]').count(), 0);
      assert.equal(await page.locator(".sexpick-continue").isDisabled(), true);
      await page.locator('.sexpick-side[data-sex="female"]').click();
      await page.locator('.sexpick-side[data-sex="male"]').click();
      assert.equal(await page.locator('.sexpick-side[data-sex="male"]').getAttribute("aria-pressed"), "true");
      await page.locator(".sexpick-cancel").click();
      assert.equal(await page.locator(".sexpick").count(), 0);
      assert.equal(await page.locator("#v-upload").isVisible(), true);
    }
    // Native cancellation has no FileChooser.cancel API in this harness.
    // Dispatch its browser event on the real input, then retry the same file.
    await picker();
    await page.locator("#file-input").dispatchEvent("cancel");
    assert.equal(await page.locator(".sexpick").count(), 0);
    const retry = await picker();
    await retry.setFiles(photo);
    await page.locator(".sexpick-continue").waitFor();
    assert.equal(await page.locator(".sexpick-continue").isDisabled(), true);
    await page.keyboard.press("Escape");
    // Pasting an image uses the same file-first, unselected confirmation.
    await page.evaluate(async () => {
      const blob = await (await fetch('/side-guide/reference.jpg')).blob();
      const data = new DataTransfer(); data.items.add(new File([blob], 'fixture.jpg', {type: 'image/jpeg'}));
      document.body.dispatchEvent(new ClipboardEvent('paste', {bubbles: true, clipboardData: data}));
    });
    await page.locator(".sexpick-continue").waitFor();
    assert.equal(await page.locator('.sexpick-side[aria-pressed="true"]').count(), 0);
    await page.keyboard.press("Escape");
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`${viewport.width}px: real app file-first selection, same-file retries, cancelled choices, picker-cancel event and pasted-photo choice passed`);
  }
} finally {
  await browser.close();
  await server.close();
}
