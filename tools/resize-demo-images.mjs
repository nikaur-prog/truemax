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
import { launchChromium } from "./launchChromium.mjs";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import sharp from "sharp";
import { REEL } from "../src/ui/demoReelData.js";

// Derived from this file's own location, not hardcoded. It used to be an
// absolute sandbox path, which meant the tool ran only on the one machine it
// was written on and died with ERR_MODULE_NOT_FOUND-style confusion anywhere
// else — including the laptop that actually has the network access this needs.
const APP_DIR = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const OUT_IMG = `${APP_DIR}/public/demo`;
const CACHE = `${APP_DIR}/.reel-cache`;
const UA = "TrueMax/0.2 (demo reel builder; support@ascendnz.online)";
const DRY = process.argv.includes("--dry");

// The target. 880x1100 covers the phone reel canvas (903x1131 at dpr 3) with
// nothing to spare, which is the right place to stop: every pixel beyond what
// the largest surface asks for is weight on a landing page.
const OUT_W = 880;
const OUT_H = 1100;

// Two thumbnail widths, and the distinction is the whole method.
//
// IDENTITY is established at 1400 — the width build-demo-reel measured — and
// nowhere else. The first version of this tool measured 2600px thumbnails and
// found that EVERY face "picked a different photo": the capture-cost ranking
// (smile, yaw, pitch) shifts with input resolution, so at a different width a
// different candidate wins, and the honesty check correctly refused all nine.
// Same photograph, same width, same engine → same score and the SAME crop box,
// which is what keeps the stored landmark data aligned with the new pixels.
//
// OUTPUT is cut from a fresh download of the matched file, using the crop
// geometry from the 1400 measurement.
//
// The output width is computed per face rather than fixed. A fixed 2600 was the
// first attempt and it silently under-delivered on every face: the crop is a
// sub-region, so a 2600px source with a head occupying a quarter of the frame
// yields a 650px crop — smaller than the 880 being asked for, and the script
// then correctly refused to upscale and shipped something no bigger than what
// it replaced. What matters is the width of the CROP, so ask the source for
// whatever width makes the crop land on target, with a ceiling for the rare
// photograph where the face is a tiny part of a huge image.
const MEASURE_W = 1400;
const MAX_SOURCE_W = 8000;

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

