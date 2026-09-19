import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHomeNavigation } from "./homeNavigation.js";

const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");

test("the explicit Home control starts hidden and disabled for signed-out visitors", () => {
  assert.match(html, /id="header-home"[^>]*aria-label="Go to home dashboard"[^>]*hidden disabled><svg/);
  assert.doesNotMatch(html, /id="header-home"[^>]*>Home/);
  assert.match(main, /home\.hidden = brand === "guest"/);
  assert.match(main, /home\.disabled = brand === "guest" \|\| homeNavigationPending/);
  assert.match(css, /\.header-home-link\[hidden\]\s*\{\s*display:\s*none/);
});

test("the logo and Home control share the account-checked dashboard navigation", () => {
  for (const id of ["logo-home", "header-home"]) {
    assert.ok(main.includes(`document.getElementById("${id}")?.addEventListener("click", () => { void requestHomeDashboard(); });`));
  }
  const action = main.slice(main.indexOf("async function openHomeDashboard"), main.indexOf('document.getElementById("logo-home")'));
  assert.match(action, /const user = await currentUser\(\)/);
  assert.match(action, /if \(!user\)/);
  assert.match(action, /activeScanOwner\(\) !== `user:\$\{user.id\}`/);
  assert.match(action, /openDashboard\(/);
  assert.match(main, /open: openHomeDashboard/);
});

test("landing keeps one accessible pause control without a replay button", () => {
  assert.match(html, /id="reel-pause"[^>]*aria-label="Pause demo"/);
  assert.doesNotMatch(html, /id="reel-replay"/);
  assert.match(html, /Demo faces are AI-generated/);
});

test("desktop dashboard content cannot shrink the header behind the navigation bar", () => {
  assert.match(css, /\.dash-inner \{[^}]*order: 2; flex-shrink: 0/);
  assert.match(css, /justify-content: safe center/);
});

test("Settings stays above the dashboard it opens from", () => {
  assert.match(css, /\.settings-overlay \{ z-index: 400; \}/);
});

test("repeated Home clicks share one navigation and always release the busy control", async () => {
  const states: boolean[] = [];
  let calls = 0;
  let finish!: () => void;
  const open = createHomeNavigation({
    open: () => { calls++; return new Promise<void>(resolve => { finish = resolve; }); },
    busy: value => states.push(value),
    failed: () => assert.fail("Unexpected failure"),
  });
  const first = open();
  assert.equal(open(), first);
  await Promise.resolve();
  assert.equal(calls, 1);
  finish();
  await first;
  assert.deepEqual(states, [true, false]);
});

test("a failed dashboard load shows a recoverable error and allows a fresh retry", async () => {
  let calls = 0;
  let failures = 0;
  const states: boolean[] = [];
  const open = createHomeNavigation({
    open: async () => { if (++calls === 1) throw new Error("Preview offline"); },
    busy: value => states.push(value),
    failed: () => { failures++; },
  });
  await open();
  await open();
  assert.equal(calls, 2);
  assert.equal(failures, 1);
  assert.deepEqual(states, [true, false, true, false]);
  assert.match(main, /notice\.setAttribute\("role", failed \? "alert" : "status"\)/);
  assert.match(main, /retry\.addEventListener\("click"/);
});
