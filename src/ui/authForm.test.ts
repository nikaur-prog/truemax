import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authFormIntro, authProviderState, authSubmitReady } from "./authForm.js";

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
  assert.equal(authFormIntro("password", "analysis").title, "Sign in to see your analysis");
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
  assert.match(source, /authProviderState\(provider, availability, formWorking \|\| socialWorking\)/);
  assert.match(source, /if \(formWorking \|\| !current\(\)\) return;/);
  assert.match(source, /if \(socialWorking \|\| !current\(\)\) return;/);
});

test("signup asks only for credentials, before the provider alternative", () => {
  const source = readFileSync(new URL("./authForm.ts", import.meta.url), "utf8");
  const credentials = source.slice(source.indexOf('<form class="acct-form"'), source.indexOf('</form>'));
  assert.deepEqual([...credentials.matchAll(/name="([^"]+)"/g)].map((match) => match[1]), ["email", "password"]);
  assert.doesNotMatch(source, /name="(?:name|heightCm|weightKg|feet|inches|pounds|dateOfBirth)"|<fieldset/);
  assert.match(source, /await signUp\(email, password\)/);
  assert.ok(source.indexOf('</form>') < source.indexOf('class="acct-social"'));
  assert.doesNotMatch(source, /Coming soon|awaiting provider setup/);
});

test("unconfigured or unknown providers stay hidden and cannot launch OAuth", () => {
  assert.deepEqual(authProviderState("apple", { google: true, apple: false }, false), {
    available: false, hidden: true, disabled: true,
  });
  assert.deepEqual(authProviderState("apple", null, false), {
    available: false, hidden: true, disabled: true,
  });
  assert.deepEqual(authProviderState("google", { google: true, apple: false }, false), {
    available: true, hidden: false, disabled: false,
  });
  assert.deepEqual(authProviderState("google", { google: true, apple: false }, true), {
    available: true, hidden: false, disabled: true,
  });
  assert.deepEqual(authProviderState("apple", { google: true, apple: true }, false), {
    available: true, hidden: false, disabled: false,
  });
});

test("provider retries and late reads stay bound to the form that requested them", () => {
  const source = readFileSync(new URL("./authForm.ts", import.meta.url), "utf8");
  assert.match(source, /const current = \(\) => root.isConnected && root.querySelector\(".acct-form"\) === form/);
  assert.match(source, /await socialAvailability\(\);\s*if \(!current\(\)\) return/);
  assert.match(source, /providerRetry.addEventListener\("click", \(\) => void checkProviders\(\)\)/);
  assert.match(source, /disabled \|\| button.dataset.available !== "true"/);
});

test("a late signed-in session uses the scan wall's completion callback once", () => {
  const source = readFileSync(new URL("./authModal.ts", import.meta.url), "utf8");
  const open = source.slice(source.indexOf("export async function openAccount"), source.indexOf("function escClose"));
  assert.match(open, /const acceptAuthenticated = async \(user: User\)/);
  assert.match(open, /if \(authenticationAccepted \|\| overlay !== activeOverlay \|\| !body.isConnected\) return/);
  assert.match(open, /authenticationAccepted = true/);
  assert.match(open, /onAuthenticated: acceptAuthenticated/);
  assert.equal((open.match(/void acceptAuthenticated\(lateUser\)/g) ?? []).length, 2);
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
