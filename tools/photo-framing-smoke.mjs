// Local synthetic-photo results test. No private images, account state or APIs.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchChromium } from "./launchChromium.mjs";

const origin = process.argv[2] ?? "http://127.0.0.1:4193";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw new Error("Use a local dev server.");
const artifacts = await mkdtemp(join(tmpdir(), "truemax-photo-framing-"));
const browser = await launchChromium({ headless: true });
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 375, height: 667 }, { width: 1440, height: 1000 }]) {
    const page = await browser.newPage({ viewport, hasTouch: viewport.width < 850, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      return url.origin === new URL(origin).origin && !url.pathname.startsWith("/api/") ? route.continue() : route.abort();
    });
    await page.goto(origin);
    await page.locator("#btn-upload").waitFor();
    await page.evaluate(async () => {
      localStorage.setItem("truemax.scalePrimerSeen", "1");
      const { renderResults, setDepth } = await import("/src/ui/results.ts");
      const { initLandmarker, detect } = await import("/src/engine/landmarker.ts");
      const { analyze, analyzeSide, mergeReports } = await import("/src/engine/scoring.ts");
      const { GUIDE_POINTS } = await import("/src/ui/sideGuidePhoto.ts");
      const load = async src => { const image = new Image(); image.src = src; await image.decode(); return image; };
      const frontImage = await load("/tutorial/front-do.jpg");
      await initLandmarker();
      const detected = detect(frontImage).faceLandmarks[0];
      if (!detected?.length) throw new Error("Synthetic front fixture did not detect");
      // Deliberately distant face, like the mobile report regression. Keep
      // known landmarks registered to the public fixture's placed pixels.
      const frontPhoto = document.createElement("canvas"); frontPhoto.width = 720; frontPhoto.height = 1280;
      const drawing = frontPhoto.getContext("2d"); drawing.fillStyle = "#d2ccc5"; drawing.fillRect(0, 0, 720, 1280);
      drawing.drawImage(frontImage, 110, 160, 500, 666.6666667);
      const landmarks = detected.map(p => ({ x: (110 + p.x * 500) / 720, y: (160 + p.y * 666.6666667) / 1280, z: p.z * 500 / 720 }));
      const sideImage = await load("/side-guide/reference.jpg");
      const sidePhoto = document.createElement("canvas"); sidePhoto.width = sideImage.width; sidePhoto.height = sideImage.height;
      sidePhoto.getContext("2d").drawImage(sideImage, 0, 0);
      const sidePoints = Object.fromEntries(Object.entries(GUIDE_POINTS).map(([id, [x, y]]) => [id, { x: x * sidePhoto.width, y: y * sidePhoto.height }]));
      const front = analyze(landmarks, 720, 1280, "male");
      const sideReport = analyzeSide(sidePoints, 1, "male");
      const report = mergeReports(front, sideReport);
      for (const section of document.querySelectorAll("body > section")) section.classList.add("hidden");
      document.querySelector("#v-main").classList.remove("hidden");
      document.querySelector("#capRight").textContent = "SYNTHETIC DISPLAY TEST";
      const options = { report, delta: null, landmarks, photoW: 720, photoH: 1280,
        analysis: document.querySelector("#analysis"), zoomable: document.querySelector("#zoomable"),
        overlay: document.querySelector("#overlay-canvas"), onNewPhoto: () => {},
        frontPhoto, sidePhoto, sideReport, sidePoints, sideVerified: true, archived: true };
      window.photoFixture = { options, snapshot: JSON.stringify({ report, landmarks, sidePoints }), frontPixels: frontPhoto.toDataURL(), sidePixels: sidePhoto.toDataURL() };
      setDepth("depth"); renderResults(options);
    });
    const inspect = async () => {
      await page.locator("#zoomable").evaluate(async el => {
        await Promise.all(el.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity)
          .map(animation => animation.finished.catch(() => {})));
      });
      return page.evaluate(() => {
      const photo = document.querySelector("#photo-canvas");
      const overlay = document.querySelector("#overlay-canvas");
      const frame = document.querySelector("#frame").getBoundingClientRect();
      const zoomable = document.querySelector("#zoomable");
      const transform = new DOMMatrix(getComputedStyle(zoomable).transform);
      const sameBox = Math.abs(photo.getBoundingClientRect().width - overlay.getBoundingClientRect().width) < .1 &&
        Math.abs(photo.getBoundingClientRect().height - overlay.getBoundingClientRect().height) < .1;
      return { height: frame.height, width: frame.width, scale: transform.a, sameBox,
        transform: zoomable.style.transform, overflow: document.documentElement.scrollWidth > innerWidth,
        photoRatio: photo.width / photo.height, overlayRatio: overlay.width / overlay.height };
      });
    };
    await page.waitForFunction(() => document.querySelector("#zoomable").style.transform.includes("scale"));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const front = await inspect();
    assert.equal(front.sameBox, true);
    assert.equal(front.overflow, false);
    assert.ok(Math.abs(front.photoRatio - front.overlayRatio) < .003);
    if (viewport.width < 850) {
      assert.ok(front.height >= 240 && front.height <= 340);
      assert.ok(front.scale > 1.5, "Distant face should enlarge automatically");
    } else assert.equal(front.scale, 1, "Desktop overview remains unchanged");
    await page.screenshot({ path: join(artifacts, `${viewport.width}-front.png`) });
    await page.locator('.rtab[data-id="eyes"]').click();
    const region = await inspect();
    if (viewport.width < 850) assert.equal(region.transform, front.transform, "Mobile tabs must not pump the zoom");
    else assert.ok(region.scale > 1, "Desktop retains region zoom");
    const viewButton = view => page.locator(viewport.width < 850 ? `.mobile-score-summary [data-summary-view="${view}"]` : `.vt-btn[data-view="${view}"]`);
    await viewButton("side").click();
    const side = await inspect();
    assert.equal(side.sameBox, true);
    assert.ok(Math.abs(side.photoRatio - side.overlayRatio) < .003);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(artifacts, `${viewport.width}-side.png`) });
    await viewButton("front").click();
    if (viewport.width < 850) {
      await page.setViewportSize({ width: 844, height: 390 });
      await page.waitForFunction(() => document.querySelector("#frame").clientHeight === 190);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const rotated = await inspect();
      assert.equal(rotated.sameBox, true); assert.equal(rotated.overflow, false);
      assert.equal(await page.locator(".pane-photo").evaluate(el => getComputedStyle(el).position), "static",
        "Landscape photo should scroll away to leave reading room");
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.waitForFunction(() => new DOMMatrix(getComputedStyle(document.querySelector("#zoomable")).transform).a === 1);
      assert.equal((await inspect()).scale, 1, "Resizing to desktop removes mobile fit");
      await page.setViewportSize(viewport);
    }
    assert.equal(await page.evaluate(() => {
      const f = window.photoFixture;
      return f.snapshot === JSON.stringify({ report: f.options.report, landmarks: f.options.landmarks, sidePoints: f.options.sidePoints }) &&
        f.frontPixels === f.options.frontPhoto.toDataURL() && f.sidePixels === f.options.sidePhoto.toDataURL();
    }), true, "Framing must not change retained photos, measurements, landmarks or scores");
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ viewport, front, side, errors }));
    await page.close();
  }
  console.log(`Screenshots: ${artifacts}`);
} finally { await browser.close(); }
