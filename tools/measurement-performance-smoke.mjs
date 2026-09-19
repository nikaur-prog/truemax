// Real rendering/navigation smoke test. Geometry is a labelled synthetic test
// fixture, not a calibration subject. No account, cloud inference or writes.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchChromium } from "./launchChromium.mjs";

const origin = process.argv[2] ?? "http://127.0.0.1:4189";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw new Error("Use a local dev server.");
const artifacts = await mkdtemp(join(tmpdir(), "truemax-measurement-review-"));
const browser = await launchChromium({ headless: true });
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.origin === new URL(origin).origin ? route.continue() : route.abort();
    });
    await page.goto(`${origin}/tools/cmpcheck.html`);
    await page.evaluate(async () => {
      const { openMetricDetail, closeMetricDetail } = await import("/src/ui/metricDetail.ts");
      const { analyzeSide, scoreFrontMeasurements } = await import("/src/engine/scoring.ts");
      const { METRICS } = await import("/src/engine/metrics.ts");
      const { readMeasurementPerformance, clearMeasurementPerformance } = await import("/src/engine/measurementPerformance.ts");
      const sidePoints = {
        trichion: { x: 120, y: 50 }, glabella: { x: 130, y: 90 }, nasion: { x: 128, y: 110 },
        pronasale: { x: 180, y: 160 }, subnasale: { x: 150, y: 190 }, labialeSuperius: { x: 155, y: 215 },
        labialeInferius: { x: 153, y: 245 }, pogonion: { x: 160, y: 290 }, menton: { x: 145, y: 320 },
        gonion: { x: 70, y: 285 }, condylion: { x: 72, y: 155 }, cervicale: { x: 90, y: 330 }, tragion: { x: 65, y: 170 },
      };
      const canvas = (width, height, label) => {
        const c = document.createElement("canvas"); c.width = width; c.height = height;
        const ctx = c.getContext("2d"); ctx.fillStyle = "#314951"; ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = "white"; ctx.font = `${width / 23}px system-ui`; ctx.fillText(label, width / 10, height / 2);
        return c;
      };
      const frontPhoto = canvas(1440, 2160, "FRONT TEST FIXTURE");
      const sidePhoto = canvas(240, 360, "SIDE FIXTURE");
      const landmarks = Array.from({ length: 478 }, (_, i) => ({ x: .5 + .25 * Math.cos(i * .17), y: .5 + .25 * Math.sin(i * .17), z: 0 }));
      const front = scoreFrontMeasurements(Object.fromEntries(METRICS.map((def) => [def.id, def.dist.male.mean])), "male");
      const side = analyzeSide(sidePoints, 1, "male");
      const options = {
        region: "jaw", deckLabel: "Rendering test", metrics: [front.metrics.find((m) => m.def.id === "fwhr"), side.metrics.find((m) => m.def.id === "gonialAngle")],
        index: 0, sex: "male", landmarks, frontPhoto, sidePhoto, sidePoints,
      };
      window.reviewFixture = { options, openMetricDetail, closeMetricDetail, readMeasurementPerformance, clearMeasurementPerformance };
      openMetricDetail(options);
    });
    await page.waitForFunction(() => document.querySelector(".mdx-photo")?.width > 0 && !document.querySelector(".mdx-stage")?.classList.contains("swap"));
    const before = await page.evaluate(() => ({ source: [window.reviewFixture.options.frontPhoto.width, window.reviewFixture.options.frontPhoto.height], display: [document.querySelector(".mdx-photo").width, document.querySelector(".mdx-photo").height] }));
    assert.ok(before.display[1] <= before.source[1]);
    await page.evaluate(async () => {
      window.reviewFixture.clearMeasurementPerformance();
      for (let i = 0; i < 30; i++) {
        document.querySelector(".mdx-next").click();
        await new Promise((resolve) => setTimeout(resolve, 35));
        document.querySelector(".mdx-prev").click();
        await new Promise((resolve) => setTimeout(resolve, 35));
        if (document.querySelector(".mdx-stage").classList.contains("swap")) throw new Error("Rapid reversal left the stage hidden");
      }
    });
    await page.waitForFunction(() => window.reviewFixture.readMeasurementPerformance().samples.at(-1)?.outcome === "completed");
    await page.screenshot({ path: join(artifacts, `${viewport.width}-front.png`) });
    const state = await page.evaluate(() => ({
      opacity: getComputedStyle(document.querySelector(".mdx-stage")).opacity,
      title: document.querySelector(".mdx-title").textContent,
      overflow: document.documentElement.scrollWidth > innerWidth,
      source: [window.reviewFixture.options.frontPhoto.width, window.reviewFixture.options.frontPhoto.height],
      performance: window.reviewFixture.readMeasurementPerformance(),
    }));
    assert.equal(state.opacity, "1"); assert.equal(state.overflow, false); assert.deepEqual(state.source, before.source);
    assert.equal(state.performance.counts.errors, 0);
    assert.equal(state.performance.samples.at(-1).outcome, "completed", "the final interaction must settle after rapid reversals");
    await page.evaluate(() => {
      const { options, openMetricDetail } = window.reviewFixture;
      openMetricDetail({ ...options, frontPhoto: null, landmarks: null });
    });
    assert.equal(await page.locator(".mdx-unavailable").isVisible(), true);
    assert.match(await page.locator(".mdx-unavailable").innerText(), /front/i);
    await page.locator(".mdx-next").click();
    await page.waitForFunction(() => !document.querySelector(".mdx-stage").classList.contains("mdx-nostage") && !document.querySelector(".mdx-stage").classList.contains("swap"));
    await page.screenshot({ path: join(artifacts, `${viewport.width}-side.png`) });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => window.reviewFixture.openMetricDetail(window.reviewFixture.options));
    assert.equal(await page.locator(".mdx-stage.swap").count(), 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ viewport, raster: before, state, errors }));
    await page.close();
  }
} finally { await browser.close(); }
console.log(`Screenshots: ${artifacts}`);
