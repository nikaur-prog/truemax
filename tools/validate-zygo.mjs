// Render candidate bizygomatic landmark spans across a varied face set.
// Output is written below `.calib/` and must never be committed.
import { mkdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";
import { APP_DIR, dataFile, launchChromium, startVite } from "./runtime.mjs";

const PAIRS = [
  { name: "legacy face oval", right: 234, left: 454, color: "#ff453a" },
  { name: "malar 116 / 345", right: 116, left: 345, color: "#34c759" },
  { name: "upper malar 111 / 340", right: 111, left: 340, color: "#0a84ff" },
  { name: "malar 117 / 346", right: 117, left: 346, color: "#ffd60a" },
  { name: "lateral cheek 123 / 352", right: 123, left: 352, color: "#bf5af2" },
  { name: "upper cheek 50 / 280", right: 50, left: 280, color: "#ff9f0a" },
];

const PHOTOS = [
  "amy-klobuchar.jpg",
  "anthony-fauci.jpg",
  "chris-hemsworth.jpg",
  "cillian-murphy.jpg",
  "henry-cavill.jpg",
  "margot-robbie.jpg",
  "michael-b-jordan.jpg",
  "michelle-obama.jpg",
  "rihanna.jpg",
  "sydney-sweeney.jpg",
];

const outputDir = dataFile("zygo-candidates");
mkdirSync(outputDir, { recursive: true });

const { server, url } = await startVite(4184);
const browser = await launchChromium(chromium);
const measured = [];
try {
  const page = await browser.newPage();
  await page.goto(url);
  await page.waitForSelector("#engine-status.ready", { timeout: 60_000 });

  for (const file of PHOTOS) {
    const path = resolve(APP_DIR, "public/demo", file);
    const dataUrl = `data:image/jpeg;base64,${readFileSync(path).toString("base64")}`;
    const result = await page.evaluate(
      async ([image, sex]) => await window.__truemaxMeasure(image, sex, { includeLandmarks: true }),
      [dataUrl, "male"],
    );
    if (!result?.faceFound || !result.landmarks) throw new Error(`No face landmarks for ${file}`);
    measured.push({ file, path, landmarks: result.landmarks });
  }
} finally {
  await browser.close();
  server.kill();
}

const TILE_W = 360;
const TILE_H = 420;
const COLS = 5;
const ROWS = Math.ceil(measured.length / COLS);

for (const pair of PAIRS) {
  const tiles = [];
  for (const face of measured) {
    const source = sharp(face.path).rotate();
    const meta = await source.metadata();
    const scale = Math.min(TILE_W / meta.width, (TILE_H - 44) / meta.height);
    const drawW = Math.round(meta.width * scale);
    const drawH = Math.round(meta.height * scale);
    const x0 = Math.round((TILE_W - drawW) / 2);
    const y0 = 36 + Math.round((TILE_H - 36 - drawH) / 2);
    const a = face.landmarks[pair.right];
    const b = face.landmarks[pair.left];
    const ax = x0 + a.x * drawW;
    const ay = y0 + a.y * drawH;
    const bx = x0 + b.x * drawW;
    const by = y0 + b.y * drawH;
    const overlay = Buffer.from(`<svg width="${TILE_W}" height="${TILE_H}" xmlns="http://www.w3.org/2000/svg">
      <text x="12" y="24" fill="white" font-family="Arial" font-size="17" font-weight="700">${basename(face.file, ".jpg")}</text>
      <line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${pair.color}" stroke-width="4"/>
      <circle cx="${ax}" cy="${ay}" r="7" fill="${pair.color}" stroke="white" stroke-width="2"/>
      <circle cx="${bx}" cy="${by}" r="7" fill="${pair.color}" stroke="white" stroke-width="2"/>
    </svg>`);
    const tile = await sharp({
      create: { width: TILE_W, height: TILE_H, channels: 3, background: "#111" },
    })
      .composite([
        { input: await source.resize(drawW, drawH).jpeg().toBuffer(), left: x0, top: y0 },
        { input: overlay, left: 0, top: 0 },
      ])
      .jpeg({ quality: 88 })
      .toBuffer();
    tiles.push(tile);
  }

  const titleH = 56;
  const sheet = sharp({
    create: { width: COLS * TILE_W, height: titleH + ROWS * TILE_H, channels: 3, background: "#0b0b0b" },
  });
  const title = Buffer.from(`<svg width="${COLS * TILE_W}" height="${titleH}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#0b0b0b"/>
    <text x="24" y="37" fill="${pair.color}" font-family="Arial" font-size="25" font-weight="700">${pair.name}</text>
  </svg>`);
  const composites = [{ input: title, left: 0, top: 0 }];
  tiles.forEach((tile, index) => {
    composites.push({
      input: tile,
      left: (index % COLS) * TILE_W,
      top: titleH + Math.floor(index / COLS) * TILE_H,
    });
  });
  const name = `${pair.right}-${pair.left}.jpg`;
  await sheet.composite(composites).jpeg({ quality: 90 }).toFile(resolve(outputDir, name));
  console.log(resolve(outputDir, name));
}
