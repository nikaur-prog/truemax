// Does a skin metric survive being photographed twice?
//
// Same test the face-ratio metrics had to pass: measure how much a metric moves
// between different photos of the SAME person, against how much it moves across
// the population. Reliability = 1 - (within/between)^2. At 0 the metric is pure
// photography and cannot be allowed to touch a score; at 1 it is all signal.
//
// Skin has more to lose here than geometry does. A jaw angle survives a change
// of lighting; "how evenly does this face reflect light" might BE the lighting.
// That is the question this tool exists to answer, before any of it is wired
// into the overall score.
import { launchChromium } from "./launchChromium.mjs";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const APP_DIR = "/home/user/truemax";
const DATA = process.env.TM_DATA ?? new URL("../.calib/", import.meta.url).pathname;

const POP = JSON.parse(readFileSync(DATA + "pop-manifest.json", "utf8"));
const ALTS = JSON.parse(readFileSync(DATA + "alts2-manifest.json", "utf8"));

const IDS = ["toneEvenness", "rednessSpread", "chromaSpread", "texture", "undereyeRatio"];

const server = spawn("npx", ["vite", "preview", "--port", "4217", "--strictPort"], {
  cwd: APP_DIR,
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 2500));
const browser = await launchChromium();

const scan = async (page, rows) => {
  const out = [];
  for (const row of rows) {
    const url = `data:image/jpeg;base64,${readFileSync(row.file).toString("base64")}`;
    const m = await page.evaluate(async ([u, s]) => {
      const r = await window.__truemaxMeasure(u, s);
      return r.faceFound ? { skin: r.skin, w: r.faceWidthFrac, yaw: r.yaw, pitch: r.pitch } : null;
    }, [url, row.sex]);
    // Same portrait gate the rest of the pipeline uses, plus a coverage floor:
    // a face half behind hair or a beard has no skin left to measure.
    if (!m?.skin || m.w < 0.22 || m.skin.coverage < 0.18) continue;
    if (Math.abs(m.yaw) > 25 || Math.abs(m.pitch) > 22) continue;
    out.push({ ...row, skin: m.skin });
  }
  return out;
};

let pop = [];
let alts = [];
try {
  const page = await browser.newPage();
  await page.goto("http://localhost:4217/");
  await page.waitForSelector("html[data-engine=\"ready\"]", { timeout: 60000 });
  pop = await scan(page, POP);
  alts = await scan(page, ALTS);
} finally {
  await browser.close();
  server.kill();
}

const sd = (a) => {
  if (a.length < 2) return null;
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1));
};

// Group repeat photos by person
const byPerson = new Map();
for (const r of alts) {
  if (!byPerson.has(r.person)) byPerson.set(r.person, []);
  byPerson.get(r.person).push(r);
}
const groups = [...byPerson.values()].filter((g) => g.length >= 2);

console.log(`population n=${pop.length}   repeat-photo people=${groups.length} (${alts.length} photos)\n`);
console.log("metric           between-SD  within-SD   reliability   verdict");
console.log("-".repeat(70));

const results = {};
for (const id of IDS) {
  const between = sd(pop.map((r) => r.skin[id]).filter(Number.isFinite));
  // Pool within-person variance across people, so one noisy subject cannot
  // define the result
  let ss = 0;
  let df = 0;
  for (const g of groups) {
    const v = g.map((r) => r.skin[id]).filter(Number.isFinite);
    if (v.length < 2) continue;
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    ss += v.reduce((a, b) => a + (b - m) ** 2, 0);
    df += v.length - 1;
  }
  const within = df ? Math.sqrt(ss / df) : null;
  const rel = between && within ? Math.max(0, 1 - (within / between) ** 2) : 0;
  results[id] = { between, within, rel };
  const verdict = rel >= 0.5 ? "USABLE" : rel >= 0.25 ? "weak" : "PHOTOGRAPHY, NOT SKIN";
  console.log(
    `${id.padEnd(16)} ${(between ?? 0).toFixed(4).padStart(9)}  ${(within ?? 0).toFixed(4).padStart(9)}   ` +
      `${rel.toFixed(3).padStart(9)}   ${verdict}`,
  );
}

console.log("\nFor comparison, the geometry metrics already in the score sit at 0.3-0.7.");
console.log("Anything below 0.25 must not influence the overall — it would make");
console.log("week-over-week deltas worse, which is the one thing the product promises.\n");

const cov = pop.map((r) => r.skin.coverage).sort((a, b) => a - b);
console.log(`coverage p10 ${cov[Math.floor(cov.length * 0.1)]?.toFixed(3)} median ${cov[cov.length >> 1]?.toFixed(3)}`);
process.exit(0);
