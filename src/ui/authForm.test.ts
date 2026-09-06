import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authFormIntro, authSubmitReady } from "./authForm.js";

test("plan signup describes the next step instead of relocking a visible analysis", () => {
  const intro = authFormIntro("signup", "plan");
  assert.equal(intro.title, "Create an account to build your plan");
  assert.match(intro.lede, /Your analysis is ready/);
  assert.doesNotMatch(intro.lede, /open the result/);
  assert.equal(authFormIntro("password", "plan").title, "Sign in to build your plan");
  assert.equal(authFormIntro("link", "plan").title, "Sign in to build your plan");
});

test("analysis and ordinary account entry keep their own explanation", () => {
  assert.equal(authFormIntro("signup", "analysis").title, "Create an account to see your analysis");
  assert.equal(authFormIntro("signup", "account").title, "Create your account");
  assert.equal(authFormIntro("password", "portal").title, "Welcome back");
});

test("both report plan entry points use plan context, while the scan gate remains analysis", () => {
  const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
  assert.equal((main.match(/reason: "plan"/g) ?? []).length, 2);
  assert.match(main, /initialMode: saved \? "signup" : "password",\s*reason: "analysis"/);
  const modal = readFileSync(new URL("./authModal.ts", import.meta.url), "utf8");
  assert.match(modal, /context: options.reason \?\? "account"/);
});

test("auth submit readiness stays false while a request is active", () => {
  assert.equal(authSubmitReady(true, true, 12, 8, false), true);
  assert.equal(authSubmitReady(true, true, 12, 8, true), false);
  assert.equal(authSubmitReady(true, true, 0, 0, false), true);
  assert.equal(authSubmitReady(true, true, 0, 0, true), false);
});

test("sign in accepts an existing non-empty password while signup requires eight characters", () => {
  assert.equal(authSubmitReady(true, true, 1, 1, false), true);
  assert.equal(authSubmitReady(true, true, 7, 8, false), false);
  assert.equal(authSubmitReady(true, true, 8, 8, false), true);
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
