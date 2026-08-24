// Build the landing-page demo reel.
//
// Scans a roster of faces, writes downscaled crops into public/demo/ and a
// generated module holding each face's outline, real scores and per-region
// callout anchors — so the reel animates instantly without running the model
// on page load, and shows the SAME numbers the engine would give you.
//
// PHOTO SELECTION IS THE WHOLE PROBLEM. The first version of this took one
// photograph per person, whichever the calibration set happened to hold, and
// the result was a landing page showing Chris Hemsworth at 5.7 and Margot
// Robbie at 4.0. Measuring every Commons photograph of the same four people
// explains why:
//
//   person            n    score range    SD
//   Margot Robbie    18     3.6 – 7.8    1.13
//   Chris Hemsworth  14     4.3 – 8.3    1.42
//   Henry Cavill     15     4.0 – 7.8    0.94
//   Sydney Sweeney   18     3.7 – 8.2    1.27
//
// One face spans four points depending on which photograph you feed it. That
// is the same within-person spread reliability.ts measures (1.32 points), and
// it means "which photo" is a bigger input to the number than "whose face".
//
// So this picks by CAPTURE QUALITY, never by score. Ranking candidates by the
// score they produce would be picking the top of a four-point spread and
// calling it a measurement, which is the thing this product exists not to do.
// The rank is neutral mouth first, then frontality, then face size — exactly
// the conditions the app asks its own users for — and whatever the best-
// captured photograph scores is what ships, high or low.
//
// LICENSING. These are Wikimedia Commons images, which are mostly CC BY-SA:
// free to ship, but only with attribution, and our crop is a derivative so it
// inherits the licence. The builder therefore refuses to include any image
// whose licence it cannot read, and records the photographer and licence for
// every one it keeps. The reel renders that credit. Do not remove it — losing
// the credit is what turns a free image into an infringing one.
import { launchChromium } from "./launchChromium.mjs";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import sharp from "sharp";

// Derived from this file's own location, not hardcoded. It used to be an
// absolute sandbox path, which meant the tool ran only on the one machine it
// was written on and died with ERR_MODULE_NOT_FOUND-style confusion anywhere
// else — including the laptop that actually has the network access this needs.
const APP_DIR = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const OUT_IMG = `${APP_DIR}/public/demo`;
const CACHE = `${APP_DIR}/.reel-cache`;
const UA = "TrueMax/0.2 (demo reel builder; support@ascendnz.online)";
mkdirSync(OUT_IMG, { recursive: true });
mkdirSync(CACHE, { recursive: true });

// A mix people actually recognise. Politicians made the reel look like a civics
// lesson; the pitch is "this is what your face measures at", which only lands
// if the faces on screen mean something to the viewer.
const ROSTER = (
  process.env.TM_REEL ??
  [
    "Henry Cavill:male", "Michael B. Jordan:male", "Timothée Chalamet:male",
    "Margot Robbie:female", "Chris Hemsworth:male", "Rihanna:female",
    "Sydney Sweeney:female", "Jason Momoa:male", "Cillian Murphy:male",
    "Zendaya:female", "Idris Elba:male", "Anya Taylor-Joy:female",
  ].join(",")
).split(",").map((s) => {
  const [name, sex] = s.split(":");
  return { name: name.trim(), sex: (sex ?? "female").trim() };
});

// Anything we cannot positively licence does not ship. "Probably fine" is not
// a licence, and a reel is the most public surface in the product.
const SHIPPABLE = /^(cc0|cc[- ]by([- ]sa)?([- ]\d(\.\d)?)?|public domain|pd-)/i;

// How many candidates per person to actually measure. Each one is a download
// and a model run, so this is the cost knob.
const CANDIDATES = Number(process.env.TM_CANDIDATES ?? 20);

const strip = (s) => String(s ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

function api(params) {
  const url = "https://commons.wikimedia.org/w/api.php?" + new URLSearchParams({
    ...params, prop: "imageinfo", iiprop: "url|extmetadata", iiurlwidth: "1400", format: "json",
  });
  try {
    return JSON.parse(execFileSync("curl", ["-sSL", "-A", UA, url], { encoding: "utf8", timeout: 45000, maxBuffer: 3e7 }));
  } catch {
    return null;
  }
}

// Three sources, merged and de-duplicated, because any one alone under-reports
// badly. "Category:<name>" holds only the files nobody filed into a
// subcategory — for Margot Robbie that is two images, which is how an earlier
// probe concluded there were almost no usable photographs of one of the most
// photographed people alive. "Portraits of <name>" is the subcategory that
// holds exactly the shot type this product wants.
function candidatesFor(name) {
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
      seen.set(title, {
        title,
        url: ii.thumburl ?? ii.url,
        licence,
        artist: strip(md.Artist?.value) || "Unknown",
      });
    }
  };
  collect(api({ action: "query", generator: "categorymembers", gcmtitle: `Category:Portraits of ${name}`, gcmtype: "file", gcmlimit: "40" }));
  collect(api({ action: "query", generator: "categorymembers", gcmtitle: `Category:${name}`, gcmtype: "file", gcmlimit: "40" }));
  collect(api({ action: "query", generator: "search", gsrsearch: name, gsrlimit: "40", gsrnamespace: "6" }));
  return [...seen.values()];
}

function download(c) {
  const path = `${CACHE}/${c.title.replace(/[^A-Za-z0-9.]+/g, "_").slice(-70)}`;
  if (!existsSync(path)) {
    try { execFileSync("curl", ["-sSL", "-A", UA, "-o", path, c.url], { timeout: 60000 }); }
    catch { return null; }
  }
  return path;
}

