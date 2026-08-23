// Re-crop the demo reel's photographs at a higher resolution, WITHOUT touching
// the generated data.
//
// Why this exists rather than just re-running build-demo-reel.mjs: that tool
// regenerates the images and src/ui/demoReelData.ts as one unit, so a re-run
// can legitimately pick a differently-captured photograph and ship a different
// score for a celebrity. That is the tool working as designed, and it is not
// what "the pictures are soft" asks for. This script changes pixels only.
//
// The measurement that made it necessary: the landing reel's canvas is
// 903x1131 device pixels on a phone at dpr 3, and the source images are
// 440x550 — a 2.05x upscale on the most prominent surface in the product.
//
// HOW IT STAYS HONEST. It has no record of which Commons file each face
// originally used, so it re-derives the candidate set the same way and picks
// by the same capture-quality cost. If it has landed on the same photograph,
// the engine gives the same score as the one already stored in demoReelData —
// so the stored score IS the check. A face whose score does not match is left
// exactly as it was and reported, because a new crop under old landmark data
// would misplace every region callout on the reel.
//
//   node tools/resize-demo-images.mjs           # all faces
//   node tools/resize-demo-images.mjs --dry     # report only, write nothing
//
// Requires a built dist/ (npm run build) — it drives the real engine through
// vite preview, the same way build-demo-reel.mjs does.
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import sharp from "sharp";
import { REEL } from "../src/ui/demoReelData.js";

const APP_DIR = "/home/user/truemax";
const OUT_IMG = `${APP_DIR}/public/demo`;
const CACHE = `${APP_DIR}/.reel-cache`;
const UA = "TrueMax/0.2 (demo reel builder; support@ascendnz.online)";
const DRY = process.argv.includes("--dry");

// The target. 880x1100 covers the phone reel canvas (903x1131 at dpr 3) with
// nothing to spare, which is the right place to stop: every pixel beyond what
// the largest surface asks for is weight on a landing page.
const OUT_W = 880;
const OUT_H = 1100;

// Commons thumbnails, requested wide enough that the face crop has real detail
// rather than being a bigger upscale of the same pixels. build-demo-reel asks
// for 1400 and then throws most of it away at 440 wide; a head crop is roughly
// a third of a portrait's width, so 2600 is what 880 of face actually needs.
const THUMB_W = 2600;

