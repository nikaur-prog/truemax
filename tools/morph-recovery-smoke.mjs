// Actual component + client HTTP contract, synthetic responses only. Never calls a provider.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
import { launchChromium } from "./launchChromium.mjs";

const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Local recovery test</title></head><body><main id="fixture" style="max-width:760px;margin:24px auto;padding:16px"></main><script type="module">
import "/src/style.css";
import { morphPreviewHTML, wireMorphPreview } from "/src/ui/morphPreview.ts";
import { buildMorphBlueprint } from "/src/engine/morphPlan.ts";
import { EMPTY_PROFILE } from "/src/engine/goals.ts";
const report = { sex: "female", overall: 5, overallPercentile: 50, overallZ: 0, potential: 6, pillars: { Harmony: 5, Angularity: 5, Dimorphism: 5, Features: 5 }, regions: [], metrics: [], zScores: {} };
const selected = buildMorphBlueprint(report, { ...EMPTY_PROFILE, goals: ["skin"] }, "selected", false);
const maxVision = buildMorphBlueprint(report, { ...EMPTY_PROFILE, goals: ["skin", "photos"] }, "max_vision", false);
const canvas = document.createElement("canvas"); canvas.width = 100; canvas.height = 100;
const ctx = canvas.getContext("2d"); ctx.fillStyle = "#39605b"; ctx.fillRect(0, 0, 100, 100);
window.smokePixel = canvas.toDataURL("image/jpeg");
const input = { scanId: "11111111-1111-4111-8111-111111111111", selected, maxVision, frontPhoto: canvas, sidePhoto: null, frontLandmarks: [], renderEnabled: true };
const host = document.querySelector("#fixture"); host.innerHTML = morphPreviewHTML(input);
window.disposeSmoke = wireMorphPreview(host, input, { owner: () => "user:synthetic-recovery", token: async () => "synthetic-not-a-credential", consent: async () => true, subscribeOwner: () => () => {} });
window.smokeReady = true;
</script></body></html>`;
const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, plugins: [{ name: "isolated-morph-recovery", configureServer(vite) {
  vite.middlewares.use("/__morph-recovery-smoke", (_req, res) => { res.setHeader("Content-Type", "text/html"); res.end(html); });
} }] });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const artifacts = await mkdtemp(join(tmpdir(), "truemax-morph-recovery-"));
const browser = await launchChromium({ headless: true });
const first = "22222222-2222-4222-8222-222222222222", second = "33333333-3333-4333-8333-333333333333";
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
    const errors = [], calls = [];
    let mode = "saved", submittedRequest = null;
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== origin) throw new Error(`Unexpected external request: ${url.origin}`);
      if (url.pathname !== "/api/morph-preview") {
        if (url.pathname.startsWith("/api/")) throw new Error(`Unexpected API: ${url.pathname}`);
        return route.continue();
      }
      calls.push({ method: req.method(), query: Object.fromEntries(url.searchParams) });
      if (req.method() === "POST") {
        assert.equal(mode, "unknown");
        submittedRequest = req.postDataJSON();
        return route.abort("failed");
      }
      const job = url.searchParams.get("job");
      if (job) return route.fulfill({ status: 200, json: { status: "ready", jobId: job, images: { front: await page.evaluate(() => window.smokePixel) },
        validation: { identityPreserved: true, targetAligned: true, naturalOnly: true, crossViewConsistent: true, moderationPassed: true } } });
      const jobs = mode === "saved" ? [first, second] : mode === "recovered" ? [first] : [];
      if (submittedRequest) assert.equal(url.searchParams.get("request"), submittedRequest.requestId);
      return route.fulfill({ status: 200, json: { scanId: url.searchParams.get("scan"), recipeKey: url.searchParams.get("recipe"),
        ...(url.searchParams.get("request") ? { requestId: url.searchParams.get("request") } : {}), jobs: jobs.map((jobId) => ({ jobId, status: "ready", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() })) } });
    });
    const open = async () => { await page.goto(`${origin}/__morph-recovery-smoke`); await page.waitForFunction(() => window.smokeReady); };
    const idle = async () => { await page.waitForFunction(() => !document.querySelector("[data-morph-create]").disabled); };
    await open();
    assert.equal(calls.length, 0, "mount does not automatically fetch or render");
    await page.locator("[data-morph-recover]").click();
    await page.locator("[data-morph-saved]").waitFor({ state: "visible" });
    assert.equal(calls.length, 1);
    await page.locator("[data-morph-saved]").selectOption(second);
    await page.locator("[data-morph-create]").click();
    await page.locator('[data-morph-output="front"]').waitFor({ state: "visible" });
    assert.deepEqual(calls.map((call) => call.method), ["GET", "GET"]);
    assert.equal(calls[1].query.job, second);
    assert.equal(calls[1].query.recipe, calls[0].query.recipe);
    await page.screenshot({ path: join(artifacts, `${viewport.width}-saved-selected.png`), fullPage: true });

    mode = "unknown";
    await open();
    await page.locator("[data-morph-create]").click();
    await page.waitForFunction(() => document.querySelector("[data-morph-status]").textContent.includes("earlier job"));
    assert.equal(calls.filter((call) => call.method === "POST").length, 1);
    const marker = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("truemax:morph-request:")));
    assert.equal(marker.length, 1);
    assert.deepEqual(Object.keys(JSON.parse(marker[0][1])).sort(), ["requestId", "startedAt"]);
    await open();
    await page.locator("[data-morph-recover]").click();
    await idle();
    await page.locator("[data-morph-create]").click();
    await idle();
    assert.match(await page.locator("[data-morph-status]").innerText(), /contact support/);
    assert.equal(calls.filter((call) => call.method === "POST").length, 1, "reload + check never automatically repeats an uncertain POST");
    await page.screenshot({ path: join(artifacts, `${viewport.width}-unknown-check-only.png`), fullPage: true });
    mode = "recovered";
    await page.locator("[data-morph-recover]").click();
    await idle();
    await page.locator("[data-morph-create]").click();
    await page.locator('[data-morph-output="front"]').waitFor({ state: "visible" });
    assert.equal(calls.filter((call) => call.method === "POST").length, 1);
    assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("truemax:morph-request:")).length), 0);
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no horizontal page overflow");
    console.log(JSON.stringify({ viewport: viewport.width, result: "passed", apiChecks: calls.length, syntheticPosts: 1, realProviderCalls: 0 }));
    await page.close();
  }
  console.log(JSON.stringify({ artifacts }));
} finally {
  await browser.close();
  await server.close();
}
