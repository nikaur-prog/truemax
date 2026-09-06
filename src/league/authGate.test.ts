import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the League auth request remains single-flight while its fields change", () => {
  const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
  const gate = source.slice(source.indexOf("function renderGate"), source.indexOf("function renderApply"));
  assert.match(gate, /const ready = !authWorking/);
  assert.match(gate, /if \(authWorking\) return;/);
  assert.match(gate, /authWorking = true;\s*authButton\.disabled = true;/);
});

test("the League offers the sign-in methods used by existing TrueMax accounts", () => {
  const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
  const gate = source.slice(source.indexOf("function renderGate"), source.indexOf("function renderApply"));
  assert.match(gate, /id="lg-auth-google"/);
  assert.match(gate, /signInWithProvider\("google", leagueReturn\)/);
  assert.match(gate, /signInWithLink\(email, leagueReturn\)/);
  assert.match(gate, /requestPasswordReset\(email\)/);
});

test("the League does not apply the new-account password rule to sign in", () => {
  const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
  assert.match(source, /return mode === "signup" \? 8 : 1;/);
  assert.match(source, /avoid a commonly used or leaked password/);
  assert.doesNotMatch(source, /Email address or password not found/);
});
