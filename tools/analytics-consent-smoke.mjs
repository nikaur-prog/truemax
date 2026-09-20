// Fully intercepted production-origin fixture. Never contacts TrueMax, Google,
// auth or billing. Vite serves source; Google is a deterministic local mock.
import assert from "node:assert/strict";
import { readFile, mkdtemp } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { launchChromium } from "./launchChromium.mjs";

const dev = process.argv[2] || "http://127.0.0.1:4193";
if (!["localhost", "127.0.0.1"].includes(new URL(dev).hostname)) throw new Error("Local Vite origin required.");
const site = "https://www.truemax.app";
const artifacts = await mkdtemp(path.join(os.tmpdir(), "truemax-analytics-"));
const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
const common = Object.fromEntries(config.headers.find(h => h.source === "/(.*)").headers.map(h => [h.key.toLowerCase(), h.value]));
const frameHeaders = { ...common, ...Object.fromEntries(config.headers.find(h => h.source === "/analytics").headers.map(h => [h.key.toLowerCase(), h.value])) };
const frameHTML = await readFile(new URL("../analytics.html", import.meta.url), "utf8");
const articleHTML = await readFile(new URL("../face-score.html", import.meta.url), "utf8");
const mockGoogle = `const id='G-TEST123456';
  document.cookie='_ga=test-cookie; Path=/; Secure'; document.cookie='_ga_TEST123456=test-stream; Path=/; Secure';
  const handle=a=>{const args=Array.from(a); if(window['ga-disable-'+id])return; if(args[0]==='event')fetch('https://www.google-analytics.com/g/collect',{method:'POST',body:JSON.stringify(args)});};
  const queued=window.dataLayer.slice();window.dataLayer.push=function(a){Array.prototype.push.call(this,a);handle(a);return this.length;};queued.forEach(handle);`;
