// Is it the photos, or is it the engine?
//
// The reel scores one photograph per person and 7 of the 9 photographs would
// trip the app's own capture warnings (mostly a wide red-carpet grin; the app
// tells users a smile shifts mouth and jaw measurements). That makes "the
// photo is bad" the obvious hypothesis, but obvious is not measured.
//
// So: pull every Commons portrait we can find of a handful of these people,
// score all of them, and look at the spread. Two outcomes, and they point in
// opposite directions.
//
//   If the neutral, front-on, mouth-closed photos score materially higher than
//   the grinning ones, the reel is fixable by re-sourcing photographs.
//
//   If the spread is wide but uncorrelated with capture quality, then a single
//   photograph cannot place an individual and no amount of re-sourcing fixes
//   the reel — only saying so does.
import { launchChromium } from "./launchChromium.mjs";
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";

const APP = "/home/user/truemax";
const S = "/tmp/claude-0/-home-user-truemax/d2e733fd-a214-5db9-ad53-45f992c4158c/scratchpad";
const CACHE = `${S}/alt-photos2`;
mkdirSync(CACHE, { recursive: true });
const UA = "TrueMax-calibration/1.0 (support@ascendnz.online)";

const WHO = [
  { name: "Henry Cavill", sex: "male" },
  { name: "Timothée Chalamet", sex: "male" },
  { name: "Michael B. Jordan", sex: "male" },
  { name: "Jason Momoa", sex: "male" },
  { name: "Cillian Murphy", sex: "male" },
  { name: "Idris Elba", sex: "male" },
  { name: "Zendaya", sex: "female" },
  { name: "Anya Taylor-Joy", sex: "female" },
  { name: "Rihanna", sex: "female" },
  { name: "Gal Gadot", sex: "female" },
  { name: "Margot Robbie", sex: "female" },
  { name: "Chris Hemsworth", sex: "male" },
  { name: "Henry Cavill", sex: "male" },
  { name: "Sydney Sweeney", sex: "female" },
];
const OK_LICENCE = /^(cc0|cc[- ]by([- ]sa)?([- ]\d(\.\d)?)?|public domain|pd-)/i;

// Three sources, merged and de-duplicated, because any one of them alone
// under-reports badly. "Category:<name>" holds only the handful of files not
// filed into a subcategory (two, for Margot Robbie), which is what made the
// first run of this script conclude there were almost no photographs of some
// of the most photographed people alive.
function query(params) {
  const url = "https://commons.wikimedia.org/w/api.php?" + new URLSearchParams({
    ...params, prop: "imageinfo", iiprop: "url|extmetadata", iiurlwidth: "900", format: "json",
  });
  try { return JSON.parse(execFileSync("curl", ["-sS", "-A", UA, url], { encoding: "utf8", timeout: 40000 })); }
  catch { return null; }
}

function commonsFiles(name) {
  const seen = new Map();
  const collect = (d) => {
    for (const p of Object.values(d?.query?.pages ?? {})) {
      const ii = p.imageinfo?.[0];
      if (!ii || !/\.(jpe?g|png)$/i.test(p.title)) continue;
      const lic = (ii.extmetadata?.LicenseShortName?.value ?? "").trim();
      if (!OK_LICENCE.test(lic)) continue;
      const title = p.title.replace(/^File:/, "");
      if (!seen.has(title)) seen.set(title, { title, url: ii.thumburl ?? ii.url, licence: lic });
    }
  };
  // Commons files portrait photography separately, and that subcategory is
  // exactly the shot type this product wants.
  collect(query({ action: "query", generator: "categorymembers", gcmtitle: `Category:Portraits of ${name}`, gcmtype: "file", gcmlimit: "30" }));
  collect(query({ action: "query", generator: "categorymembers", gcmtitle: `Category:${name}`, gcmtype: "file", gcmlimit: "30" }));
  collect(query({ action: "query", generator: "search", gsrsearch: name, gsrlimit: "40", gsrnamespace: "6" }));
  return [...seen.values()];
}