async function api(params, thumbWidth) {
  const url = "https://commons.wikimedia.org/w/api.php?" + new URLSearchParams({
    ...params, prop: "imageinfo", iiprop: "url|extmetadata", iiurlwidth: String(thumbWidth), format: "json",
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

async function candidatesFor(name, thumbWidth) {
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
  collect(await api({ action: "query", generator: "categorymembers", gcmtitle: `Category:Portraits of ${name}`, gcmtype: "file", gcmlimit: "40" }, thumbWidth));
  collect(await api({ action: "query", generator: "categorymembers", gcmtitle: `Category:${name}`, gcmtype: "file", gcmlimit: "40" }, thumbWidth));
  collect(await api({ action: "query", generator: "search", gsrsearch: name, gsrlimit: "40", gsrnamespace: "6" }, thumbWidth));
  return [...seen.values()];
}

function download(c, thumbWidth) {
  // Keyed by width as well as title: a 1400px copy must never be handed back
  // for a request that asked for 2600, or the "high-res" output would be an
  // upscale with a confident filename.
  const path = `${CACHE}/w${thumbWidth}_${c.title.replace(/[^A-Za-z0-9.]+/g, "_").slice(-70)}`;
  if (!existsSync(path)) {
    try { execFileSync("curl", ["-sSL", "-A", UA, "-o", path, c.url], { timeout: 90000 }); }
    catch { return null; }
  }
  return path;
}

mkdirSync(CACHE, { recursive: true });
const server = spawn("npx", ["vite", "preview", "--port", "4207", "--strictPort"], { cwd: APP_DIR, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 3500));
const browser = await launchChromium();

const report = [];
// Printed as each face resolves, not held to the end. This run is slow by
// design -- it paces itself under Wikimedia's rate limit -- so a crash or a
// Ctrl-C at face eight of nine would otherwise throw away everything it had
// already established.
// `ok` for written, `would` for a dry run that found a usable crop, `SKIP` for a
// face genuinely being left alone. The first version printed SKIP for everything
// in a dry run, including the faces it had matched and sized perfectly — which
// reads as nine failures rather than as a preview, and is the opposite of what
// a dry run is for.
const line = (name, status, wrote, usable = wrote) => {
  report.push({ name, status, wrote });
  const tag = wrote ? "ok   " : usable ? "would" : "SKIP ";
  console.log(`${tag} ${String(name).padEnd(20)} ${status}`);
};

try {
  const page = await browser.newPage();
  await page.goto("http://localhost:4207/");
  await page.waitForSelector("html[data-engine=\"ready\"]", { timeout: 60000 });

  for (const face of REEL) {
    const measured = [];
    const cands = await candidatesFor(face.name, MEASURE_W);
    if (!cands.length) {
      line(face.name, throttled ? "no candidates — the Commons API is rate-limiting this IP" : "no shippable candidates on Commons", false);
      continue;
    }
    for (const c of cands) {
      if (measured.length >= CANDIDATES) break;
      const path = download(c, MEASURE_W);
      if (!path) continue;
      let m;
      try {
        // Encoded in-process. Shelling out to `base64 -w0` is GNU-only: BSD
        // base64 on macOS rejects -w and prints its usage, which showed up as
        // every candidate silently failing to measure.
        const b64 = readFileSync(path).toString("base64");
        m = await page.evaluate(async ([u, s]) => {
          const r = await window.__truemaxMeasure(u, s);
          if (!r.faceFound) return null;
          return { overall: r.overall, box: r.reelBox, lm: r.reelLandmarks, widthFrac: r.faceWidthFrac };
        }, [`data:image/jpeg;base64,${b64}`, face.sex]);
      } catch { continue; }
      if (!m || m.widthFrac < 0.2) continue;

      // IDENTITY BY LANDMARKS, not by score and never by capture cost. The
      // stored `points` are the original photo's landmarks expressed relative
      // to its crop; recomputing the same projection for a candidate and
      // comparing is a fingerprint of the actual pixels. A score matches by
      // coincidence at one-decimal granularity; 130-odd landmark positions do
      // not. And because the stored points ARE the comparison target, a match
      // guarantees the new crop aligns with the callout data by construction.
      let meta;
      try {
        meta = await sharp(path).metadata();
      } catch {
        continue; // not an image — a rate-limit page saved under a .jpg name
      }
      const pad = 0.34;
      const x = Math.max(0, Math.round((m.box.x - m.box.w * pad) * meta.width));
      const y = Math.max(0, Math.round((m.box.y - m.box.h * pad * 1.1) * meta.height));
      const w = Math.min(meta.width - x, Math.round(m.box.w * (1 + pad * 2) * meta.width));
      const h = Math.min(meta.height - y, Math.round(m.box.h * (1 + pad * 2.2) * meta.height));
      if (!Array.isArray(m.lm) || m.lm.length !== face.points.length) continue;
      let sum = 0;
      for (let i = 0; i < m.lm.length; i++) {
        const rx = (m.lm[i][0] * meta.width - x) / w;
        const ry = (m.lm[i][1] * meta.height - y) / h;
        sum += Math.hypot(rx - face.points[i][0], ry - face.points[i][1]);
      }
      measured.push({ ...c, meanDist: sum / m.lm.length, overall: m.overall, frac: { x: x / meta.width, y: y / meta.height, w: w / meta.width, h: h / meta.height } });
      // Close enough to be beyond argument — stop paying for more downloads.
      if (measured[measured.length - 1].meanDist < 0.005) break;
    }

    if (!measured.length) {
      line(face.name, "no candidates measurable", false);
      continue;
    }
    measured.sort((a, b) => a.meanDist - b.meanDist);
    const pick = measured[0];
    // 2% of the crop, averaged over every landmark, is far beyond engine
    // jitter on identical pixels but far inside the gap to a different
    // photograph of the same person.
    if (pick.meanDist > 0.02) {
      line(face.name, `original photo not among ${measured.length} measurable candidates (closest off by ${(pick.meanDist * 100).toFixed(1)}% of crop) — left alone; try TM_CANDIDATES=40`, false);
      continue;
    }

    // The matched FILE, re-fetched at output width. The crop geometry comes
    // from the 1400px measurement as fractions, so it lands on the same pixels
    // regardless of what width Commons actually returns.
    // Ask for the width that makes the CROP reach OUT_W, not the width of the
    // whole photograph. Commons hands back the file's native size when the
    // request exceeds it, so overshooting is free.
    const sourceW = Math.min(MAX_SOURCE_W, Math.ceil(OUT_W / Math.max(0.05, pick.frac.w)));
    const info = await api({ action: "query", titles: `File:${pick.title}` }, sourceW);
    const ii = Object.values(info?.query?.pages ?? {})[0]?.imageinfo?.[0];
    const bigUrl = ii?.thumburl ?? ii?.url;
    if (!bigUrl) {
      line(face.name, "matched, but could not fetch the high-res rendition — left alone", false);
      continue;
    }
    const bigPath = download({ ...pick, url: bigUrl }, sourceW);
    if (!bigPath) {
      line(face.name, "matched, but the high-res download failed — left alone", false);
      continue;
    }
    // A throttled request returns an HTML apology, and `download` will happily
    // save it under a .jpg name. Reading it is where that shows up, and an
    // uncaught throw here loses every face processed before it.
    let big;
    try {
      big = await sharp(bigPath).metadata();
    } catch {
      line(face.name, "matched, but the download was not an image (rate-limited?) — left alone", false);
      continue;
    }
    const bx = Math.round(pick.frac.x * big.width);
    const by = Math.round(pick.frac.y * big.height);
    const bw = Math.min(big.width - bx, Math.round(pick.frac.w * big.width));
    const bh = Math.min(big.height - by, Math.round(pick.frac.h * big.height));

    // Never manufacture detail. If the crop is smaller than the target, ship
    // it at its own size rather than upscaling — the point of this script is
    // to stop shipping upscales.
    const scale = Math.min(1, bw / OUT_W, bh / OUT_H);
    const outW = Math.round(OUT_W * scale);
    const outH = Math.round(OUT_H * scale);

    const before = await sharp(`${OUT_IMG}/${face.slug}.jpg`).metadata();
    // A crop no bigger than what is already shipped is not worth writing: the
    // whole point of this script is to stop shipping upscales, and replacing a
    // 440-wide file with another 440-wide file just churns the repo.
    const gain = outW > before.width;
    if (!gain) {
      line(face.name, `matched (${(pick.meanDist * 100).toFixed(2)}%) but the source is only ${bw}x${bh} — no better than the ${before.width}x${before.height} already shipped, left alone`, false);
      continue;
    }
    if (!DRY) {
      await sharp(bigPath).extract({ left: bx, top: by, width: bw, height: bh })
        .resize(outW, outH, { fit: "cover", kernel: "lanczos3" })
        .jpeg({ quality: 82, mozjpeg: true })
        .toFile(`${OUT_IMG}/${face.slug}.jpg`);
    }
    line(
      face.name,
      `${before.width}x${before.height} -> ${outW}x${outH} (landmark match ${(pick.meanDist * 100).toFixed(2)}%)` + (scale < 1 ? ` — source caps the crop at ${bw}x${bh}` : ""),
      !DRY,
      true,
    );
  }
} finally {
  await browser.close();
  server.kill();
}

if (throttled) {
  console.log(`\n${throttled} request(s) were rate-limited by Wikimedia. That is per source IP, and a shared`);
  console.log("cloud egress can be throttled past the point of usefulness — run this from a normal");
  console.log("connection, or raise the gap: TM_GAP_MS=5000 npx tsx tools/resize-demo-images.mjs");
}
const wrote = report.filter((r) => r.wrote).length;
console.log(`\n${wrote}/${REEL.length} rewritten${DRY ? " (dry run — nothing written)" : ""}`);
