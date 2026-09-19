// Real chat/stream UI with isolated local Auth/API fixtures. No account writes.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchChromium } from "./launchChromium.mjs";

const origin = process.argv[2] ?? "http://127.0.0.1:4189";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw new Error("Use a local dev server.");
const artifacts = await mkdtemp(join(tmpdir(), "truemax-chat-presence-"));
const browser = await launchChromium({ headless: true });
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    const requests = [];
    let reply = "Hey! What would you like to work on today?";
    let status = 200;
    page.on("pageerror", (error) => errors.push(error.message));
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(origin).origin) return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      if (url.pathname === "/__max_chat_presence_fixture") return route.fulfill({ contentType: "text/html", body: `<!doctype html>
        <html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/style.css"></head>
        <body><main><h1>Local chat lifecycle fixture</h1></main></body></html>` });
      if (url.pathname === "/api/max-chat") {
        requests.push(route.request().postDataJSON());
        return route.fulfill({ status, contentType: status === 200 ? "text/plain" : "application/json", body: reply });
      }
      if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return route.continue();
    });
    // Import the real chat into an empty page. The full app's onboarding and
    // anonymous bootstrap are not part of this chat lifecycle fixture.
    await page.goto(`${origin}/__max_chat_presence_fixture`);
    const fixtureState = await page.evaluate(async () => {
      // Vite can version an imported module after a local edit. Patch the
      // same Auth instance that the real chat imports, not a second URL.
      const chatModule = "/src/ui/maxChat.ts";
      const code = await (await fetch(chatModule)).text();
      const authModule = code.match(/["'](\/src\/engine\/auth\.ts[^"']*)["']/)?.[1];
      if (!authModule) throw new Error("The chat's transformed Auth import was not found.");
      const { getSupabaseClient } = await import(authModule);
      const client = await getSupabaseClient();
      // Settle the real SDK's initial anonymous read before installing the
      // local signed-in fixture. No real account is used by this test.
      await client.auth.getSession();
      const listeners = new Set();
      const session = { access_token: "local-fixture-not-a-credential", user: { id: "max-presence-fixture" } };
      client.auth.getSession = async () => ({ data: { session }, error: null });
      client.auth.onAuthStateChange = (callback) => {
        listeners.add(callback);
        queueMicrotask(() => { if (listeners.has(callback)) callback("SIGNED_IN", session); });
        return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
      };
      (await import("/src/engine/scanScope.ts")).activateScanOwner(session.user.id);
      const { openMaxChat } = await import(chatModule);
      const opened = openMaxChat(null);
      return { opened, chats: document.querySelectorAll('.maxchat').length,
        owner: (await import("/src/engine/scanScope.ts")).activeScanOwner() };
    });
    assert.deepEqual(fixtureState, { opened: true, chats: 1, owner: "user:max-presence-fixture" });
    const send = async (question) => {
      await page.locator(".maxchat-composer input").fill(question);
      await page.locator(".maxchat-composer button").click();
    };
    await send("Hey Max");
    await page.waitForFunction(() => document.querySelector(".maxchat-speech .max-speech-words")?.textContent.startsWith("Hey"));
    await page.screenshot({ path: join(artifacts, `${viewport.width}-typing.png`) });
    await page.waitForFunction(() => !document.querySelector(".maxchat-composer.busy"));
    assert.equal(await page.locator(".maxchat-speech .max-speech-words").innerText(), reply);
    assert.equal(await page.locator(".maxchat-allowance").isVisible(), false, "missing quota header must not mean zero left");
    assert.equal(await page.locator(".maxchat-face").getAttribute("data-max-state"), "idle");
    assert.equal(await page.locator(".maxchat-speech .max-speech-bubble").getAttribute("aria-hidden"), "true");
    const layout = await page.evaluate(() => {
      const box = (selector) => document.querySelector(selector).getBoundingClientRect();
      const speech = box(".maxchat-speech"), face = box(".maxchat-face"), input = box(".maxchat-composer input"), log = box(".maxchat-log");
      return { overflow: document.documentElement.scrollWidth > innerWidth, bubbleLeft: speech.right <= face.left + 1,
        composerVisible: input.bottom <= innerHeight && input.top >= 0, logHeight: log.height };
    });
    assert.deepEqual({ overflow: layout.overflow, bubbleLeft: layout.bubbleLeft, composerVisible: layout.composerVisible }, { overflow: false, bubbleLeft: true, composerVisible: true });
    assert.ok(layout.logHeight >= 120);
    reply = "The photograph affects what can be measured. ".repeat(8) + "We need a clear side photo to review that angle.";
    await send("Does the angle need a side photo?");
    await page.waitForFunction(() => !document.querySelector(".maxchat-composer.busy"));
    assert.match(await page.locator(".maxchat-speech .max-speech-words").innerText(), /clear side photo/);
    assert.equal((await page.locator(".maxchat-log .maxchat-max").last().innerText()).length, reply.length);
    assert.equal(requests.at(-1).messages.at(-2).content, "Hey! What would you like to work on today?");
    await page.screenshot({ path: join(artifacts, `${viewport.width}-reply.png`) });
    reply = "   ";
    await send("Empty reply test");
    await page.waitForFunction(() => !document.querySelector(".maxchat-composer.busy"));
    assert.match(await page.locator(".maxchat-log").innerText(), /No reply came through/);
    assert.equal(await page.locator(".maxchat-speech .max-speech-bubble").isVisible(), false);
    status = 503; reply = JSON.stringify({ error: "Max is unavailable right now. Please try again later." });
    await send("Unavailable service test");
    await page.waitForFunction(() => !document.querySelector(".maxchat-composer.busy"));
    assert.match(await page.locator(".maxchat-log").innerText(), /Max is unavailable/);
    assert.equal(requests.at(-1).messages.some((turn) => turn.content === "Empty reply test"), false);
    assert.equal(await page.locator(".maxchat-face").getAttribute("data-max-state"), "idle");
    await page.locator(".maxchat-close").click();
    assert.equal(await page.locator(".maxchat-speech").count(), 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ viewport, requests: requests.length, layout, errors, artifacts }));
    await page.close();
  }
} finally { await browser.close(); }