const home = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>PRIVATE TITLE MUST NEVER LEAK</title></head><body>
  <h1>Local analytics verification fixture</h1><input aria-label="Private input" value="PRIVATE-FACE-ACCOUNT-SECRET"><p class="foot"></p>
  <script type="module" src="/src/public-entry.ts"></script></body></html>`;
const browser = await launchChromium({ headless: true });
let measurementId = "G-TEST123456";
let holdGoogle = false;
let heldGoogle;
const googleLoads = [], events = [], rejected = [], modules = [];
const context = await browser.newContext();
await context.routeWebSocket("**/*", socket => socket.close());
await context.route("**/*", async route => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.hostname === "www.googletagmanager.com") {
    googleLoads.push(request.url());
    if (holdGoogle) { heldGoogle = route; return; }
    return route.fulfill({ contentType: "text/javascript", body: mockGoogle });
  }
  if (url.hostname === "www.google-analytics.com") {
    events.push(JSON.parse(request.postData() || "null"));
    return route.fulfill({ status: 204 });
  }
  if (url.origin !== site && url.origin !== dev) { rejected.push(url.href); return route.abort(); }
  if (url.pathname.startsWith("/api/")) {
    if (url.pathname === "/api/e") return route.fulfill({ status: 204 });
    rejected.push(url.pathname); return route.abort();
  }
  if (url.pathname === "/analytics") return route.fulfill({ contentType: "text/html", headers: frameHeaders, body: frameHTML });
  if (url.pathname === "/@vite/client") return route.fulfill({ contentType: "text/javascript", body: `export const createHotContext=()=>({accept(){},on(){},prune(){}});export function updateStyle(id,css){const s=document.createElement('style');s.textContent=css;document.head.append(s)};export function removeStyle(){};export const injectQuery=x=>x;` });
  if (url.pathname === "/face-score") return route.fulfill({ contentType: "text/html", headers: common, body: articleHTML });
  if (!url.pathname.startsWith("/src/") && !url.pathname.startsWith("/@") && !url.pathname.startsWith("/node_modules/")) return route.fulfill({ contentType: "text/html", headers: common, body: home });
  modules.push(url.pathname);
  const response = await route.fetch({ url: dev + url.pathname + url.search });
  let body = await response.text();
  // HMR cache keys otherwise produce two controller instances when this
  // fixture imports a module directly. Production has one bundled instance.
  body = body.replace(/(\/src\/[^"'\s?]+)\?t=\d+/g, "$1");
  if (url.pathname === "/src/engine/analytics.ts") body = body.replace(/import\.meta\.env = \{[^}]*\};/, `import.meta.env = { DEV: false, VITE_GA_MEASUREMENT_ID: ${JSON.stringify(measurementId)} };`);
  return route.fulfill({ response, body });
});

const pause = page => page.waitForTimeout(160);
try {
  const page = await context.newPage();
  page.on("pageerror", error => console.error("Fixture page error:", error.message));
  page.on("console", message => { if (message.type() === "error") console.error("Fixture console:", message.text()); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(site + "/face-score?utm_source=tiktok&utm_medium=cpc&utm_campaign=PRIVATE-CAMPAIGN&utm_content=PRIVATE-CREATIVE&ttclid=PRIVATE-CLICK");
  await page.getByRole("button", { name: "Allow analytics", exact: true }).waitFor();
  assert.equal(googleLoads.length, 0, "No Google request before a choice.");
  assert.equal(events.length, 0);
  assert.equal(await page.evaluate(() => sessionStorage.getItem("truemax.analytics-landing.v1")), null);
  await page.screenshot({ path: path.join(artifacts, "390-consent.png") });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole("button", { name: "Keep analytics off", exact: true }).click();
  await pause(page);
  assert.equal(googleLoads.length, 0);
  await page.locator('a.btn.pri[href="/"]').first().click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("truemax.attribution")).campaign), "PRIVATE-CAMPAIGN", "Guide-to-app retains original first touch without internal UTMs.");
  await page.getByRole("button", { name: "Analytics preferences", exact: true }).click();
  await page.getByRole("button", { name: "Allow analytics", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("iframe")?.contentWindow?.document.querySelector("script[src*='googletagmanager']"));
  await pause(page);
  assert.equal(googleLoads.length, 1);
  assert.equal(events.filter(e => e[1] === "page_view").length, 1);
  await page.evaluate(async () => {
    const analytics = await import("/src/engine/analytics.ts");
    analytics.trackAnalytics("scan-started"); analytics.trackAnalytics("scan-started");
    const { track } = await import("/src/engine/track.ts");
    track("scan-front-done"); track("account-created"); track("checkout-started");
    analytics.trackAnalytics("quick-scan-done"); analytics.trackAnalytics("max-chat-opened"); analytics.trackAnalytics("purchase");
  });
  await pause(page);
  assert.equal(events.filter(e => e[1] === "scan_start").length, 1);
  for (const event of ["scan_front_complete", "sign_up", "begin_checkout"]) assert.ok(events.some(e => e[1] === event), event);
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE|utm_|ttclid|photo|score|user_id|purchase/);
  assert.ok((await context.cookies()).some(c => c.name === "_ga"));
  const beforeRevoke = events.length;
  await page.getByRole("button", { name: "Analytics preferences", exact: true }).click();
  await page.getByRole("button", { name: "Keep analytics off", exact: true }).click();
  assert.equal(await page.locator("iframe").count(), 0);
  assert.equal((await context.cookies()).some(c => c.name.startsWith("_ga")), false);
  await page.evaluate(async () => (await import("/src/engine/analytics.ts")).trackAnalytics("scan-side-done"));
  await pause(page);
  assert.equal(events.length, beforeRevoke);

  // Re-opt-in must configure a fresh frame/page view, even without activity.
  await page.getByRole("button", { name: "Analytics preferences", exact: true }).click();
  await page.getByRole("button", { name: "Allow analytics", exact: true }).click();
  await pause(page);
  assert.equal(events.filter(e => e[1] === "page_view").length, 2);
  await page.evaluate(() => history.pushState({}, "", "/league/tools#calibrate"));
  assert.equal(await page.locator("iframe").count(), 0, "Private history transitions tear down immediately.");
  const beforePrivate = googleLoads.length;
  await page.reload(); await pause(page);
  assert.equal(googleLoads.length, beforePrivate);
  assert.equal(await page.getByRole("button", { name: "Analytics preferences" }).count(), 0);

  // A fresh organic landing has no campaign data and keeps the public source
  // category across a real article-to-home navigation, never the search query.
  await page.goto(site + "/");
  await page.evaluate(() => { sessionStorage.clear(); localStorage.removeItem("truemax.attribution"); });
  await page.goto(site + "/face-score", { referer: "https://www.google.com/search?q=PRIVATE-QUERY" });
  await pause(page);
  await page.locator('a.btn.pri[href="/"]').first().click();
  await pause(page);
  assert.ok(events.some(e => e[2].acquisition_source === "google" && e[2].landing_page === "/face-score"));
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE/);
  const beforeRestore = events.filter(e => e[1] === "page_view").length;
  await page.evaluate(() => { dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })); dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })); });
  await pause(page);
  assert.equal(events.filter(e => e[1] === "page_view").length, beforeRestore + 1, "Restoration reconfigures the bridge.");

  const second = await context.newPage();
  await second.goto(site + "/"); await pause(second);
  await page.getByRole("button", { name: "Analytics preferences", exact: true }).click();
  await page.getByRole("button", { name: "Keep analytics off", exact: true }).click();
  await pause(second);
  assert.equal(await second.locator("iframe").count(), 0, "Revocation propagates to another open tab.");
  await second.close();

  // Revoke while the Google library is still pending: release the mocked
  // download later and verify that no queued event reaches the collector.
  holdGoogle = true; heldGoogle = null;
  await page.getByRole("button", { name: "Analytics preferences", exact: true }).click();
  await page.getByRole("button", { name: "Allow analytics", exact: true }).click();
  await page.waitForFunction(() => !!document.querySelector("iframe")?.contentWindow?.document.querySelector("script[src*='googletagmanager']"));
  await pause(page);
  const beforeHeld = events.length;
  await page.getByRole("button", { name: "Analytics preferences", exact: true }).click();
  await page.getByRole("button", { name: "Keep analytics off", exact: true }).click();
  await heldGoogle?.fulfill({ contentType: "text/javascript", body: mockGoogle }).catch(() => {});
  holdGoogle = false;
  await pause(page); assert.equal(events.length, beforeHeld);

  // A readable old grant with blocked writes/removal must not revive, and
  // both preference surfaces must disclose that the choice was not saved.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Analytics preferences", exact: true }).click();
  await page.screenshot({ path: path.join(artifacts, "1440-consent.png") });
  await page.getByRole("button", { name: "Allow analytics", exact: true }).click();
  await pause(page);
  await page.evaluate(() => {
    const set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
    Storage.prototype.setItem = function(key, value) { if(key === "truemax.analytics-consent.v1") throw new Error("Fixture blocked writes"); return set.call(this,key,value); };
    Storage.prototype.removeItem = function(key) { if(key === "truemax.analytics-consent.v1") throw new Error("Fixture blocked removal"); return remove.call(this,key); };
  });
  await page.getByRole("button", { name: "Analytics preferences", exact: true }).click();
  await page.getByRole("button", { name: "Keep analytics off", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Your browser could not save" }).waitFor();
  assert.equal(await page.locator("iframe").count(), 0);
  await page.evaluate(async () => {
    const controller = (await import("/src/engine/analytics.ts")).publicAnalytics();
    controller.track("scan-side-done");
    const host = document.createElement("section"); document.body.append(host);
    (await import("/src/ui/analyticsConsent.ts")).mountAnalyticsSetting(host, controller);
  });
  assert.equal(await page.locator("iframe").count(), 0);
  assert.equal(await page.getByRole("status").filter({ hasText: "Your browser could not save" }).count(), 2);

  for (const url of [site + "/?code=PRIVATE-TOKEN", site + "/?preview=report", dev + "/", site + "/auth"]) {
    const count = googleLoads.length;
    await page.goto(url); await pause(page); assert.equal(googleLoads.length, count, url);
  }
  measurementId = "";
  await page.goto(site + "/"); await pause(page);
  assert.equal(await page.locator(".analytics-public").count(), 0, "Missing ID leaves production inactive.");
  assert.equal(rejected.length, 0, JSON.stringify(rejected));
  assert.equal(modules.some(p => /supabase|mediapipe|scoring\.ts|three|publicVitals|web-vitals/.test(p)), false, "No auth, vision or deferred field-vitals bundles on public pages.");
  console.log(`Analytics choice, consent lifecycle, privacy filtering, private/local gating and campaign continuity passed. ${events.length} mocked events only. Screenshots: ${artifacts}`);
} finally { await context.close(); await browser.close(); }
