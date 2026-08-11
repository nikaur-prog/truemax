// Patch metrics.ts dist blocks with the derived distributions, and rewrite
// celebs.ts from the measured DB.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { APP_DIR, dataFile } from "./runtime.mjs";

const SRC = resolve(APP_DIR, "src/engine");
const derived = readFileSync(dataFile("derived-dists.txt"), "utf8");

const dists = {};
for (const line of derived.split("\n")) {
  const m = line.match(/^\s{2}(\w+): \{ male: (\{[^}]+\}), female: (\{[^}]+\}) \},$/);
  if (m) dists[m[1]] = { male: m[2], female: m[3] };
}
console.log(`${Object.keys(dists).length} derived metric dists`);

let metrics = readFileSync(resolve(SRC, "metrics.ts"), "utf8");
let patched = 0;
for (const [id, d] of Object.entries(dists)) {
  // Match the dist block belonging to this metric's definition
  const re = new RegExp(
    `(id: "${id}",[\\s\\S]{0,600}?dist: \\{\\s*\\n)\\s*male: \\{[^}]*\\},\\s*\\n\\s*female: \\{[^}]*\\},`,
    "m",
  );
  if (!re.test(metrics)) {
    console.log(`  no match: ${id}`);
    continue;
  }
  metrics = metrics.replace(re, `$1      male: ${d.male},\n      female: ${d.female},`);
  patched++;
}
writeFileSync(resolve(SRC, "metrics.ts"), metrics);
console.log(`patched ${patched} dist blocks in metrics.ts`);

// celebs.ts DB
const db = JSON.parse(readFileSync(dataFile("celeb-db.json"), "utf8"));
const entries = db
  .map((e) => {
    const ms = Object.entries(e.metrics)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    return `  { name: ${JSON.stringify(e.name)}, sex: "${e.sex}", capture: "${e.capture}",\n    metrics: { ${ms} } },`;
  })
  .join("\n");

let celebs = readFileSync(resolve(SRC, "celebs.ts"), "utf8");
celebs = celebs.replace(
  /export const CELEBS: CelebEntry\[\] = \[[\s\S]*?\n\];/,
  `export const CELEBS: CelebEntry[] = [\n${entries}\n];`,
);
writeFileSync(resolve(SRC, "celebs.ts"), celebs);
console.log(`wrote ${db.length} celebrity entries to celebs.ts`);
