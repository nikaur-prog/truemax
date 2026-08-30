// ---------------------------------------------------------------------------
// The em dash detector.
//
// CLAUDE.md bars the em dash from USER-FACING COPY, and the distinction is the
// whole difficulty: this repository's comments are prose and use em dashes
// freely, which is fine because nobody reading the product ever sees them. A
// naive grep counts thousands and is useless; the rule needs a detector that
// knows the difference between a sentence in a comment and a sentence on a
// screen.
//
// So: strings and template literals in TypeScript, and text content in HTML.
// Comments in both are stripped first. The one legitimate survivor is the EN
// dash used as the empty-cell glyph in a numeric column, which is a
// typographic placeholder rather than prose and is a different character.
//
// Run: node scripts/emdash.mjs
// Exits non-zero if anything is found, so it can gate a commit.
// ---------------------------------------------------------------------------
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const EM = /[—]|&mdash;|&#8212;/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    // Developer surfaces, not product copy. A test's assertion message and a
    // corpus tool's stderr are read by whoever is working on this, in the same
    // register as the comments above them, and the rule is about what a person
    // using TrueMax sees on a screen.
    if (["node_modules", "dist", ".git", "public", "tools", "scripts"].includes(name)) continue;
    if (name.endsWith(".test.ts")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if ([".ts", ".html"].includes(extname(p))) out.push(p);
  }
  return out;
}

/** Comments out, so prose written for developers is never counted. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + m.slice(p.length).replace(/./g, " "))
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
}

/**
 * NO PARSER. Comments are blanked, and whatever em dash is left is copy.
 *
 * Two attempts at tracking string state properly both desynchronised on this
 * codebase's normal way of writing markup:
 *
 *   `<select>${items.map((i) => `<option>`).join("")}</select>`
 *
 * A nested backtick reads as closing the outer template, and from there every
 * apostrophe in prose ("it's live") opens a phantom string. The first version
 * reported two fragments starting mid-word, and worse, silently SWALLOWED
 * every real hit after each desync: fixing the nesting turned 2 findings into
 * 9. A detector that can hide findings is not one to build a rule on.
 *
 * So there is no state machine. Comments are already replaced with spaces
 * above, and in this codebase an em dash outside a comment is in a string,
 * because there is nowhere else in TypeScript for one to be. Line-wise,
 * total, and impossible to desynchronise.
 */
function copyLines(src) {
  return src.split("\n").map((line, i) => [i + 1, line]).filter(([, line]) => EM.test(line));
}

/** HTML text content: everything that is not inside a tag, a script or a style. */
function htmlText(src) {
  return src
    .replace(/<script[\s\S]*?<\/script>/gi, (m) => m.replace(/[^\n]/g, " "))
    .replace(/<style[\s\S]*?<\/style>/gi, (m) => m.replace(/[^\n]/g, " "))
    .replace(/<[^>]*>/g, (m) => m.replace(/[^\n]/g, " "));
}

const hits = [];

for (const file of walk(process.cwd())) {
  const raw = readFileSync(file, "utf8");
  const src = stripComments(raw);
  if (extname(file) === ".html") {
    const text = htmlText(src);
    text.split("\n").forEach((line, i) => {
      if (EM.test(line)) hits.push({ file, line: i + 1, text: line.trim() });
    });
  } else {
    for (const [line, text] of copyLines(src)) {
      hits.push({ file, line, text: text.trim().slice(0, 120) });
    }
  }
}

for (const h of hits) console.log(`${h.file}:${h.line}\n    ${h.text}`);
console.log(hits.length ? `\n${hits.length} em dashes in user-facing copy.` : "No em dashes in user-facing copy.");
process.exit(hits.length ? 1 : 0);
