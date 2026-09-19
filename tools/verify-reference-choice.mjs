// Exercise the real reference and subject dialogs with local tutorial pixels.
// Isolated browser storage; no accounts, user photos, provider calls or scans.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = await mkdtemp(path.join(tmpdir(), "truemax-reference-choice-"));
const server = await createServer({ root, server: { host: "127.0.0.1", port: 0, hmr: false } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  for (const [name, viewport] of [
    ["desktop", { width: 1280, height: 900 }],
    ["mobile", { width: 390, height: 844 }],
    ["small-mobile", { width: 320, height: 568 }],
    ["small-landscape", { width: 667, height: 375 }],
  ]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => route.request().url().startsWith(base) ? route.continue() : route.abort());
    await page.route(`${base}/__reference_check`, (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/style.css"></head><body>
      <button id="open">Choose photo reference</button>
      <script type="module">
        import {openSexChooser, close} from '/src/ui/sexChooser.ts';
        import {openSubjectChooser, closeSubjectChooser} from '/src/ui/subjectChooser.ts';
        const photo = await (await fetch('/side-guide/reference.jpg')).blob();
        const liveUrls = new Set();
        const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = (blob) => { const url = create(blob); liveUrls.add(url); return url; };
        URL.revokeObjectURL = (url) => { liveUrls.delete(url); revoke(url); };
        const calls = { picks: [], cancelled: 0, subjectPicks: [], subjectCancelled: 0, escapedKeys: 0 };
        window.addEventListener('keydown', event => { if (event.key === 'Enter') calls.escapedKeys++; });
        function open() { openSexChooser(sex => calls.picks.push(sex), undefined, () => calls.cancelled++, undefined, {photo, confirm:true}); }
        document.querySelector('#open').onclick = open;
        window.choiceTest = {open, openSexChooser, close, openSubjectChooser, closeSubjectChooser, photo, liveUrls, calls};
      </script></body></html>` }));
    await page.goto(`${base}/__reference_check`);
    await page.waitForFunction(() => !!window.choiceTest);
    const open = async () => {
      await page.locator("#open").click();
      await page.waitForFunction(() => document.querySelector('.sexpick-preview img')?.naturalWidth > 0);
    };
    await open();
    const dialog = page.getByRole("dialog");
    const next = page.getByRole("button", { name: "Continue", exact: true });
    const man = page.locator('.sexpick-side[data-sex="male"]');
    const woman = page.locator('.sexpick-side[data-sex="female"]');
    assert.equal(await next.isDisabled(), true);
    assert.equal(await page.locator('.sexpick-side[aria-pressed="true"]').count(), 0);
    await woman.click();
    assert.equal(await woman.getAttribute("aria-pressed"), "true");
    assert.deepEqual(await page.evaluate(() => window.choiceTest.calls.picks), []);
    await man.click();
    assert.equal(await woman.getAttribute("aria-pressed"), "false");
    assert.equal(await man.getAttribute("aria-pressed"), "true");
    assert.deepEqual(await page.evaluate(() => window.choiceTest.calls.picks), []);
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1);
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height + 1);
    await next.scrollIntoViewIfNeeded();
    const actionBounds = await next.boundingBox();
    assert.ok(actionBounds.width >= 100 && actionBounds.height >= 40);
    assert.ok(actionBounds.y >= 0 && actionBounds.y + actionBounds.height <= viewport.height + 1);
    await page.screenshot({ path: path.join(output, `${name}.png`) });
    await next.focus();
    await page.keyboard.press("Enter");
    assert.deepEqual(await page.evaluate(() => window.choiceTest.calls.picks), ["male"]);
    assert.equal(await page.evaluate(() => window.choiceTest.calls.escapedKeys), 0,
      "reference dialog Enter must not advance an underlying landmark review");
    assert.equal(await page.evaluate(() => window.choiceTest.liveUrls.size), 0);

    // A cancelled choice must not become the next photo's default.
    await open();
    await woman.click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await page.evaluate(() => window.choiceTest.calls.cancelled), 1);
    assert.equal(await page.evaluate(() => window.choiceTest.liveUrls.size), 0);
    await open();
    assert.equal(await next.isDisabled(), true);
    assert.equal(await page.locator('.sexpick-side[aria-pressed="true"]').count(), 0);
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => window.choiceTest.calls.cancelled), 2);

    // External reset/replacement must silence detached buttons and listeners.
    await open();
    await man.click();
    await page.evaluate(() => {
      const stale = document.querySelector('.sexpick-continue');
      window.choiceTest.close(); window.choiceTest.open(); stale.click();
    });
    assert.deepEqual(await page.evaluate(() => window.choiceTest.calls.picks), ["male"]);
    assert.equal(await page.locator(".sexpick").count(), 1);
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => window.choiceTest.calls.cancelled), 3);
    assert.equal(await page.evaluate(() => window.choiceTest.liveUrls.size), 0);

    // Existing one-tap callers still work, once only, without a photo.
    await page.evaluate(() => window.choiceTest.openSexChooser(sex => window.choiceTest.calls.picks.push(sex)));
    await woman.click();
    assert.deepEqual(await page.evaluate(() => window.choiceTest.calls.picks), ["male", "female"]);
    assert.equal(await page.locator(".sexpick").count(), 0);

    await page.evaluate(() => {
      const t = window.choiceTest;
      const open = () => t.openSubjectChooser(answer => t.calls.subjectPicks.push(answer), () => t.calls.subjectCancelled++);
      open(); const old = document.querySelector('[data-who="me"]');
      t.closeSubjectChooser(); open(); old.click();
    });
    assert.deepEqual(await page.evaluate(() => window.choiceTest.calls.subjectPicks), []);
    assert.equal(await page.locator(".subjpick").count(), 1);
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => window.choiceTest.calls.subjectCancelled), 1);
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => window.choiceTest.calls.subjectCancelled), 1);

    await page.evaluate(() => {
      const t = window.choiceTest;
      t.openSexChooser(sex => t.calls.picks.push(sex), undefined, undefined, undefined,
        {photo: new Blob(['not an image'], {type:'image/jpeg'}), confirm:true});
    });
    await page.locator(".sexpick-preview-error").waitFor({ state: "visible" });
    await man.click();
    assert.equal(await next.isDisabled(), true);
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => window.choiceTest.liveUrls.size), 0);
    await page.close();
    console.log(`${name}: local photo, editable choice, confirmation, cancel/retry, stale callbacks, keyboard isolation and cleanup passed`);
  }
  assert.deepEqual(errors, []);
  console.log(`Screenshots: ${output}`);
} finally {
  await browser.close();
  await server.close();
}
