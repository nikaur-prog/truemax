// Real Coach components and browser events, isolated fixture Auth/API responses.
// Not a production sign-in, paid generation or real account-data write.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchChromium } from "./launchChromium.mjs";

const origin = process.argv[2] ?? "http://127.0.0.1:4189";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) throw new Error("Use a local dev server.");
const artifacts = await mkdtemp(join(tmpdir(), "truemax-plan-flow-"));
const browser = await launchChromium({ headless: true });
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
    const errors = [];
    const chatRequests = [];
    const writes = [];
    let pendingHistoryGate = null;
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.origin !== new URL(origin).origin) return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      if (url.pathname === "/api/max-chat") {
        chatRequests.push(req.postDataJSON());
        return route.fulfill({ status: 200, contentType: "text/plain", headers: { "X-Max-Remaining": "25" }, body: "Keep it manageable.\n- Choose a basic cleansing routine if that fits your skin goal.\n- Use the routine picker to decide what to track. Nothing has been started or completed." });
      }
      if (url.pathname === "/api/max-conversations") {
        if (req.method() === "POST") writes.push(req.postDataJSON());
        if (req.method() === "GET" && pendingHistoryGate) {
          const gate = pendingHistoryGate;
          pendingHistoryGate = null;
          gate.started();
          await gate.wait;
        }
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ conversations: [], planItems: [], routines: [] }) });
      }
      if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return route.continue();
    });
    await page.goto(`${origin}/?preview=max-coach`);
    await page.waitForSelector("[data-max-coach-preview]");
    await page.evaluate(async () => {
      const { getSupabaseClient } = await import("/src/engine/auth.ts");
      const client = await getSupabaseClient();
      const listeners = new Set();
      const session = { access_token: "local-fixture-not-a-credential", user: { id: "local-coach-review" } };
      client.auth.getSession = async () => ({ data: { session }, error: null });
      client.auth.onAuthStateChange = (callback) => {
        listeners.add(callback);
        queueMicrotask(() => { if (listeners.has(callback)) callback("SIGNED_IN", session); });
        return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
      };
      window.changeFixtureAccount = () => { for (const callback of listeners) callback("SIGNED_IN", { ...session, user: { id: "different-fixture-owner" } }); };
      const { activateScanOwner } = await import("/src/engine/scanScope.ts");
      activateScanOwner(session.user.id);
      const { EMPTY_PROFILE, saveProfile } = await import("/src/engine/goals.ts");
      saveProfile({ ...EMPTY_PROFILE, goals: ["skin"], skin: ["dryness"] });
      const { maxTabMarkup, wireMaxTab } = await import("/src/ui/maxTab.ts");
      const panel = document.createElement("main");
      panel.style.cssText = "max-width:760px;margin:auto;padding:20px;box-sizing:border-box";
      panel.innerHTML = maxTabMarkup(true);
      document.body.replaceChildren(panel);
      wireMaxTab(panel, { paid: true });
    });
    await page.getByRole("button", { name: "Build my plan", exact: true }).click();
    await page.waitForSelector(".max-plan-brief[open]");
    await page.locator("textarea[name=goal]").fill("Keep my routine simple");
    await page.locator("textarea[name=routine]").fill("I already use a cleanser. I have five minutes in the morning.");
    assert.equal(chatRequests.length, 0, "opening/reviewing a brief must not spend a chat turn");
    await page.screenshot({ path: join(artifacts, `${viewport.width}-brief.png`) });
    await page.locator(".max-plan-brief [data-save]").click();
    await page.waitForSelector(".maxchat-action:not([hidden]) button").catch(async (error) => {
      await page.screenshot({ path: join(artifacts, `${viewport.width}-failure.png`) });
      console.log(JSON.stringify({ errors, chatRequests: chatRequests.length, content: await page.locator("body").innerText(), artifacts }));
      throw error;
    });
    assert.equal(chatRequests.length, 1);
    const request = chatRequests[0];
    assert.match(request.messages[0].content, /five minutes/);
    assert.ok(request.context.coaching.goals.includes("Skin quality"));
    assert.equal(request.context.coaching.endGoal, "Keep my routine simple");
    assert.equal(await page.evaluate(() => document.querySelector(".maxchat")?.contains(document.activeElement)), true,
      "closing the plan brief must not steal focus from its new chat");
    await page.locator(".maxchat-action button").click();
    await page.waitForSelector(".max-routine-picker[open]");
    await page.keyboard.press("Escape");
    await page.waitForSelector(".max-routine-picker", { state: "detached" });
    assert.equal(await page.locator(".maxchat").count(), 1, "Escape dismisses the child picker without closing its chat");
    assert.equal(chatRequests.length, 1, "dismissing the picker must not spend another chat turn");
    await page.locator(".maxchat-action button").click();
    await page.waitForSelector(".max-routine-picker[open]");
    const cleanse = page.locator(".max-routine-options input[value=gentle-cleanse]");
    await cleanse.check();
    await page.locator(".max-routine-picker [data-save]").click();
    await page.waitForFunction(() => document.querySelector(".max-routine-status")?.textContent.includes("1 routine added"));
    const protocols = await page.evaluate(async () => (await import("/src/engine/protocol.ts")).readProtocols());
    assert.equal(protocols.length, 1);
    assert.equal(protocols[0].status, "committed");
    assert.equal(protocols[0].startedAt, null);
    assert.equal(protocols[0].ticks?.length ?? 0, 0);
    await page.screenshot({ path: join(artifacts, `${viewport.width}-routine.png`) });
    await page.locator(".max-routine-picker [data-cancel]").click();
    await page.locator(".maxchat-close").click();
    let releaseHistory;
    let reportHistoryStarted;
    const historyStarted = new Promise((resolve) => { reportHistoryStarted = resolve; });
    pendingHistoryGate = { wait: new Promise((resolve) => { releaseHistory = resolve; }), started: reportHistoryStarted };
    await page.locator(".maxtab-composer input").fill("What should I review first?");
    assert.equal(await page.locator(".maxchat").count(), 0, "focusing the composer must not open chat early");
    await page.locator(".maxtab-composer button").click();
    await historyStarted;
    await page.locator(".maxtab-composer input").fill("Keep this draft for my next question");
    releaseHistory();
    await page.waitForFunction(() => document.querySelector(".maxchat-log")?.textContent.includes("What should I review first?"));
    await page.waitForFunction(() => !document.querySelector(".maxchat-composer.busy"));
    assert.equal(chatRequests.at(-1).messages.at(-1).content, "What should I review first?");
    assert.equal(await page.locator(".maxtab-composer input").inputValue(), "Keep this draft for my next question",
      "history loading must not clear a newer draft");
    await page.locator(".maxchat-composer button").focus();
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("maxchat-close")), true, "focus stays within chat");
    await page.screenshot({ path: join(artifacts, `${viewport.width}-chat.png`) });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.evaluate(() => window.changeFixtureAccount());
    assert.equal(await page.locator(".maxchat").count(), 0, "changing account closes private chat");
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ viewport, chatRequests: chatRequests.length, routineSyncRequests: writes.length, errors, artifacts }));
    await page.close();
  }
} finally { await browser.close(); }
