import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
const section = (start: string, end: string): string => {
  const from = main.indexOf(start);
  const to = main.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing source boundary: ${start}`);
  return main.slice(from, to);
};

test("late onboarding reads must still own both the scan generation and account before publishing profile data", () => {
  const source = section("async function ensureOnboarded", "async function requirePaidMaxBodyProfile");
  assert.match(source, /const ownsProfile = \(\) => generation === scanGeneration && activeScanOwner\(\) === `user:\$\{user\.id\}`/);
  assert.match(source, /await flushPendingProfile\(user\)\.catch\(\(\) => undefined\);\s*if \(!ownsProfile\(\)\) return/);
  const read = source.indexOf("await loadOnboardingProfile(user)");
  const guard = source.indexOf("if (!ownsProfile()) return", read);
  assert.ok(read >= 0 && guard > read);
  for (const mutation of ["knownAdult =", "knownFirstName =", "knownProfileOwner =", "setAdult(", "setBirthDate(", "openTrialFunnel("]) {
    assert.ok(source.indexOf(mutation) > guard, `${mutation} must follow the post-read owner check`);
  }
  assert.match(source, /knownFirstName = profile\.firstName\?\.trim\(\) \|\| null;\s*knownProfileOwner = user\.id;\s*syncLandingHeadline\(displayName\(user\)\)/);
  assert.doesNotMatch(source, /user_metadata/);
});

test("canonical greeting names are reusable only for their owner, with a safe metadata or generic fallback", () => {
  const source = section("function displayName(user:", "// ---- camera ----");
  assert.match(source, /if \(knownProfileOwner === user\.id && knownFirstName\) return knownFirstName/);
  assert.ok(source.indexOf("knownProfileOwner === user.id") < source.indexOf("user.user_metadata"));
  assert.match(source, /\["first_name", "full_name", "name"\]/);
  assert.match(source, /return null;/);
  assert.doesNotMatch(source, /user\.email|email\.split/);
});

test("account changes synchronously clear cached name, owner and age before any new profile work", () => {
  const source = section("const identityChanged = previousUserId", "previousUserId = nextUserId;");
  const reset = source.slice(source.indexOf("if (identityChanged) {"));
  assert.match(reset, /if \(identityChanged\) \{\s*knownAdult = false;\s*knownFirstName = null;\s*knownProfileOwner = null;/);
  for (const cleanup of ["clearResultsIdentityState()", "closeDashboard()", "closeBodyProfileDialog()", "closeTrialFunnel()"])
    assert.ok(reset.includes(cleanup), cleanup);
  assert.doesNotMatch(reset.slice(0, reset.indexOf("knownProfileOwner = null;") + 25), /\bawait\b/);
});
