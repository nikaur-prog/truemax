// Isolated UI lifecycle checks: the actual presence controller and bubble, with
// explicit owner records and an avatar state spy. No account or chat requests.
import assert from "node:assert/strict";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createServer } from "vite";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = await mkdtemp(path.join(tmpdir(), "truemax-max-presence-"));
const source = await readFile(new URL("../src/ui/maxTab.ts", import.meta.url), "utf8");
const presence = ts.transpileModule(source.slice(source.indexOf("function mountDashboardPresence(")), {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;
const server = await createServer({ root, server: { host: "127.0.0.1", port: 0, hmr: false } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  for (const [name, viewport, dark, fallback] of [
    ["desktop", { width: 1280, height: 900 }, false, false],
    ["mobile", { width: 390, height: 844 }, false, false],
    ["small-mobile-dark", { width: 320, height: 568 }, true, false],
    ["embedded-fallback", { width: 390, height: 700 }, false, true],
  ]) {
    const page = await browser.newPage({ viewport });
    if (fallback) await page.addInitScript(() => { window.IntersectionObserver = undefined; });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => route.request().url().startsWith(base) ? route.continue() : route.abort());
    await page.route(`${base}/__max_presence_check`, (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html>
      <html ${dark ? 'data-theme="dark"' : ""}><head><meta name="viewport" content="width=device-width,initial-scale=1">
      <link rel="stylesheet" href="/src/style.css"><link rel="stylesheet" href="/src/ui/theme.css">
      <style>body{padding:16px}#panel{max-width:650px;margin:auto}#bubble-test{width:240px;min-height:120px}#controls{display:flex;gap:12px}</style></head><body>
      <div id="panel"></div><div id="bubble-test"></div>
      <script type="module">
        import {maxTabMarkup} from '/src/ui/maxTab.ts';
        import {chooseMaxPresence} from '/src/ui/maxPresence.ts';
        import {mountMaxSpeechBubble} from '/src/ui/maxSpeechBubble.ts';
        import {isAppForeground,subscribeNativeActivity,bindNativeAppLifecycle} from '/src/engine/nativeBridge.ts';
        const fixture = {owner:'user:fixture', scans:[], routines:[], questions:[], states:[], levels:[], quiet:[]};
        const panel=document.querySelector('#panel'); panel.innerHTML=maxTabMarkup(true);
        const actualPresence=new Function('deps', 'const {activeScanOwner,mountMaxAvatar3D,mountMaxSpeechBubble,loadProfile,readProtocols,readOwnComparableHistory,chooseMaxPresence,isAppForeground,subscribeNativeActivity}=deps;'+${JSON.stringify(presence)}+';return mountDashboardPresence;')({
          activeScanOwner:()=>fixture.owner,
          mountMaxAvatar3D:()=>({setState:value=>fixture.states.push(value),setSpeechLevel:value=>fixture.levels.push(value),destroy:()=>fixture.states.push('destroy')}),
          mountMaxSpeechBubble,
          loadProfile:()=>({quiet:fixture.quiet,advice:{grooming:true,lifestyle:true}}),
          readProtocols:()=>fixture.routines,
          readOwnComparableHistory:()=>fixture.scans,
          chooseMaxPresence,isAppForeground,subscribeNativeActivity,
        });
        actualPresence(panel.querySelector('.maxtab'),panel,'Jordan',question=>fixture.questions.push(question));
        const bubbleEvents=[];
        const bubble=mountMaxSpeechBubble(document.querySelector('#bubble-test'),{onSpeakingChange:value=>bubbleEvents.push(value),announce:true});
        let nativeEvent;
        const unbindNative=bindNativeAppLifecycle({getState:async()=>({isActive:true}),addListener:async(_event,listener)=>{nativeEvent=listener;return{remove:async()=>{}}}});
        window.presenceTest={fixture,panel,bubble,bubbleEvents,mountMaxSpeechBubble,hideNative:()=>nativeEvent({isActive:false}),showNative:()=>nativeEvent({isActive:true}),unbindNative};
      </script></body></html>` }));
    await page.goto(`${base}/__max_presence_check`);
    await page.waitForFunction(() => Boolean(window.presenceTest));
    assert.equal(await page.evaluate(() => window.presenceTest.mountMaxSpeechBubble(document.querySelector('#bubble-test')) === window.presenceTest.bubble), true);
    await page.waitForFunction(() => window.presenceTest.fixture.states.includes("wave"));
    await page.waitForFunction(() => document.querySelector("[data-max-presence-speech] .max-speech-words")?.textContent?.includes("Jordan"));
    await page.waitForFunction(() => !document.querySelector("[data-max-presence-speech] .is-speaking"));
    assert.match(await page.locator("[data-max-presence-speech]").innerText(), /What would you like to work on today/);
    assert.ok(await page.evaluate(() => window.presenceTest.fixture.states.includes("speaking")));
    assert.equal(await page.locator(".maxtab-presence-action").isVisible(), true);
    const presenceBounds = await page.locator(".maxtab-presence").boundingBox();
    const bubbleBounds = await page.locator("[data-max-presence-speech] .max-speech-bubble").boundingBox();
    assert.ok(presenceBounds.x >= 0 && presenceBounds.x + presenceBounds.width <= viewport.width);
    assert.ok(bubbleBounds.x >= 0 && bubbleBounds.x + bubbleBounds.width <= viewport.width);
    await page.screenshot({ path: path.join(output, `${name}.png`) });
    await page.locator(".maxtab-presence-action").click();
    assert.equal(await page.evaluate(() => window.presenceTest.fixture.questions.length), 1);
    assert.equal(await page.locator("[data-max-presence-speech] .max-speech-bubble").isHidden(), true);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => { window.presenceTest.panel.hidden = true; });
    await page.waitForFunction(() => window.presenceTest.fixture.states.at(-1) === "quiet");
    await page.evaluate(() => { window.presenceTest.panel.hidden = false; });
    await page.waitForFunction(() => document.querySelector("[data-max-presence-speech] .max-speech-words")?.textContent?.includes("Want a plan"));
    assert.equal(await page.locator("[data-max-presence-speech] .is-speaking").count(), 0);
    // Streaming bubble: wait until its actual host is visible before revealing.
    await page.locator("#bubble-test").scrollIntoViewIfNeeded();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(() => window.presenceTest.bubble.update("This is the start of a real reply.", { complete: false }));
    await page.waitForFunction(() => window.presenceTest.bubbleEvents.includes(true));
    await page.evaluate(() => window.presenceTest.bubble.update("This is the start of a real reply. " + "More detail. ".repeat(30) + "The final useful sentence.", { complete: true }));
    await page.waitForFunction(() => document.querySelector("#bubble-test .max-speech-words").textContent.endsWith("The final useful sentence."));
    assert.ok((await page.locator("#bubble-test .max-speech-words").innerText()).length <= 140);
    await page.evaluate(() => {
      window.presenceTest.bubble.clear();
      window.presenceTest.bubble.update("A longer answer that must stop immediately when its view closes. ".repeat(3));
      window.presenceTest.bubble.setVisible(false);
    });
    assert.equal(await page.locator("#bubble-test .max-speech-bubble").isHidden(), true);
    assert.equal(await page.evaluate(() => window.presenceTest.bubbleEvents.at(-1)), false);
    await page.evaluate(() => {
      window.presenceTest.bubble.update("An answer received while hidden.");
      window.presenceTest.bubble.setVisible(true);
    });
    assert.equal(await page.locator("#bubble-test .max-speech-words").innerText(), "An answer received while hidden.");
    assert.equal(await page.locator("#bubble-test .is-speaking").count(), 0);
    await page.evaluate(() => {
      window.presenceTest.bubble.update("An answer that stops when the native app is backgrounded.");
      window.presenceTest.hideNative();
    });
    assert.equal(await page.locator("#bubble-test .max-speech-bubble").isHidden(), true);
    assert.equal(await page.evaluate(() => window.presenceTest.bubbleEvents.at(-1)), false);
    await page.evaluate(() => window.presenceTest.showNative());
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => window.presenceTest.bubble.update("<img src=x onerror=alert(1)> stays plain text."));
    assert.equal(await page.locator("#bubble-test img").count(), 0);
    assert.equal(await page.locator("#bubble-test .max-speech-words").innerText(), "<img src=x onerror=alert(1)> stays plain text.");
    assert.equal(await page.locator("#bubble-test .is-speaking").count(), 0);
    await page.evaluate(() => {
      window.presenceTest.fixture.owner = "user:other";
      window.presenceTest.panel.append(document.createElement("span"));
      window.presenceTest.bubble.destroy();
      window.presenceTest.unbindNative();
    });
    await page.waitForFunction(() => window.presenceTest.fixture.states.includes("destroy"));
    assert.equal(await page.locator(".max-speech-bubble").count(), 0);
    await page.close();
    console.log(`${name}: welcome, typed cadence, owner boundary, action, streaming tail, hidden/native pause, reduced motion and cleanup passed`);
  }
  assert.deepEqual(errors, []);
  console.log(`Screenshots: ${output}`);
} finally {
  await browser.close();
  await server.close();
}
