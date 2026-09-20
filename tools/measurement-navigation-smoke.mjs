// Real report → detail navigation with labelled synthetic geometry. Portraits
// use existing, bounded public thumbnails; no account or scan data is uploaded.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchChromium } from "./launchChromium.mjs";

const origin = process.argv[2] ?? "http://127.0.0.1:4189";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw new Error("Use a local dev server.");
const artifacts = await mkdtemp(join(tmpdir(), "truemax-navigation-"));
const browser = await launchChromium({ headless: true });
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, hasTouch: viewport.width < 850 });
    const settleDetail = () => page.locator(".mdx-overlay").evaluate(async element => {
      await Promise.all(element.getAnimations({ subtree: true })
        .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => {})));
    });
    page.setDefaultTimeout(12_000);
    await page.routeWebSocket("**/*", () => {});
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      return (url.origin === new URL(origin).origin && !url.pathname.startsWith("/api/")) || url.hostname === "thumb.wikimedia.org"
        ? route.continue() : route.abort();
    });
    await page.goto(origin);
    await page.locator("#btn-upload").waitFor();
    await page.evaluate(async () => {
      localStorage.setItem("truemax.scalePrimerSeen", "1");
      const { renderResults, setDepth } = await import("/src/ui/results.ts");
      const { analyzeSide, scoreFrontMeasurements, mergeReports } = await import("/src/engine/scoring.ts");
      const { CELEBS } = await import("/src/engine/celebs.ts");
      const { measurementDeck } = await import("/src/ui/metricDetail.ts");
      const photo = color => {
        const canvas = document.createElement("canvas"); canvas.width = 240; canvas.height = 360;
        const ctx = canvas.getContext("2d"); ctx.fillStyle = color; ctx.fillRect(0, 0, 240, 360);
        return canvas;
      };
      const sidePoints = {
        trichion: { x: 120, y: 50 }, glabella: { x: 130, y: 90 }, nasion: { x: 128, y: 110 },
        pronasale: { x: 180, y: 160 }, subnasale: { x: 150, y: 190 },
        // Nose ray -45 degrees, upper-lip ray 54.3: a measured 99.3-degree angle.
        labialeSuperius: { x: 150 + 25 * Math.cos(54.3 * Math.PI / 180), y: 190 + 25 * Math.sin(54.3 * Math.PI / 180) },
        labialeInferius: { x: 153, y: 245 }, pogonion: { x: 160, y: 290 }, menton: { x: 145, y: 320 },
        gonion: { x: 70, y: 285 }, condylion: { x: 72, y: 155 }, cervicale: { x: 90, y: 330 }, tragion: { x: 65, y: 170 },
      };
      const front = scoreFrontMeasurements(CELEBS.find(celeb => celeb.name === "Henry Cavill").metrics, "male");
      const sideReport = analyzeSide(sidePoints, 1, "male");
      const report = mergeReports(front, sideReport);
      const landmarks = Array.from({ length: 478 }, (_, i) => ({ x: .5 + .25 * Math.cos(i * .17), y: .5 + .25 * Math.sin(i * .17), z: 0 }));
      for (const section of document.querySelectorAll("body > section")) section.classList.add("hidden");
      document.querySelector("#v-main").classList.remove("hidden");
      document.querySelector("#capRight").textContent = "SYNTHETIC UI TEST";
      const options = { report, delta: null, landmarks, photoW: 240, photoH: 360,
        analysis: document.querySelector("#analysis"), zoomable: document.querySelector("#zoomable"),
        overlay: document.querySelector("#overlay-canvas"), onNewPhoto: () => {},
        frontPhoto: photo("#304b55"), sidePhoto: photo("#554731"), sideReport, sidePoints,
        sideVerified: true, archived: true, archivedDate: "2026-09-20T00:00:00Z" };
      setDepth("depth"); renderResults(options);
      window.navigationFixture = { options, deck: measurementDeck(sideReport.regions, "side"), all: measurementDeck(report.regions), snapshot: JSON.stringify(report) };
    });
    const viewButton = view => page.locator(viewport.width < 850 ? `.mobile-score-summary [data-summary-view="${view}"]` : `.vt-btn[data-view="${view}"]`);
    await viewButton("side").click();
    const deck = await page.evaluate(() => window.navigationFixture.deck.map(m => ({ id: m.def.id, name: m.def.name, region: m.def.region })));
    assert.ok(deck.length > 5);
    const boundary = deck.findIndex((m, index) => deck[index + 1]?.region && deck[index + 1].region !== m.region);
    assert.ok(boundary >= 0);
    await page.locator(`.rtab[data-id="side:${deck[boundary].region}"]`).click();
    const row = page.locator(`[data-side-metric="${deck[boundary].id}"]`);
    if (viewport.width < 850) {
      await row.tap();
      assert.equal(await page.locator(".mdx-overlay").count(), 0);
      await row.tap();
    } else { await row.focus(); await page.keyboard.press("Enter"); }
    await page.locator(".mdx-title").waitFor();
    assert.equal(await page.locator(".mdx-count").innerText(), `${boundary + 1} / ${deck.length}`);
    await page.locator(".mdx-next").click();
    assert.equal(await page.locator(".mdx-title").innerText(), deck[boundary + 1].name);
    await page.keyboard.press("ArrowLeft");
    assert.equal(await page.locator(".mdx-title").innerText(), deck[boundary].name);
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => !document.querySelector(".mdx-stage").classList.contains("swap"));
    const sidePixel = await page.locator(".mdx-photo").evaluate(canvas => [...canvas.getContext("2d").getImageData(0, 0, 1, 1).data]);
    assert.deepEqual(sidePixel, [85, 71, 49, 255]);
    await settleDetail();
    await page.screenshot({ path: join(artifacts, `${viewport.width}-side-next-region.png`) });
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".mdx-overlay").count(), 0);
    assert.equal(await row.evaluate(element => document.activeElement === element), true);

    await page.locator('.rtab[data-id="side:nose"]').click();
    const fitRow = page.locator('[data-side-metric="nasolabialAngle"]');
    assert.match(await fitRow.innerText(), /99\.3°[\s\S]*Within range/);
    await fitRow.focus(); await page.keyboard.press("Enter");
    assert.equal(await page.locator(".mdx-value").innerText(), "99.3°");
    assert.equal(await page.locator(".mdx-fit").innerText(), "Within model reference range");
    assert.equal(await page.locator(".mdx-score").innerText(), "Model score 5.0 / 10");
    assert.equal(await page.locator(".mdx-stage").getAttribute("data-fit"), "within");
    assert.equal(await page.locator(".mdx-stage.tone-mid, .mdx-stage.tone-lo").count(), 0);
    assert.match(await page.locator(".mdx-tabbody").innerText(), /This profile reference is provisional/);
    assert.doesNotMatch(await page.locator(".mdx-tabbody").innerText(), /Modelled standing|reference distribution/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await settleDetail();
    await page.screenshot({ path: join(artifacts, `${viewport.width}-reference-fit.png`) });
    await page.keyboard.press("Escape");

    await viewButton("front").click();
    await page.locator('.rtab[data-id="eyes"]').click();
    await page.locator('[data-metric="canthalTilt"]').focus(); await page.keyboard.press("Enter");
    const total = await page.evaluate(() => window.navigationFixture.all.length);
    assert.ok((await page.locator(".mdx-count").innerText()).endsWith(`/ ${total}`));
    await page.getByRole("button", { name: "Celebrities", exact: true }).click();
    const portraits = page.locator(".mdx-celeb .portrait-figure img");
    await portraits.first().waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll(".portrait-figure img")].every(image => image.complete));
    const loaded = await portraits.evaluateAll(images => images.map(image => ({ src: image.src, width: image.naturalWidth, box: image.getBoundingClientRect().width, hidden: image.hidden })));
    assert.ok(loaded.some(image => image.width > 0 && !image.hidden), "At least one public reference portrait must load live");
    assert.ok(loaded.every(image => image.box >= 80), "Comparison portraits should be readable, not tiny avatar dots");
    assert.match(await page.locator(".mdx-tabbody").innerText(), /Your reading/);
    assert.match(await page.locator(".mdx-tabbody").innerText(), /may differ from the photos measured/);
    await settleDetail();
    await page.screenshot({ path: join(artifacts, `${viewport.width}-reference-portraits.png`) });
    await portraits.first().evaluate(image => image.dispatchEvent(new Event("error")));
    assert.equal(await page.locator(".portrait-unavailable").first().isVisible(), true);
    await page.locator(".mdx-close").focus(); await page.keyboard.press("Shift+Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), "SUMMARY");
    await page.keyboard.press("Tab");
    assert.equal(await page.locator(".mdx-close").evaluate(button => document.activeElement === button), true);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator(".mdx-stage.swap").count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.evaluate(() => JSON.stringify(window.navigationFixture.options.report) === window.navigationFixture.snapshot), true, "Viewing fit does not mutate report scores");
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ viewport, sideMeasurements: deck.length, allMeasurements: total, portraits: loaded, errors }));
    await page.close();
  }
} finally { await browser.close(); }
console.log(`Screenshots: ${artifacts}`);
