// Local capture UX regression: synthetic public photos, fresh browser storage,
// no signed-in user, API requests, calibration writes or external uploads.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { launchChromium } from "./launchChromium.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const photo = fileURLToPath(new URL("../public/tutorial/front-do.jpg", import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), "truemax-capture-review-"));
const server = await createServer({ root, server: { host: "127.0.0.1", port: 0, hmr: false } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await launchChromium({ headless: true });

try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 850 });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.setDefaultTimeout(25_000);
    await page.route("**/*", route => {
      const url = route.request().url();
      return url.startsWith(origin) && !url.startsWith(`${origin}/api/`) ? route.continue() : route.abort();
    });

    for (const input of ["upload", "paste"]) {
      await page.goto(origin);
      await page.locator("#btn-upload").waitFor();
      if (input === "upload") {
        const picked = page.waitForEvent("filechooser");
        await page.locator("#btn-upload").click();
        await page.locator(".tut-ask").getByRole("button", { name: "Skip", exact: true }).click();
        await (await picked).setFiles(photo);
      } else {
        await page.evaluate(async () => {
          const blob = await (await fetch("/tutorial/front-do.jpg")).blob();
          const transfer = new DataTransfer();
          transfer.items.add(new File([blob], "synthetic-front.jpg", { type: "image/jpeg" }));
          document.body.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: transfer }));
        });
      }
      await page.locator(".sexpick-continue").waitFor();
      assert.equal(await page.locator('.sexpick-side[aria-pressed="true"]').count(), 0);
      await page.locator('.sexpick-side[data-sex="male"]').click();
      await page.locator(".sexpick-continue").click();
      await page.getByRole("heading", { name: "Add a side photo?", exact: true }).waitFor();
      assert.equal(await page.getByRole("heading", { name: "Happy with this front photo?", exact: true }).count(), 0);
      assert.equal(await page.getByRole("button", { name: "Use this photo", exact: true }).count(), 0);
      assert.equal(await page.getByRole("button", { name: "Use front only", exact: true }).isVisible(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: join(artifacts, `${width}-${input}-side-invitation.png`) });
    }

    // Mount the actual side-review controls with a labelled, local geometry
    // fixture. This checks the controls, not automatic detection accuracy.
    await page.goto(origin);
    await page.locator("#btn-upload").waitFor();
    await page.evaluate(async () => {
      const { openSideAdjust } = await import("/src/ui/sideFlow.ts");
      const { seedSideTemplate } = await import("/src/ui/sideVerify.ts");
      const image = new Image(); image.src = "/side-guide/reference.jpg"; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = 800; canvas.height = 800;
      canvas.getContext("2d").drawImage(image, 0, 0, 800, 800);
      document.querySelector("#v-upload").classList.add("hidden");
      openSideAdjust(canvas, seedSideTemplate(800, 800), {
        scanId: crypto.randomUUID(), sex: "male", reviewMode: "calibration", onDone() {}, onBack() {},
      });
    });
    const choice = page.locator(".side-direction-choice");
    await choice.waitFor();
    assert.match(await choice.innerText(), /Which way does the nose face\?/);
    assert.match(await choice.innerText(), /If the highlighted choice matches, leave it selected/);
    const left = choice.getByRole("button", { name: "Nose faces left", exact: true });
    const right = choice.getByRole("button", { name: "Nose faces right", exact: true });
    assert.equal(await right.getAttribute("aria-pressed"), "true");
    const originalPhoto = await page.locator("#side-canvas").evaluate(canvas => canvas.toDataURL());
    await page.locator("#side-calibration-reviewed").check();
    await left.click();
    assert.equal(await left.getAttribute("aria-pressed"), "true");
    assert.equal(await right.getAttribute("aria-pressed"), "false");
    assert.equal(await page.locator("#side-calibration-reviewed").isChecked(), false);
    assert.equal(await page.locator("#side-canvas").evaluate(canvas => canvas.toDataURL()), originalPhoto,
      "changing the point direction must not mirror the displayed photo");
    await right.click();
    assert.equal(await right.getAttribute("aria-pressed"), "true");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await choice.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(artifacts, `${width}-nose-direction.png`) });
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`${width}px: upload/paste skip redundant acceptance; reference selection and optional side stay intact; nose-direction default, switching and review reset passed`);
  }
  console.log(`Screenshots: ${artifacts}`);
} finally {
  await browser.close();
  await server.close();
}
