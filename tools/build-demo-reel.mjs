// Build the landing-page demo reel.
//
// Scans a roster of faces, writes downscaled crops into public/demo/ and a
// generated module holding each face's outline, real scores and per-region
// callout anchors — so the reel animates instantly without running the model
// on page load, and shows the SAME numbers the engine would give you.
//
// LICENSING. These are Wikimedia Commons images, which are mostly CC BY-SA:
// free to ship, but only with attribution, and our crop is a derivative so it
// inherits the licence. The builder therefore refuses to include any image
// whose licence it cannot read, and records the photographer and licence for
// every one it keeps. The reel renders that credit. Do not remove it — losing
// the credit is what turns a free image into an infringing one.
import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import sharp from "sharp";

const APP_DIR = "/home/user/truemax";
const DATA = process.env.TM_DATA ?? new URL("../.calib/", import.meta.url).pathname;
const OUT_IMG = `${APP_DIR}/public/demo`;
const UA = "TrueMax/0.1 (demo reel builder)";
mkdirSync(OUT_IMG, { recursive: true });

// A mix people actually recognise. Politicians made the reel look like a civics
// lesson; the pitch is "this is what your face measures at", which only lands
// if the faces on screen mean something to the viewer.
const ROSTER = (
  process.env.TM_REEL ??
  [
    "Henry Cavill", "Michael B. Jordan", "Zendaya", "Timothée Chalamet",
    "Margot Robbie", "Chris Hemsworth", "Rihanna", "Idris Elba",
    "Sydney Sweeney", "Jason Momoa", "Zoë Kravitz", "Cillian Murphy",
  ].join(",")
).split(",").map((s) => s.trim());

const ALL = [
  ...JSON.parse(readFileSync(DATA + "manifest.json", "utf8")),
  ...JSON.parse(readFileSync(DATA + "pop-manifest.json", "utf8")),
];
const FACES = ROSTER.map((n) => ALL.find((r) => r.name === n)).filter(Boolean);
console.log(`roster resolved: ${FACES.length}/${ROSTER.length}`);

// --- licence lookup -------------------------------------------------------
const strip = (s) => String(s ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

function licenceFor(name) {
  try {
    const title = encodeURIComponent(name.replace(/ /g, "_"));
    const sum = JSON.parse(
      execSync(`curl -sSL -A "${UA}" "https://en.wikipedia.org/api/rest_v1/page/summary/${title}"`,
        { encoding: "utf8", timeout: 40000 }),
    );
    const src = sum.originalimage?.source ?? sum.thumbnail?.source;
    if (!src) return null;
    const file = decodeURIComponent(src.split("?")[0].split("/").pop());
    const api =
      `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo` +
      `&iiprop=extmetadata&titles=${encodeURIComponent("File:" + file)}`;
    const q = JSON.parse(execSync(`curl -sSL -A "${UA}" "${api}"`, { encoding: "utf8", timeout: 40000 }));
    const page = Object.values(q.query?.pages ?? {})[0];
    const md = page?.imageinfo?.[0]?.extmetadata;
    if (!md?.LicenseShortName) return null;
    return {
      artist: strip(md.Artist?.value) || "Unknown",
      licence: strip(md.LicenseShortName.value),
      file,
    };
  } catch {
    return null;
  }
}

// Anything we cannot positively licence does not ship. "Probably fine" is not
// a licence, and a reel is the most public surface in the product.
const SHIPPABLE = /^(CC BY|CC BY-SA|CC0|Public domain|PD)/i;

const server = spawn("npx", ["vite", "preview", "--port", "4205", "--strictPort"], { cwd: APP_DIR, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

const entries = [];
try {
  const page = await browser.newPage();
  await page.goto("http://localhost:4205/");
  await page.waitForSelector("#engine-status.ready", { timeout: 60000 });

  for (const { name, sex, file } of FACES) {
    const lic = licenceFor(name);
    if (!lic || !SHIPPABLE.test(lic.licence)) {
      console.log(`skip ${name.padEnd(22)} — licence ${lic?.licence ?? "unreadable"}`);
      continue;
    }

    const url = `data:image/jpeg;base64,${readFileSync(file).toString("base64")}`;
    const m = await page.evaluate(async ([u, s]) => {
      const r = await window.__truemaxMeasure(u, s);
      if (!r.faceFound) return null;
      return { overall: r.overall, pillars: r.pillars, regions: r.regions, lm: r.reelLandmarks, box: r.reelBox };
    }, [url, sex]);
    if (!m) {
      console.log(`skip ${name} — no face`);
      continue;
    }

    const slug = name.toLowerCase().normalize("NFD").replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
    const meta = await sharp(file).metadata();
    const pad = 0.34;
    const x = Math.max(0, Math.round((m.box.x - m.box.w * pad) * meta.width));
    const y = Math.max(0, Math.round((m.box.y - m.box.h * pad * 1.1) * meta.height));
    const w = Math.min(meta.width - x, Math.round(m.box.w * (1 + pad * 2) * meta.width));
    const h = Math.min(meta.height - y, Math.round(m.box.h * (1 + pad * 2.2) * meta.height));
    await sharp(file).extract({ left: x, top: y, width: w, height: h }).resize(440, 550, { fit: "cover" })
      .jpeg({ quality: 78 }).toFile(`${OUT_IMG}/${slug}.jpg`);

    // Re-express normalized coordinates relative to the crop the reel displays
    const rel = ([lx, ly]) => [
      +((lx * meta.width - x) / w).toFixed(4),
      +((ly * meta.height - y) / h).toFixed(4),
    ];

    entries.push({
      name,
      sex,
      slug,
      overall: m.overall,
      pillars: m.pillars,
      regions: m.regions
        .map((r) => {
          const [rx, ry] = rel([r.x, r.y]);
          return { id: r.id, score: r.score, x: rx, y: ry };
        })
        // Callouts only make sense for regions that landed inside the crop
        .filter((r) => r.x > 0.04 && r.x < 0.96 && r.y > 0.04 && r.y < 0.96),
      credit: `${lic.artist} · ${lic.licence}`,
      points: m.lm.map(rel),
    });
    console.log(`${name.padEnd(22)} ${m.overall}   ${lic.licence}`);
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
console.log(`\nwrote ${entries.length} reel faces`);
process.exit(0);
