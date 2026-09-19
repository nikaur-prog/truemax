// Local fixture only: actual Settings component, real file picker/browser events,
// isolated Auth and API. No production account, model generation or points calls.
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchChromium } from "./launchChromium.mjs";

const origin = process.argv[2] ?? "http://127.0.0.1:4189";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) throw new Error("Use a local dev server.");
const artifacts = await mkdtemp(join(tmpdir(), "truemax-routine-history-"));
const browser = await launchChromium({ headless: true });
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    const external = [];
    const requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) { external.push(url.origin); return route.abort(); }
      if (url.pathname === "/__routine-history-fixture") return route.fulfill({ contentType: "text/html", body: "<!doctype html><meta name=viewport content='width=device-width, initial-scale=1'><body style='margin:0;font:16px system-ui'><main style='max-width:640px;margin:auto;padding:20px;box-sizing:border-box'></main></body>" });
      if (url.pathname === "/src/engine/auth.ts") return route.fulfill({ contentType: "application/javascript", body: `
        window.fixtureAuthCallbacks = new Set();
        export const onAuthChange = callback => { window.fixtureAuthCallbacks.add(callback); return () => window.fixtureAuthCallbacks.delete(callback); };
        export const currentAccessToken = async () => "local-fixture-not-a-credential";
      ` });
      if (url.pathname.startsWith("/api/")) {
        requests.push({ path: url.pathname, method: request.method(), body: request.postDataJSON() });
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ routines: request.postDataJSON()?.items ?? [] }) });
      }
      return route.continue();
    });
    await page.goto(`${origin}/__routine-history-fixture`);
    const backup = await page.evaluate(async () => {
      const { activateScanOwner } = await import("/src/engine/scanScope.ts");
      const owner = activateScanOwner("routine-fixture");
      const { writeProtocols } = await import("/src/engine/protocol.ts");
      writeProtocols([{ id: "sleep-1700000000000", recId: "sleep", title: "Sleep timing", channel: "lifestyle", metricId: "",
        weeksToJudge: 4, start: "commit", offeredAt: 1700000000000, startedAt: null, startBy: null,
        status: "committed", ticks: [], checkIns: [], historyPartial: true }]);
      const { exportRoutineHistory } = await import("/src/engine/routineHistoryBackup.ts");
      const json = exportRoutineHistory(owner);
      localStorage.clear();
      const { mountRoutineHistorySettings } = await import("/src/ui/routineHistorySettings.ts");
      window.mountRoutineFixture = () => mountRoutineHistorySettings(document.querySelector("main"), "routine-fixture");
      window.disposeRoutineFixture = window.mountRoutineFixture();
      return json;
    });
    const current = () => page.evaluate(async () => (await import("/src/engine/protocol.ts")).readProtocols());
    const choose = (text) => page.locator("[data-file]").setInputFiles({ name: "routine-backup.json", mimeType: "application/json", buffer: Buffer.from(text) });
    await choose(backup);
    await page.waitForSelector(".routine-history-preview:not([hidden])");
    assert.deepEqual(await current(), [], "preview cannot import data");
    assert.equal(requests.length, 0, "preview cannot upload data");
    await page.locator("[data-cancel]").click();
    assert.deepEqual(await current(), [], "cancel cannot import data");
    await choose("{malformed");
    await page.waitForFunction(() => document.querySelector("[data-status]").textContent.includes("not valid"));
    assert.deepEqual(await current(), []);
    await choose(backup);
    await page.waitForSelector(".routine-history-preview:not([hidden])");
    await page.locator("[data-confirm]").click();
    const restored = await current();
    assert.equal(restored.length, 1);
    assert.equal(restored[0].status, "committed");
    assert.equal(restored[0].startedAt, null);
    assert.equal(restored[0].historyPartial, true);
    assert.equal(requests.length, 0, "import is local and does not count a day or award points");
    const downloadPromise = page.waitForEvent("download");
    await page.locator("[data-export]").click();
    const download = await downloadPromise;
    const downloaded = JSON.parse(await readFile(await download.path(), "utf8"));
    assert.deepEqual(downloaded.protocols, restored);
    await page.locator("[data-retry]").click();
    await page.waitForFunction(() => document.querySelector("[data-status]").textContent.includes("Recent routine evidence synced"));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].path, "/api/max-conversations");
    assert.equal(requests[0].method, "POST");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(artifacts, `${viewport.width}-settings.png`) });
    for (const user of [{ id: "different-account" }, null]) {
      await page.evaluate(() => { window.disposeRoutineFixture(); window.disposeRoutineFixture = window.mountRoutineFixture(); });
      await choose(backup);
      await page.waitForSelector(".routine-history-preview:not([hidden])");
      await page.evaluate((user) => { for (const callback of window.fixtureAuthCallbacks) callback(user, user ? "SIGNED_IN" : "SIGNED_OUT"); }, user);
      assert.equal(await page.locator("[data-confirm]").count(), 0, "auth event clears preview even before activeScanOwner updates");
      assert.equal(await page.evaluate(async () => (await import("/src/engine/scanScope.ts")).activeScanOwner()), "user:routine-fixture");
      assert.deepEqual(await current(), restored);
    }
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ viewport, requests: requests.length, errors, artifacts }));
    await page.close();
  }
} finally { await browser.close(); }
