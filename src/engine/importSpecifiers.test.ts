import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// No relative import may name a ".ts" file.
//
// This is the test for the bug that took the entire server side down for the
// whole life of the project: every function under /api returned
// FUNCTION_INVOCATION_FAILED, so checkout, the Stripe webhook, account deletion
// and the side-landmark feedback route had never once worked.
//
// The cause was one character class. Deployment compiles x.ts to x.js, so an
// import written as "./x.ts" names a file that stops existing at the moment it
// matters, and Node's ES module resolver — unlike CommonJS, unlike every
// bundler — does no extension guessing to rescue it. The convention on ESM is
// to import the OUTPUT name, "./x.js", which TypeScript maps back to the source
// for you.
//
// It needs a test rather than a compiler flag because no compiler flag catches
// it: Vite resolved it, tsc resolved it under bundler resolution with
// allowImportingTsExtensions both on and off, and every one of these tests
// passed against the broken spelling. The local toolchain agreed the code was
// fine right up until it was deployed, which is the only reason this survived
// as long as it did.
//
// Reading the files as text is the point. Anything that resolved the imports
// would resolve these too, and report success.
// ---------------------------------------------------------------------------

const ROOTS = ["src", "api", "tools", "scripts"];
const CODE = /\.(ts|mts|mjs|js)$/;
const RELATIVE_TS = /(?:from|import\s*\()\s*["'](\.\.?\/[^"']*\.ts)["']/g;

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // an optional directory that this checkout does not have
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (CODE.test(entry)) out.push(path);
  }
  return out;
}

test("no relative import names a .ts file", () => {
  const offenders: string[] = [];
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(RELATIVE_TS)) {
        offenders.push(`${file}: ${match[1]} — write it as ${match[1].slice(0, -3)}.js`);
      }
    }
  }
  assert.deepEqual(offenders, [], `\n${offenders.join("\n")}\n`);
});

test("the check is looking at real files and would notice a regression", () => {
  // A guard that silently walked an empty tree would pass forever. This asserts
  // it is reading a meaningful number of files, and that its pattern actually
  // matches the spelling it exists to ban.
  const files = ROOTS.flatMap((root) => walk(root));
  assert.ok(files.length > 50, `only walked ${files.length} files`);

  // Assembled rather than written out, because this file is inside the tree it
  // scans and a literal example would make the guard fail on itself. Excluding
  // this file from the walk would have worked too, and would have been a hole
  // in the only thing standing between the codebase and a repeat of the outage.
  const ext = "ts";
  const matches = (source: string) => [...source.matchAll(RELATIVE_TS)].length;
  assert.equal(matches(`import { x } from "./y.${ext}";`), 1);
  assert.equal(matches(`const m = await import("../z.${ext}");`), 1);
  assert.equal(matches(`import { x } from "./y.js";`), 0);
  assert.equal(matches(`import Stripe from "stripe";`), 0);
});
