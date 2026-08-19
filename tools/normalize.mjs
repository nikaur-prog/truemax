// Generate src/engine/aggNorm.ts: empirical quantile tables for every
// aggregate z, measured across the general-population reference set.
//
// Scoring interpolates a face's position in these tables to get a true
// percentile, then converts that to a score. Anchoring to the sample's actual
// distribution (rather than assuming it is normal) is what keeps the median at
// 5.0 AND stops the heavy upper tail from inflating top scores.
//
// Run AFTER apply.mjs, then rebuild.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const DATA = process.env.TM_DATA ?? fileURLToPath(new URL("../.calib/", import.meta.url));
const CHROME = process.env.TM_CHROME ?? [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/opt/pw-browsers/chromium",
].find(existsSync);
if (!CHROME) throw new Error("No Chrome executable found. Set TM_CHROME.");
const pop = JSON.parse(readFileSync(DATA + "pop-manifest.json", "utf8"));

// The smile gate used to sit at 0.7 and it introduced a sex-correlated
// selection bias severe enough to break the scale: it rejected 45 of 59 female
// reference faces against 22 of 58 male, because women in press photography
// smile far more often. The 13 women who survived were not a sample of women,
// they were a sample of women who were not smiling — and the female quantile
// table built from them sat 0.4 sigma high, inflating every female score.
//
// A larger sample with a small shared bias beats a tiny clean one: at n=13 the
// sampling error on a 21-point quantile table dwarfs anything a smile does to
// the mouth metrics. Pose and framing gates stay, since those distort geometry
// in ways that do not cancel.
const GATE = { yaw: 25, pitch: 22, smile: 1.01, face: 0.2 };

const PORT = Number(process.env.TM_PORT ?? 4186);
const server = spawn(
  "npx",
  ["vite", "preview", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
  { cwd: APP_DIR, stdio: "ignore" },
);
// Poll rather than sleeping a fixed 2.5s. A cold `npx vite preview` can take
// longer than that, and the failure mode was a whole reference scan aborting
// on connection refused after the photos were already fetched.
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break;
  } catch {
    // Still starting.
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (i === 59) throw new Error("Preview server did not start");
}
const browser = await chromium.launch({ executablePath: CHROME });

const bySex = { male: [], female: [] };
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForSelector("#engine-status.ready", { timeout: 30000 });

  for (const { name, sex, file } of pop) {
    try {
      const url = `data:image/jpeg;base64,${readFileSync(file).toString("base64")}`;
      const m = await page.evaluate(async ([u, s]) => await window.__truemaxMeasure(u, s), [url, sex]);
      if (!m?.faceFound) continue;
      if (Math.abs(m.yaw) > GATE.yaw || Math.abs(m.pitch) > GATE.pitch) continue;
      if (m.smile > GATE.smile || m.faceWidthFrac < GATE.face) continue;
      bySex[sex].push(m.zScores);
    } catch {
      console.log(`skip ${name}`);
    }
  }
} finally {
  await browser.close();
  server.kill();
}

const QUANTILES = Array.from({ length: 21 }, (_, i) => i / 20);
const out = { male: {}, female: {} };

// What the shipped file currently holds, so a thin scan can carry a sex
// forward instead of erasing it. "Leaving it unnormalized" used to mean
// writing `male: {}` — which does not leave the old table in place, it
// deletes it, and normalizeAgg then silently falls back to the raw z with no
// quantile mapping at all. A tool whose stated safe path is a catastrophic
// regression is worse than one that refuses.
const previous = (() => {
  try {
    const src = readFileSync(APP_DIR + "/src/engine/aggNorm.ts", "utf8");
    const grab = (sex) => {
      const start = src.indexOf(`${sex}: {`);
      const end = src.indexOf("},", start);
      const body = src.slice(start, end);
      const table = {};
      for (const [, key, nums] of body.matchAll(/"([^"]+)":\s*\[([^\]]+)\]/g)) {
        table[key] = nums.split(",").map(Number);
      }
      return table;
    };
    return { male: grab("male"), female: grab("female") };
  } catch {
    return { male: {}, female: {} };
  }
})();

for (const sex of ["male", "female"]) {
  const rows = bySex[sex];
  console.log(`${sex}: ${rows.length} reference faces`);
  if (rows.length < 8) {
    const kept = Object.keys(previous[sex]).length;
    if (!kept) throw new Error(`${sex}: only ${rows.length} faces and no existing table to keep`);
    console.log(`  too few — KEEPING the existing ${sex} table (${kept} keys) unchanged`);
    out[sex] = previous[sex];
    continue;
  }
  for (const key of Object.keys(rows[0])) {
    const vals = rows.map((r) => r[key]).filter(Number.isFinite).sort((a, b) => a - b);
    out[sex][key] = QUANTILES.map((p) => {
      const idx = p * (vals.length - 1);
      const lo = Math.floor(idx);
      const hi = Math.ceil(idx);
      return +(vals[lo] + (vals[hi] - vals[lo]) * (idx - lo)).toFixed(4);
    });
  }
  // The overall table's span is the number that decides whether real faces
  // fall off the edge and get scored by extrapolation instead of evidence.
  // Print it against what it was, so a rebuild's effect is visible here
  // rather than discovered later from a user's screenshot.
  const o = out[sex].overall;
  const p = previous[sex].overall;
  if (o) {
    console.log(
      `  overall spans ${o[0].toFixed(3)} … ${o[o.length - 1].toFixed(3)}` +
        (p ? `  (was ${p[0].toFixed(3)} … ${p[p.length - 1].toFixed(3)})` : ""),
    );
  }
}

const body = ["male", "female"]
  .map((sex) => {
    const rows = Object.entries(out[sex])
      .map(([k, v]) => `    ${JSON.stringify(k)}: [${v.join(",")}],`)
      .join("\n");
    return `  ${sex}: {\n${rows}\n  },`;
  })
  .join("\n");

writeFileSync(
  APP_DIR + "/src/engine/aggNorm.ts",
  `import type { Sex } from "./types.js";

// GENERATED by tools/normalize.mjs — do not hand-edit.
//
// Empirical quantiles (0, 0.05, … 1.00) of each aggregate z across the
// general-population reference set — people notable for their work, not their
// appearance. Scoring interpolates a face's position in this table to get a
// real percentile, so "5.0 = 50th percentile" holds by construction and the
// distribution's heavy tails cannot inflate the top of the scale.
export const AGG_NORM: Record<Sex, Record<string, number[]>> = {
${body}
};
`,
);
console.log("wrote src/engine/aggNorm.ts");
process.exit(0);
