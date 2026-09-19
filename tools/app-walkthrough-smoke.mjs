// Local UI walkthrough. The report/capture geometry is a labelled synthetic
// fixture, not a face or an accuracy benchmark. No APIs or remote uploads.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchChromium } from "./launchChromium.mjs";

const origin = process.argv[2] ?? "http://127.0.0.1:4189";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw new Error("Use a local dev server.");
const artifacts = await mkdtemp(join(tmpdir(), "truemax-app-review-"));
console.log(`Screenshots: ${artifacts}`);
const browser = await launchChromium({ headless: true });
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2, hasTouch: viewport.width < 850 });
    page.setDefaultTimeout(10_000);
    // The worktree is shared with other reviewers. Keep Vite HMR messages from
    // reloading this one fixture halfway through an interaction sequence.
    await page.routeWebSocket("**/*", () => {});
    const errors = [];
    const blocked = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === new URL(origin).origin && !url.pathname.startsWith("/api/")) return route.continue();
      blocked.push(`${route.request().method()} ${url.origin}${url.pathname}`);
      return route.abort();
    });
    await page.goto(origin);
    await page.locator("#btn-upload").waitFor();
    await page.screenshot({ path: join(artifacts, `${viewport.width}-landing.png`) });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole("button", { name: "Create a TrueMax account", exact: true }).click();
    await page.locator(".acct-form-col input[type=email]").waitFor();
    const signup = await page.locator(".acct-form-col").innerText();
    assert.doesNotMatch(signup, /height|weight|first name/i);
    assert.equal(await page.locator(".acct-form-col input[type=password]").count(), 1);
    await page.screenshot({ path: join(artifacts, `${viewport.width}-signup.png`) });
    await page.locator(".acct-overlay .hist-close").click();
    await page.locator("#btn-upload").click();
    await page.locator(".tut-ask").waitFor();
    // A reference choice now belongs to an actual selected photo. The front
    // tutorial still comes first; do not choose a reference before the file.
    assert.equal(await page.locator(".sexpick").count(), 0);
    assert.match(await page.locator(".tut-ask").innerText(), /front photo/i);
    assert.equal(await page.locator('.tut-ask img[src*="side-"]').count(), 0);
    await page.screenshot({ path: join(artifacts, `${viewport.width}-front-guide.png`) });
    // Stop before file selection/detection. The next section mounts the real
    // report component on the app's real layout using synthetic local input.
    await page.reload();
    await page.evaluate(async () => {
      localStorage.setItem("truemax.scalePrimerSeen", "1");
      const { renderResults, setDepth, clearResultPhotoRecovery } = await import("/src/ui/results.ts");
      const { analyzeSide, scoreFrontMeasurements, mergeReports } = await import("/src/engine/scoring.ts");
      const { METRICS } = await import("/src/engine/metrics.ts");
      const photo = (label, color) => {
        const c = document.createElement("canvas"); c.width = 1440; c.height = 2160;
        const g = c.getContext("2d"); g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = "white"; g.font = "56px system-ui"; g.fillText(label, 100, 180);
        g.strokeStyle = "#dce5df"; g.lineWidth = 12; g.beginPath(); g.ellipse(720, 1080, 400, 700, 0, 0, Math.PI * 2); g.stroke();
        return c;
      };
      const frontPhoto = photo("SYNTHETIC FRONT UI FIXTURE", "#304b55");
      const sidePhoto = photo("SYNTHETIC SIDE UI FIXTURE", "#554731");
      const sideBase = {
        trichion: { x: 120, y: 50 }, glabella: { x: 130, y: 90 }, nasion: { x: 128, y: 110 },
        pronasale: { x: 180, y: 160 }, subnasale: { x: 150, y: 190 }, labialeSuperius: { x: 155, y: 215 },
        labialeInferius: { x: 153, y: 245 }, pogonion: { x: 160, y: 290 }, menton: { x: 145, y: 320 },
        gonion: { x: 70, y: 285 }, condylion: { x: 72, y: 155 }, cervicale: { x: 90, y: 330 }, tragion: { x: 65, y: 170 },
      };
      const sidePoints = Object.fromEntries(Object.entries(sideBase).map(([k, p]) => [k, { x: p.x * 6, y: p.y * 6 }]));
      const landmarks = Array.from({ length: 478 }, (_, i) => ({ x: .5 + .25 * Math.cos(i * .17), y: .5 + .25 * Math.sin(i * .17), z: 0 }));
      const frontReport = scoreFrontMeasurements(Object.fromEntries(METRICS.map((def) => [def.id, def.dist.male.mean])), "male");
      const sideReport = analyzeSide(sidePoints, 1, "male");
      const report = mergeReports(frontReport, sideReport);
      for (const section of document.querySelectorAll("body > section")) section.classList.add("hidden");
      document.querySelector("#v-upload").classList.add("hidden");
      document.querySelector("#v-main").classList.remove("hidden");
      document.querySelector("#capRight").textContent = "SYNTHETIC UI TEST";
      document.querySelector("#status").textContent = "Interface fixture only. No face was scanned.";
      const options = { report, delta: null, landmarks, photoW: frontPhoto.width, photoH: frontPhoto.height,
        analysis: document.querySelector("#analysis"), zoomable: document.querySelector("#zoomable"),
        overlay: document.querySelector("#overlay-canvas"), onNewPhoto: () => {}, frontPhoto, sidePhoto,
        sideReport, sidePoints, sideVerified: true, archived: true, archivedDate: "2026-09-10T00:00:00Z" };
      setDepth("depth");
      renderResults(options);
      window.appReview = { options, renderResults, clearResultPhotoRecovery, originalPoints: JSON.stringify(sidePoints) };
    });
    await page.locator('.rtab[data-id="jaw"]').waitFor();
    await page.locator('.rtab[data-id="jaw"]').click();
    await page.waitForTimeout(400);
    const raster = await page.evaluate(() => ({
      source: [window.appReview.options.frontPhoto.width, window.appReview.options.frontPhoto.height],
      photo: [document.querySelector("#photo-canvas").width, document.querySelector("#photo-canvas").height],
      overlay: [document.querySelector("#overlay-canvas").width, document.querySelector("#overlay-canvas").height],
      css: [document.querySelector("#overlay-canvas").clientWidth, document.querySelector("#overlay-canvas").clientHeight],
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    await page.screenshot({ path: join(artifacts, `${viewport.width}-report-jaw.png`) });
    console.log(JSON.stringify({ viewport, raster, errors, blocked }));
    assert.equal(raster.overflow, false);
    assert.ok(raster.overlay[0] < raster.source[0], "Report overlay should use display pixels, not full capture pixels");

    // Rapid tab/hover reversals run the real cancellation and view-switch code.
    await page.evaluate(async () => {
      const delay = () => new Promise((resolve) => setTimeout(resolve, 25));
      for (let i = 0; i < 18; i++) {
        document.querySelector(`.rtab[data-id="${i % 2 ? "jaw" : "eyes"}"]`).click();
        const rows = [...document.querySelectorAll(".metric[data-metric]")];
        for (const row of rows.slice(0, 4)) {
          row.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }));
          await delay();
          row.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
        }
      }
      document.querySelector('.rtab[data-id="jaw"]').click();
      const side = document.querySelector('.metric[data-metric="gonialAngle"]');
      if (!side) throw new Error("Merged report has no gonial measurement row");
      side.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }));
    });
    await page.waitForTimeout(350);
    const sideState = await page.evaluate(() => ({
      caption: document.querySelector(".photo-caption span").textContent,
      raster: [document.querySelector("#overlay-canvas").width, document.querySelector("#overlay-canvas").height],
      source: [window.appReview.options.sidePhoto.width, window.appReview.options.sidePhoto.height],
      photoPixel: [...document.querySelector("#photo-canvas").getContext("2d").getImageData(5, 5, 1, 1).data],
      pointsIntact: JSON.stringify(window.appReview.options.sidePoints) === window.appReview.originalPoints,
    }));
    assert.equal(sideState.caption, "SIDE");
    assert.deepEqual(sideState.photoPixel, [85, 71, 49, 255]);
    assert.equal(sideState.pointsIntact, true);
    assert.ok(sideState.raster[0] < sideState.source[0]);
    await page.screenshot({ path: join(artifacts, `${viewport.width}-report-side-hover.png`) });
    await page.evaluate(() => {
      document.querySelector('.metric[data-metric="jawCheekRatio"]').dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }));
    });
    await page.waitForTimeout(350);
    assert.equal(await page.locator("#v-main .photo-caption span").innerText(), "FRONT");
    assert.deepEqual(await page.locator("#photo-canvas").evaluate((canvas) => [...canvas.getContext("2d").getImageData(5, 5, 1, 1).data]), [48, 75, 85, 255]);
    assert.deepEqual(await page.evaluate(() => [window.appReview.options.frontPhoto.width, window.appReview.options.frontPhoto.height]), [1440, 2160]);
    // Touch uses preview on the first tap, then details; keyboard opens directly.
    const row = page.locator('.metric[data-metric="jawCheekRatio"]');
    if (viewport.width < 850) {
      await row.tap();
      assert.equal(await page.locator(".mdx-overlay").count(), 0);
      await row.tap();
    } else {
      await row.focus();
      await page.keyboard.press("Enter");
    }
    await page.locator(".mdx-title").waitFor();
    await page.screenshot({ path: join(artifacts, `${viewport.width}-metric-detail.png`) });
    await page.keyboard.press("Escape");
    if (viewport.width < 850) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(300);
      const pinned = await page.evaluate(() => {
        const photo = document.querySelector(".pane-photo").getBoundingClientRect();
        const rail = document.querySelector(".rtabs-rail").getBoundingClientRect();
        return { photoTop: photo.top, photoBottom: photo.bottom, railTop: rail.top, railBottom: rail.bottom, viewport: innerHeight };
      });
      assert.ok(pinned.photoTop >= 0 && pinned.photoBottom < pinned.viewport);
      assert.ok(pinned.railTop >= pinned.photoBottom - 2 && pinned.railBottom < pinned.viewport);
      await page.screenshot({ path: join(artifacts, `${viewport.width}-report-pinned-bottom.png`) });
      console.log(JSON.stringify({ viewport, pinned }));
    }

    // The capture/review components receive the same synthetic retained pixels.
    // No detector, backend, user account, or cloud placement is called here.
    await page.evaluate(async () => {
      window.scrollTo(0, 0);
      window.appReview.clearResultPhotoRecovery();
      document.querySelector("#v-main").classList.add("hidden");
      const flow = await import("/src/ui/sideFlow.ts");
      const state = { skipped: 0, back: 0, done: 0 };
      const context = { scanId: "synthetic-ui-fixture", sex: "male", method: "upload", feedbackEligible: false,
        onSkip: () => { state.skipped++; }, onBack: () => { state.back++; }, onDone: () => { state.done++; } };
      window.appReview.side = { flow, state, context };
      flow.openSideCapture(context);
    });
    await page.locator("#side-pick").waitFor();
    await page.screenshot({ path: join(artifacts, `${viewport.width}-side-capture.png`) });
    await page.getByRole("button", { name: "Use front only", exact: true }).click();
    assert.equal(await page.evaluate(() => window.appReview.side.state.skipped), 1);
    await page.evaluate(() => {
      const { options, side } = window.appReview;
      side.flow.openSideAdjust(options.sidePhoto, { points: options.sidePoints, faceDir: 1, method: "existing" }, side.context);
    });
    await page.locator("#side-go").waitFor();
    await page.evaluate(async () => {
      // FLIP is queued on the next animation frame; sampling before that
      // frame sees no transform but can capture the entrance mid-flight.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.all(document.querySelector("#side-frame").closest(".cam-stage").getAnimations().map((animation) => animation.finished.catch(() => {})));
    });
    await page.screenshot({ path: join(artifacts, `${viewport.width}-side-review.png`) });
    const actions = await page.locator("#side-go, #side-guided, #side-wrong").evaluateAll((buttons) => buttons.map((button) => ({ text: button.innerText, width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })));
    assert.ok(actions.every((button) => button.width >= 120 && button.height >= 44), "Side review actions remain readable touch targets after the entrance settles");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.evaluate(() => window.appReview.side.flow.close());
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => {
      document.querySelector("#v-main").classList.remove("hidden");
      window.appReview.renderResults(window.appReview.options);
      document.querySelector('.rtab[data-id="eyes"]').click();
    });
    assert.ok(await page.locator("#zoomable").evaluate((el) => Number.parseFloat(getComputedStyle(el).transitionDuration) <= .001), "Reduced motion removes visible camera transitions");
    for (const [verified, expected] of [[true, "POINTS CHECKED"], [false, "POINTS NEED REVIEW"], [undefined, "PROFILE CAPTURE"]]) {
      await page.evaluate((verified) => {
        window.appReview.renderResults({ ...window.appReview.options, sideVerified: verified });
        document.querySelector('#view-toggle [data-view="side"]').click();
      }, verified);
      assert.equal(await page.locator("#capRight").innerText(), expected);
      if (verified !== true) assert.doesNotMatch(await page.locator("#quality-chips").innerText(), /checked by you/i);
    }
    console.log(JSON.stringify({ viewport, sideState, actions, errors }));
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally { await browser.close(); }
