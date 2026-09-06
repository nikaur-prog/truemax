import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSkinTrialAccess } from "./skinTrialAccess.js";

test("a URL or stored preference cannot open the skin trial for a non-staff account", () => {
  const gate = createSkinTrialAccess(() => true);
  assert.equal(gate.enabled(), false);
  const resolve = gate.begin();
  assert.equal(gate.enabled(), false, "loading is closed");
  resolve(false);
  assert.equal(gate.enabled(), false);
});

test("a current staff result still requires the separate trial opt-in", () => {
  let optedIn = false;
  const gate = createSkinTrialAccess(() => optedIn);
  gate.begin()(true);
  assert.equal(gate.enabled(), false);
  optedIn = true;
  assert.equal(gate.enabled(), true);
  optedIn = false;
  assert.equal(gate.enabled(), false);
});

test("refresh hides the trial immediately and a failed role read cannot reopen it", () => {
  const gate = createSkinTrialAccess(() => true);
  gate.begin()(true);
  assert.equal(gate.enabled(), true);
  const resolve = gate.begin();
  assert.equal(gate.enabled(), false);
  resolve(false);
  assert.equal(gate.enabled(), false);
});

test("sign-out or account switch invalidates pending staff reads", async () => {
  const gate = createSkinTrialAccess(() => true);
  let finish!: (staff: boolean) => void;
  const oldRead = new Promise<boolean>((resolve) => { finish = resolve; });
  const oldResult = gate.begin();
  const settled = oldRead.then(oldResult);
  gate.reset();
  assert.equal(gate.enabled(), false);
  gate.begin()(false);
  finish(true);
  assert.equal(await settled, false, "the old account's successful query is discarded");
  assert.equal(gate.enabled(), false);
});

test("an older role refresh cannot overwrite the current account's closed state", () => {
  const gate = createSkinTrialAccess(() => true);
  const oldResult = gate.begin();
  gate.begin()(false);
  assert.equal(oldResult(true), false);
  assert.equal(gate.enabled(), false);
});

test("unavailable browser preferences fail closed for staff too", () => {
  const gate = createSkinTrialAccess(() => { throw new Error("Storage unavailable"); });
  gate.begin()(true);
  assert.equal(gate.enabled(), false);
});

test("the report uses the server-backed staff result without awaiting it or using Max as permission", () => {
  const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
  const refresh = main.slice(main.indexOf("async function refreshMaxAccess"), main.indexOf("markPlatform();"));
  assert.match(refresh, /const resolveSkinTrialStaff = beginSkinTrialStaffCheck\(\)/);
  assert.match(refresh, /loadIsAdmin\(\)\.catch\(\(\) => false\)/);
  assert.match(refresh, /if \(owner !== activeScanOwner\(\) \|\| generation !== scanGeneration\) return/);
  assert.match(refresh, /resolveSkinTrialStaff\(admin\)/);
  assert.match(refresh, /resolveSkinTrialStaff\(false\)/);
  assert.doesNotMatch(refresh, /await beginSkinTrialStaffCheck/);
  const results = readFileSync(new URL("./results.ts", import.meta.url), "utf8");
  assert.match(results, /if \(!skinTrialAccess\.enabled\(\)\) return ""/);
  assert.match(results, /clearResultsIdentityState\(\): void \{\s*skinTrialAccess\.reset\(\);\s*repaintSkinTrial\(\)/);
  assert.match(results, /<template data-skin-trial-slot><\/template>/);
  const entitlement = readFileSync(new URL("../engine/entitlement.ts", import.meta.url), "utf8");
  assert.match(entitlement, /loadIsAdmin[\s\S]*?\.from\("app_admins"\)/);
});
