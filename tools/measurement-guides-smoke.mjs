// Public guide QA with isolated browser state. Uses the deployed route map;
// never calls accounts, generation, analytics collectors or production APIs.
import assert from "node:assert/strict";
import { readFile, mkdtemp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
import { launchChromium } from "./launchChromium.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
const routes = ["/measurements", "/measurements/gonial-angle", "/measurements/canthal-tilt", "/measurements/side-profile-analysis"];
const server = await createServer({ root, server: { host: "127.0.0.1", port: 0, hmr: false }, plugins: [{
  name: "public-guide-routes",
  configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const redirect = config.redirects.find(item => item.source === url.pathname);
      if (redirect) { res.writeHead(308, { location: redirect.destination + url.search }); res.end(); return; }
      const rewrite = config.rewrites.find(item => item.source === url.pathname);
      if (rewrite) req.url = rewrite.destination + url.search;
      else if (url.pathname.startsWith("/measurements/")) { res.writeHead(404); res.end("Not found"); return; }
      next();
    });
  },
}] });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const artifacts = await mkdtemp(join(tmpdir(), "truemax-measurement-guides-"));
const browser = await launchChromium({ headless: true });
try {
  for (const width of [1440, 390, 320]) for (const javaScriptEnabled of [false, true]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, javaScriptEnabled });
    const page = await context.newPage();
    const errors = [], privateRequests = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin || url.pathname.startsWith("/api/")) { privateRequests.push(url.pathname); return route.abort(); }
      return route.continue();
    });
    for (const path of routes) {
      const response = await page.goto(origin + path);
      assert.equal(response.status(), 200, path);
      await page.locator("h1").waitFor();
      assert.equal(await page.locator("h1").count(), 1);
      assert.equal(await page.locator('link[rel="canonical"]').getAttribute("href"), `https://www.truemax.app${path}`);
      assert.ok((await page.locator("main").innerText()).length > 1800, `${path}: substantive content is readable without hydration`);
      assert.equal(await page.locator('svg[role="img"]').count(), 1);
      for (const reference of (await page.locator('svg[role="img"]').getAttribute("aria-labelledby")).split(" ")) {
        assert.ok((await page.locator(`#${reference}`).textContent()).length > 8);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${path}: overflow at ${width}`);
      const schema = await page.locator('script[type="application/ld+json"]').allTextContents();
      for (const json of schema) assert.doesNotThrow(() => JSON.parse(json));
      await page.keyboard.press("Tab");
      assert.equal(await page.locator(".guide-skip").evaluate(link => document.activeElement === link), true);
      assert.equal(await page.locator(".guide-skip").isVisible(), true);
      await page.locator(".guide-figure").scrollIntoViewIfNeeded();
      if (width !== 320 && !javaScriptEnabled) await page.screenshot({ path: join(artifacts, `${width}-${path.split("/").at(-1)}.png`) });
      await page.locator(".guide-cta .btn").scrollIntoViewIfNeeded();
      assert.ok(await page.locator(".guide-cta .btn").isVisible());
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(privateRequests, [], "reading guides does not require external services or API calls");
    await page.goto(origin + "/guides");
    await page.locator('.guide-card[href="/measurements"]').click();
    assert.equal(new URL(page.url()).pathname, "/measurements");
    await page.locator('.guide-card[href="/measurements/gonial-angle"]').click();
    assert.equal(new URL(page.url()).pathname, "/measurements/gonial-angle");
    console.log(JSON.stringify({ width, javaScriptEnabled, routes: routes.length, errors, privateRequests }));
    await context.close();
  }
  for (const path of routes) {
    const entry = config.rewrites.find(item => item.source === path).destination;
    for (const alias of [path + "/", entry]) {
      const response = await fetch(origin + alias, { redirect: "manual" });
      assert.equal(response.status, 308);
      assert.equal(response.headers.get("location"), path);
    }
  }
  assert.equal((await fetch(origin + "/measurements/not-a-guide")).status, 404);
  console.log(`Guide screenshots: ${artifacts}`);
} finally { await browser.close(); await server.close(); }
