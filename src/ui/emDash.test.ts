import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// The standing copy rule, enforced instead of asserted.
//
// CLAUDE.md has said the em dash is barred from user-facing copy since the
// #198 cycle, and said the sweep was clean. It was not: privacy.html alone
// carried nine, three of them in prose, and there were 28 across the product.
// A rule kept by a note in the review checklist is a rule that decays, because
// the person adding a sentence six months from now is reading the code, not
// the checklist.
//
// The detector lives in scripts/emdash.mjs and exits non-zero on a finding, so
// it can gate a commit as well as a test run. See that file for why it blanks
// comments and then works line-wise rather than parsing string state: two
// attempts at tracking strings properly both desynchronised on nested template
// literals, and a detector that silently swallows findings after a desync is
// worse than none. Fixing that turned 2 findings into 9.
test("no em dash appears anywhere in user-facing copy", () => {
  try {
    execFileSync("node", ["scripts/emdash.mjs"], { encoding: "utf8", stdio: "pipe" });
  } catch (error) {
    const out = (error as { stdout?: string }).stdout ?? "";
    assert.fail(`em dashes found in user-facing copy:\n\n${out}`);
  }
});
