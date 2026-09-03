import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authSubmitReady } from "./authForm.js";

test("auth submit readiness stays false while a request is active", () => {
  assert.equal(authSubmitReady(true, true, 12, true, false), true);
  assert.equal(authSubmitReady(true, true, 12, true, true), false);
  assert.equal(authSubmitReady(true, true, 0, false, false), true);
  assert.equal(authSubmitReady(true, true, 0, false, true), false);
});

test("every async auth form is guarded against a second submit event", () => {
  const source = readFileSync(new URL("./authForm.ts", import.meta.url), "utf8");
  assert.equal((source.match(/if \((?:formWorking|working)\) return;/g) ?? []).length, 3);
  assert.match(source, /if \(socialWorking \|\| button\.dataset\.available !== "true"\) return;/);
  assert.match(source, /button\.disabled = socialWorking;/);
});

test("a repeated back-swipe reinstalls the report sentinel while the dialog is open", () => {
  const source = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
  const handler = source.slice(
    source.indexOf('window.addEventListener("popstate"'),
    source.indexOf("// ---------------------------------------------------------------------------\n// Reopening", source.indexOf('window.addEventListener("popstate"')),
  );
  assert.match(handler, /guardEntryPushed = false;\s*if \(leavePromptOpen\) \{\s*pushLeaveGuardEntry\(\);/);
  assert.match(handler, /const sentinelPresent = guardEntryPushed;/);
});

test("a past-due account is never described as an unrenewed Free plan", () => {
  const source = readFileSync(new URL("./authModal.ts", import.meta.url), "utf8");
  assert.match(source, /Stripe could not renew your subscription\./);
  assert.doesNotMatch(source, /Stripe could not renew \$\{planName\}/);
});
