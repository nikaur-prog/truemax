// Are the celebrities being compared against a fair reference?
//
// AGG_NORM is built from ~110 people notable for their work rather than their
// appearance, which is the right idea. But those measurements came from one
// photograph each, and the photograph of a central banker on Wikipedia is an
// official portrait: studio light, neutral mouth, straight at the lens, shot
// by someone paid to make it flattering. The photographs of the celebrities in
// the reel are press candids.
//
// If the scale was calibrated on one genre of photograph and is being applied
// to another, then "Margot Robbie is a 4.7" may be measuring the difference
// between a press pit and a portrait studio rather than anything about a face.
//
// So: pull CANDID Commons photographs of the reference-population people, by
// exactly the same route and filters used for the celebrities, and score them.
// Matched sourcing on both sides. Then the comparison means something.
//
//   If the reference people also drop when shot candidly, the calibration is
//   genre-confounded and the whole scale is shifted for real users.
//
//   If they hold up, the genre is not the problem and the metric set simply
//   does not separate these two groups, which is a much deeper finding.
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";

const APP = "/home/user/truemax";
const S = "/tmp/claude-0/-home-user-truemax/d2e733fd-a214-5db9-ad53-45f992c4158c/scratchpad";
const CACHE = `${S}/ref-photos`;
mkdirSync(CACHE, { recursive: true });
const UA = "TrueMax-calibration/1.0 (support@ascendnz.online)";

// Drawn from tools/population-list.mjs, spread across the fields it uses so
// this is not accidentally a sample of one profession's press photography.
const REF = [
  ["Justin Trudeau", "male"], ["Pete Buttigieg", "male"], ["Emmanuel Macron", "male"],
  ["Neil deGrasse Tyson", "male"], ["Demis Hassabis", "male"], ["Sundar Pichai", "male"],
  ["Jacinda Ardern", "female"], ["Christine Lagarde", "female"], ["Jennifer Doudna", "female"],
  ["Ursula von der Leyen", "female"], ["Condoleezza Rice", "female"], ["Frances Arnold", "female"],
];
const OK = /^(cc0|cc[- ]by([- ]sa)?([- ]\d(\.\d)?)?|public domain|pd-)/i;

function q(params) {
  const url = "https://commons.wikimedia.org/w/api.php?" + new URLSearchParams({
    ...params, prop: "imageinfo", iiprop: "url|extmetadata", iiurlwidth: "900", format: "json",
  });
  try { return JSON.parse(execFileSync("curl", ["-sSL", "-A", UA, url], { encoding: "utf8", timeout: 45000, maxBuffer: 3e7 })); }
  catch { return null; }
}

function candidates(name) {
  const seen = new Map();
  const take = (d) => {
    for (const p of Object.values(d?.query?.pages ?? {})) {
      const ii = p.imageinfo?.[0];
      if (!ii || !/\.(jpe?g|png)$/i.test(p.title)) continue;
      const lic = (ii.extmetadata?.LicenseShortName?.value ?? "").trim();
      if (!OK.test(lic)) continue;
      const t = p.title.replace(/^File:/, "");
      if (!seen.has(t)) seen.set(t, { title: t, url: ii.thumburl ?? ii.url });
    }
  };
  take(q({ action: "query", generator: "categorymembers", gcmtitle: `Category:Portraits of ${name}`, gcmtype: "file", gcmlimit: "30" }));
  take(q({ action: "query", generator: "categorymembers", gcmtitle: `Category:${name}`, gcmtype: "file", gcmlimit: "30" }));
  take(q({ action: "query", generator: "search", gsrsearch: name, gsrlimit: "40", gsrnamespace: "6" }));
  return [...seen.values()];
}

const server = spawn("npx", ["vite", "preview", "--port", "4394", "--strictPort"], { cwd: APP, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 3500));
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const rows = [];
try {
  const page = await b.newPage();
  await page.goto("http://localhost:4394/");
  await page.waitForSelector("#engine-status.ready", { timeout: 60000 });

  for (const [name, sex] of REF) {
    let n = 0;
    for (const c of candidates(name)) {
      if (n >= 12) break;
      const path = `${CACHE}/${c.title.replace(/[^A-Za-z0-9.]+/g, "_").slice(-60)}`;
      if (!existsSync(path)) {
        try { execFileSync("curl", ["-sSL", "-A", UA, "-o", path, c.url], { timeout: 50000 }); } catch { continue; }
      }
      let m;
      try {
        const b64 = execFileSync("base64", ["-w0", path], { encoding: "utf8", maxBuffer: 8e7 });
        m = await page.evaluate(async ([u, s]) => await window.__truemaxMeasure(u, s), [`data:image/jpeg;base64,${b64}`, sex]);
      } catch { continue; }
      if (!m?.faceFound || m.faceWidthFrac < 0.18) continue;
      rows.push({ person: name, sex, group: "reference", file: c.title, overall: m.overall,
        yaw: +m.yaw.toFixed(1), smile: +m.smile.toFixed(2) });
      n++;
    }
    const v = rows.filter((r) => r.person === name);
    console.log(`${name.padEnd(22)} n=${String(v.length).padStart(2)}  mean ${v.length ? (v.reduce((s, x) => s + x.overall, 0) / v.length).toFixed(2) : "--"}`);
  }
} finally { await b.close(); server.kill(); }

writeFileSync(`${S}/reference-fairness.json`, JSON.stringify(rows, null, 1));

const celeb = JSON.parse(readFileSync(`${S}/photo-spread.json`, "utf8"));
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const sd = (a) => Math.sqrt(mean(a.map((x) => (x - mean(a)) ** 2)));

console.log("\n============ matched sourcing, both groups from Commons ============");
for (const [label, set] of [["reference (notable for work)", rows], ["celebrities (reel faces)", celeb]]) {
  const byPerson = {};
  for (const r of set) (byPerson[r.person] ??= []).push(r.overall);
  const personMeans = Object.values(byPerson).map(mean);
  console.log(`${label.padEnd(30)} people ${String(personMeans.length).padStart(2)}  photos ${String(set.length).padStart(3)}  ` +
    `mean ${mean(set.map((r) => r.overall)).toFixed(2)}  per-person mean spread ${sd(personMeans).toFixed(2)}`);
}
const refAll = rows.map((r) => r.overall);
const celAll = celeb.map((r) => r.overall);
const pooled = Math.sqrt((sd(refAll) ** 2 + sd(celAll) ** 2) / 2);
console.log(`\nCohen's d, celebrities vs reference, matched sourcing: ${((mean(celAll) - mean(refAll)) / pooled).toFixed(3)}`);
console.log("(d near zero means the engine cannot tell the two groups apart on candid photographs.)");
process.exit(0);