const server = spawn("npx", ["vite", "preview", "--port", "4398", "--strictPort"], { cwd: APP, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 3500));
const b = await launchChromium();
const all = [];
try {
  const page = await b.newPage();
  await page.goto("http://localhost:4398/");
  await page.waitForSelector("html[data-engine=\"ready\"]", { timeout: 60000 });

  for (const person of WHO) {
    const files = commonsFiles(person.name);
    console.log(`\n${person.name}: ${files.length} shippable Commons images`);
    let n = 0;
    for (const f of files) {
      const safe = f.title.replace(/[^A-Za-z0-9.]+/g, "_").slice(-60);
      const path = `${CACHE}/${safe}`;
      if (!existsSync(path)) {
        try { execFileSync("curl", ["-sSL", "-A", UA, "-o", path, f.url], { timeout: 45000 }); }
        catch { continue; }
      }
      let m;
      try {
        const buf = execFileSync("base64", ["-w0", path], { encoding: "utf8", maxBuffer: 6e7 });
        m = await page.evaluate(async ([u, s]) => await window.__truemaxMeasure(u, s),
          [`data:image/jpeg;base64,${buf}`, person.sex]);
      } catch { continue; }
      // A face filling little of the frame is somebody else in a group shot.
      if (!m?.faceFound || m.faceWidthFrac < 0.18) continue;
      const clean = Math.abs(m.yaw) <= 28 && Math.abs(m.pitch) <= 26 && m.smile <= 0.35;
      all.push({ person: person.name, sex: person.sex, file: f.title, overall: m.overall,
        yaw: +m.yaw.toFixed(1), pitch: +m.pitch.toFixed(1), smile: +m.smile.toFixed(2), clean });
      n++;
      if (n >= 18) break;
    }
  }
} finally { await b.close(); server.kill(); }

writeFileSync(`${S}/photo-spread2.json`, JSON.stringify(all, null, 1));

const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const sd = (a) => Math.sqrt(mean(a.map((x) => (x - mean(a)) ** 2)));
console.log("\n=================== per person ===================");
for (const p of WHO) {
  const v = all.filter((r) => r.person === p.name);
  if (!v.length) { console.log(`${p.name}: nothing scored`); continue; }
  const cleanScores = v.filter((r) => r.clean).map((r) => r.overall);
  const dirty = v.filter((r) => !r.clean).map((r) => r.overall);
  console.log(
    `\n${p.name}  n=${v.length}  range ${Math.min(...v.map((r) => r.overall)).toFixed(1)}–${Math.max(...v.map((r) => r.overall)).toFixed(1)}  SD ${sd(v.map((r) => r.overall)).toFixed(2)}`,
  );
  console.log(`  passes capture gate (n=${cleanScores.length}): mean ${cleanScores.length ? mean(cleanScores).toFixed(2) : "—"}`);
  console.log(`  fails  capture gate (n=${dirty.length}): mean ${dirty.length ? mean(dirty).toFixed(2) : "—"}`);
  for (const r of v.sort((a, b) => b.overall - a.overall).slice(0, 6)) {
    console.log(`    ${String(r.overall).padStart(4)}  ${r.clean ? "CLEAN" : "     "}  yaw ${String(r.yaw).padStart(6)} smile ${String(r.smile).padStart(5)}  ${r.file.slice(0, 58)}`);
  }
}
const c = all.filter((r) => r.clean).map((r) => r.overall);
const d = all.filter((r) => !r.clean).map((r) => r.overall);
console.log(`\nPOOLED  clean n=${c.length} mean ${mean(c).toFixed(2)}   |   flagged n=${d.length} mean ${mean(d).toFixed(2)}`);
console.log(`Difference attributable to capture quality: ${(mean(c) - mean(d)).toFixed(2)} points`);
process.exit(0);
