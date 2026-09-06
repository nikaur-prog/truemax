import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
const gate = main.slice(main.indexOf("async function requirePaidMaxBodyProfile"), main.indexOf('document.getElementById("logo-home")'));

test("body setup imports before hydration and trusts the authenticated required flag", () => {
  assert.match(gate, /currentAccessToken\(user.id\)/);
  assert.ok(gate.indexOf("await migrateLocalBodyProfile(accessToken)") < gate.indexOf("await fetchBodyProfile(accessToken)"));
  assert.match(gate, /if \(profile\?\.required\)/);
  assert.match(gate, /userId: user.id, initialProfile: profile/);
  assert.doesNotMatch(gate, /readBody\(|lastKnownPaidMax|profileIsAdult\(/);
});

test("signup-return hydrates details without delaying the recovered report with a body prompt", () => {
  assert.match(main, /await requirePaidMaxBodyProfile\(user, !resumed && !resumePendingStarted\)/);
  assert.match(gate, /if \(!allowPrompt \|\| generation !== scanGeneration \|\| !ownsAccount\(\)\) return/);
});

test("switching accounts closes the previous account's body dialog", () => {
  const identity = main.slice(main.indexOf("if (identityChanged)"), main.indexOf("previousUserId = nextUserId"));
  assert.match(identity, /closeBodyProfileDialog\(\)/);
});
