// Side-seed harness: run the REAL seeder over a directory of profile photos
// and render annotated overlays a labeler can correct from.
//
// This exists to build the labeled dataset the auto-placement work needs:
// docs/SIDE_CORRECTION_FEEDBACK.md stores user corrections but nothing refits
// from them, and the template constants in ui/sideVerify.ts were measured
// from a handful of fixture sets. The dataset lives in .side-dataset/
// (gitignored — the repo is public and face images stay out of it, synthetic
// or not; only derived constants are committed).
//
//   node tools/side-seed-harness.mjs seed
//     .side-dataset/raw/*.jpg → .side-dataset/seeds.json
//                             → .side-dataset/seeded/<id>.jpg   (annotated)
//   node tools/side-seed-harness.mjs render-labels
//     .side-dataset/labels.json → .side-dataset/labeled/<id>.jpg
//
// Annotated renders are DISPLAY_W wide with a 50px grid; labels.json
// coordinates are in display pixels, and the JSON records the scale back to
// source pixels so the fitting step never mixes the two spaces.
import { launchChromium } from "./launchChromium.mjs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const DATA = `${APP_DIR}/.side-dataset`;
const DISPLAY_W = 640;

// SIDE_POINTS order, mirrored here so the numbered overlay and the JSON agree
// without importing TS into node.
const ORDER = [
  "trichion", "glabella", "nasion", "pronasale", "subnasale",
  "labialeSuperius", "labialeInferius", "pogonion", "menton",
  "cervicale", "gonion", "condylion", "tragion",
];

const mode = process.argv[2];
if (mode !== "seed" && mode !== "render-labels") {
  console.error("mode must be seed or render-labels");
  process.exit(1);
}

mkdirSync(`${DATA}/seeded`, { recursive: true });
mkdirSync(`${DATA}/labeled`, { recursive: true });

const server = spawn("npx", ["vite", "--port", "4261", "--strictPort"], { cwd: APP_DIR, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 5000));
const browser = await launchChromium();

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("console", (m) => {
    if (m.type() === "error") console.log("page:", m.text().slice(0, 220));
  });
  await page.goto("http://localhost:4261/");
  await page.waitForSelector('html[data-engine="ready"]', { timeout: 90000 });

  const files = readdirSync(`${DATA}/raw`).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
  const labels = mode === "render-labels" ? JSON.parse(readFileSync(`${DATA}/labels.json`, "utf8")) : null;
  const seeds = existsSync(`${DATA}/seeds.json`) ? JSON.parse(readFileSync(`${DATA}/seeds.json`, "utf8")) : {};

  for (const file of files) {
    const id = file.replace(/\.[^.]+$/, "");
    const dataUrl = `data:image/jpeg;base64,${readFileSync(`${DATA}/raw/${file}`).toString("base64")}`;
    const override = labels?.[id]?.points ?? null;

    const out = await page.evaluate(
      async ([url, order, displayW, overridePts]) => {
        const { seedSidePointsSmart } = await import("/src/ui/sideVerify.ts");
        const img = await new Promise((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = rej;
          i.src = url;
        });
        const src = document.createElement("canvas");
        src.width = img.naturalWidth;
        src.height = img.naturalHeight;
        src.getContext("2d").drawImage(img, 0, 0);

        const seed = overridePts ? null : await seedSidePointsSmart(src);
        const scale = displayW / src.width;
        // Display-space points: either the seed converted, or the labels as-is.
        const pts = {};
        for (const idp of order) {
          const p = overridePts ? overridePts[idp] : seed.points[idp];
          pts[idp] = overridePts ? { x: p.x, y: p.y } : { x: p.x * scale, y: p.y * scale };
        }

        const disp = document.createElement("canvas");
        disp.width = displayW;
        disp.height = Math.round(src.height * scale);
        const g = disp.getContext("2d");
        g.drawImage(src, 0, 0, disp.width, disp.height);
        // The grid the labeler reads coordinates from.
        g.strokeStyle = "rgba(255,255,255,0.28)";
        g.fillStyle = "rgba(255,255,255,0.85)";
        g.font = "11px monospace";
        g.lineWidth = 1;
        for (let x = 0; x <= disp.width; x += 50) {
          g.beginPath(); g.moveTo(x, 0); g.lineTo(x, disp.height); g.stroke();
          g.fillText(String(x), x + 2, 11);
        }
        for (let y = 0; y <= disp.height; y += 50) {
          g.beginPath(); g.moveTo(0, y); g.lineTo(disp.width, y); g.stroke();
          g.fillText(String(y), 2, y + 12);
        }
        // Numbered crosses.
        order.forEach((idp, i) => {
          const p = pts[idp];
          g.strokeStyle = "#ff2f6d";
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(p.x - 7, p.y); g.lineTo(p.x + 7, p.y);
          g.moveTo(p.x, p.y - 7); g.lineTo(p.x, p.y + 7);
          g.stroke();
          g.font = "bold 13px monospace";
          g.fillStyle = "#000";
          g.fillText(String(i + 1), p.x + 9, p.y + 5);
          g.fillStyle = "#7dffc9";
          g.fillText(String(i + 1), p.x + 8, p.y + 4);
        });
        return {
          jpeg: disp.toDataURL("image/jpeg", 0.9).split(",")[1],
          seed: seed
            ? { points: pts, method: seed.method, confidence: seed.confidence, faceDir: seed.faceDir }
            : null,
          scale,
          srcW: src.width,
          srcH: src.height,
        };
      },
      [dataUrl, ORDER, DISPLAY_W, override],
    );

    const dir = mode === "seed" ? "seeded" : "labeled";
    writeFileSync(`${DATA}/${dir}/${id}.jpg`, Buffer.from(out.jpeg, "base64"));
    if (mode === "seed") {
      seeds[id] = { ...out.seed, scale: out.scale, srcW: out.srcW, srcH: out.srcH };
      console.log(`${id}: method=${out.seed.method} confidence=${out.seed.confidence.toFixed(2)}`);
    } else {
      console.log(`${id}: rendered labels`);
    }
  }
  if (mode === "seed") writeFileSync(`${DATA}/seeds.json`, JSON.stringify(seeds, null, 1));
} finally {
  await browser.close();
  server.kill();
}