// Capture quality, low is better. The same three things the app tells a user
// to fix, weighted by how much each one moves the measurements: a wide smile
// rewrites the mouth and jaw metrics outright, so it dominates.
function captureCost(m) {
  return m.smile * 3 + Math.abs(m.yaw) / 28 + Math.abs(m.pitch) / 26;
}

const server = spawn("npx", ["vite", "preview", "--port", "4205", "--strictPort"], { cwd: APP_DIR, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 3500));
const browser = await launchChromium();

const entries = [];
const audit = [];
try {
  const page = await browser.newPage();
  await page.goto("http://localhost:4205/");
  await page.waitForSelector("html[data-engine=\"ready\"]", { timeout: 60000 });

  for (const { name, sex } of ROSTER) {
    const cands = candidatesFor(name);
    const measured = [];
    for (const c of cands) {
      if (measured.length >= CANDIDATES) break;
      const path = download(c);
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
          return { overall: r.overall, pillars: r.pillars, regions: r.regions,
            lm: r.reelLandmarks, box: r.reelBox, yaw: r.yaw, pitch: r.pitch,
            smile: r.smile, widthFrac: r.faceWidthFrac };
        }, [`data:image/jpeg;base64,${b64}`, sex]);
      } catch { continue; }
      // A face filling little of the frame is somebody else in a group shot,
      // which is the main contaminant in scraped photo sets.
      if (!m || m.widthFrac < 0.2) continue;
      measured.push({ ...m, ...c, path, cost: captureCost(m) });
    }

    if (!measured.length) { console.log(`skip ${name} — nothing measurable`); continue; }
    measured.sort((a, b) => a.cost - b.cost);
    const pick = measured[0];
    audit.push({
      name,
      considered: measured.length,
      picked: pick.title,
      overall: pick.overall,
      smile: +pick.smile.toFixed(2),
      yaw: +pick.yaw.toFixed(1),
      spread: `${Math.min(...measured.map((m) => m.overall)).toFixed(1)}–${Math.max(...measured.map((m) => m.overall)).toFixed(1)}`,
      wouldPassGate: pick.smile <= 0.35 && Math.abs(pick.yaw) <= 28 && Math.abs(pick.pitch) <= 26,
    });

    const slug = name.toLowerCase().normalize("NFD").replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
    const meta = await sharp(pick.path).metadata();
    const pad = 0.34;
    const x = Math.max(0, Math.round((pick.box.x - pick.box.w * pad) * meta.width));
    const y = Math.max(0, Math.round((pick.box.y - pick.box.h * pad * 1.1) * meta.height));
    const w = Math.min(meta.width - x, Math.round(pick.box.w * (1 + pad * 2) * meta.width));
    const h = Math.min(meta.height - y, Math.round(pick.box.h * (1 + pad * 2.2) * meta.height));
    await sharp(pick.path).extract({ left: x, top: y, width: w, height: h })
      .resize(440, 550, { fit: "cover" }).jpeg({ quality: 78 }).toFile(`${OUT_IMG}/${slug}.jpg`);

    // Re-express normalized coordinates relative to the crop the reel displays
    const rel = ([lx, ly]) => [
      +((lx * meta.width - x) / w).toFixed(4),
      +((ly * meta.height - y) / h).toFixed(4),
    ];

    entries.push({
      name, sex, slug,
      overall: pick.overall,
      pillars: pick.pillars,
      regions: pick.regions
        .map((r) => { const [rx, ry] = rel([r.x, r.y]); return { id: r.id, score: r.score, x: rx, y: ry }; })
        // Callouts only make sense for regions that landed inside the crop
        .filter((r) => r.x > 0.04 && r.x < 0.96 && r.y > 0.04 && r.y < 0.96),
      credit: `${pick.artist} · ${pick.licence}`,
      points: pick.lm.map(rel),
    });
    console.log(
      `${name.padEnd(20)} ${String(pick.overall).padStart(4)}  from ${String(measured.length).padStart(2)} candidates` +
      `  (range ${audit.at(-1).spread})  smile ${pick.smile.toFixed(2)} yaw ${pick.yaw.toFixed(1)}  ${pick.licence}`,
    );
  }
} finally {
  await browser.close();
  server.kill();
}

writeFileSync(
  `${APP_DIR}/src/ui/demoReelData.ts`,
  `// GENERATED by tools/build-demo-reel.mjs — do not hand-edit.
//
// Real scans: the landing reel shows the engine's actual output, not a mock-up.
// Images live in public/demo/ and are Wikimedia Commons files. \`credit\` is not
// decoration — these licences require attribution, and the crop is a derivative
// that inherits the licence. The reel must render it.
//
// The photograph for each face is chosen by capture quality (neutral mouth,
// then frontality, then face size), never by the score it produces. See the
// builder for why that distinction is the difference between a demo and a lie.
export interface ReelRegion {
  id: string;
  score: number;
  x: number;
  y: number;
}

export interface ReelFace {
  name: string;
  sex: "male" | "female";
  slug: string;
  overall: number;
  pillars: Record<string, number>;
  regions: ReelRegion[];
  credit: string;
  points: Array<[number, number]>;
}

export const REEL: ReelFace[] = ${JSON.stringify(entries)};
`,
);

console.log("\n================= selection audit =================");
for (const a of audit) {
  console.log(`${a.name.padEnd(20)} ${String(a.overall).padStart(4)}  spread ${a.spread.padStart(9)}  ` +
    `${a.wouldPassGate ? "passes" : "FAILS "} the app's own capture gate   ${a.picked.slice(0, 44)}`);
}
console.log(`\nwrote ${entries.length} reel faces`);
process.exit(0);