// Same cost function as the builder. Copied rather than imported because that
// module runs a whole pipeline on import.
const captureCost = (m) => m.smile * 3 + Math.abs(m.yaw) / 28 + Math.abs(m.pitch) / 26;
const SHIPPABLE = /^(cc0|cc[- ]by([- ]sa)?([- ]\d(\.\d)?)?|public domain|pd-)/i;
const strip = (s) => String(s ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const CANDIDATES = Number(process.env.TM_CANDIDATES ?? 20);

// Wikimedia rate-limits by source IP, and it does so hard: from a shared cloud
// egress this hits 429 even at one request every twenty seconds. So requests
// are serialised with a gap, a 429 backs off and retries rather than being
// swallowed as "no candidates", and the script says which it was — an empty
// candidate list and a throttled one look identical otherwise, and that is
// exactly the confusion that makes this look like a code bug.
const GAP_MS = Number(process.env.TM_GAP_MS ?? 1200);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;
let throttled = 0;

async function api(params) {
  const url = "https://commons.wikimedia.org/w/api.php?" + new URLSearchParams({
    ...params, prop: "imageinfo", iiprop: "url|extmetadata", iiurlwidth: String(THUMB_W), format: "json",
  });
  for (let attempt = 0; attempt < 5; attempt++) {
    const since = Date.now() - lastCall;
    if (since < GAP_MS) await sleep(GAP_MS - since);
    lastCall = Date.now();
    let body;
    try {
      body = execFileSync("curl", ["-sSL", "-A", UA, url], { encoding: "utf8", timeout: 45000, maxBuffer: 6e7 });
    } catch {
      return null;
    }
    if (/^\s*You are making too many requests/.test(body)) {
      throttled++;
      await sleep(15000 * 2 ** attempt);
      continue;
    }
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
  return null;
}

async function candidatesFor(name) {
  const seen = new Map();
  const collect = (d) => {
    for (const p of Object.values(d?.query?.pages ?? {})) {
      const ii = p.imageinfo?.[0];
      if (!ii || !/\.(jpe?g|png)$/i.test(p.title)) continue;
      const md = ii.extmetadata ?? {};
      const licence = strip(md.LicenseShortName?.value);
      if (!SHIPPABLE.test(licence)) continue;
      const title = p.title.replace(/^File:/, "");
      if (seen.has(title)) continue;
      seen.set(title, { title, url: ii.thumburl ?? ii.url, licence, artist: strip(md.Artist?.value) || "Unknown" });
    }
  };
  collect(await api({ action: "query", generator: "categorymembers", gcmtitle: `Category:Portraits of ${name}`, gcmtype: "file", gcmlimit: "40" }));
  collect(await api({ action: "query", generator: "categorymembers", gcmtitle: `Category:${name}`, gcmtype: "file", gcmlimit: "40" }));
  collect(await api({ action: "query", generator: "search", gsrsearch: name, gsrlimit: "40", gsrnamespace: "6" }));
  return [...seen.values()];
}

function download(c) {
  // Keyed by width as well as title: the 1400px copies build-demo-reel left
  // behind must not be handed back for a job that asked for 2600.
  const path = `${CACHE}/w${THUMB_W}_${c.title.replace(/[^A-Za-z0-9.]+/g, "_").slice(-70)}`;
  if (!existsSync(path)) {
    try { execFileSync("curl", ["-sSL", "-A", UA, "-o", path, c.url], { timeout: 90000 }); }
    catch { return null; }
  }
  return path;
}

mkdirSync(CACHE, { recursive: true });
const server = spawn("npx", ["vite", "preview", "--port", "4207", "--strictPort"], { cwd: APP_DIR, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 3500));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

const report = [];
try {
  const page = await browser.newPage();
  await page.goto("http://localhost:4207/");
  await page.waitForSelector("#engine-status.ready", { timeout: 60000 });

  for (const face of REEL) {
    const measured = [];
    const cands = await candidatesFor(face.name);
    if (!cands.length) {
      report.push({ name: face.name, status: throttled ? "no candidates — the Commons API is rate-limiting this IP" : "no shippable candidates on Commons", wrote: false });
      continue;
    }
    for (const c of cands) {
      if (measured.length >= CANDIDATES) break;
      const path = download(c);
      if (!path) continue;
      let m;
      try {
        const b64 = execFileSync("base64", ["-w0", path], { encoding: "utf8", maxBuffer: 2e8 });
        m = await page.evaluate(async ([u, s]) => {
          const r = await window.__truemaxMeasure(u, s);
          if (!r.faceFound) return null;
          return { overall: r.overall, box: r.reelBox, yaw: r.yaw, pitch: r.pitch, smile: r.smile, widthFrac: r.faceWidthFrac };
        }, [`data:image/jpeg;base64,${b64}`, face.sex]);
      } catch { continue; }
      if (!m || m.widthFrac < 0.2) continue;
      measured.push({ ...m, ...c, path, cost: captureCost(m) });
    }

    if (!measured.length) {
      report.push({ name: face.name, status: "no candidates measurable", wrote: false });
      continue;
    }
    measured.sort((a, b) => a.cost - b.cost);
    const pick = measured[0];

    // The stored score is the proof of identity. Same photograph through the
    // same engine gives the same number; a different number means a different
    // photograph, and the landmark data on file no longer describes it.
    if (Math.abs(pick.overall - face.overall) > 0.05) {
      report.push({
        name: face.name, status: `picked a different photo (${pick.overall.toFixed(1)} vs stored ${face.overall.toFixed(1)}) — left alone`,
        wrote: false,
      });
      continue;
    }

    // Exactly the builder's crop geometry, so the crop-relative landmarks in
    // demoReelData still land where they did.
    const meta = await sharp(pick.path).metadata();
    const pad = 0.34;
    const x = Math.max(0, Math.round((pick.box.x - pick.box.w * pad) * meta.width));
    const y = Math.max(0, Math.round((pick.box.y - pick.box.h * pad * 1.1) * meta.height));
    const w = Math.min(meta.width - x, Math.round(pick.box.w * (1 + pad * 2) * meta.width));
    const h = Math.min(meta.height - y, Math.round(pick.box.h * (1 + pad * 2.2) * meta.height));

    // Never manufacture detail. If the crop is smaller than the target, ship
    // it at its own size rather than upscaling — the point of this script is
    // to stop shipping upscales.
    const scale = Math.min(1, w / OUT_W, h / OUT_H);
    const outW = Math.round(OUT_W * scale);
    const outH = Math.round(OUT_H * scale);

    const before = await sharp(`${OUT_IMG}/${face.slug}.jpg`).metadata();
    if (!DRY) {
      await sharp(pick.path).extract({ left: x, top: y, width: w, height: h })
        .resize(outW, outH, { fit: "cover", kernel: "lanczos3" })
        .jpeg({ quality: 82, mozjpeg: true })
        .toFile(`${OUT_IMG}/${face.slug}.jpg`);
    }
    report.push({
      name: face.name,
      status: `${before.width}x${before.height} -> ${outW}x${outH}` + (scale < 1 ? ` (source crop only ${w}x${h})` : ""),
      wrote: !DRY,
    });
  }
} finally {
  await browser.close();
  server.kill();
}

for (const r of report) console.log(`${r.wrote ? "ok  " : "SKIP"} ${r.name.padEnd(20)} ${r.status}`);
if (throttled) {
  console.log(`\n${throttled} request(s) were rate-limited by Wikimedia. That is per source IP, and a shared`);
  console.log("cloud egress can be throttled past the point of usefulness — run this from a normal");
  console.log("connection, or raise the gap: TM_GAP_MS=5000 npx tsx tools/resize-demo-images.mjs");
}
const wrote = report.filter((r) => r.wrote).length;
console.log(`\n${wrote}/${REEL.length} rewritten${DRY ? " (dry run — nothing written)" : ""}`);
