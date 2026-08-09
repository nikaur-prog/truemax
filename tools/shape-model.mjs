// Build the shape model: a Procrustes mean shape per sex, and the direction
// in shape space that separates the consensus-attractive top tier from the
// population average.
//
// Run after distributions are in place; rebuild afterwards.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const APP_DIR = "/home/user/truemax";
const DATA = process.env.TM_DATA ?? new URL("../.calib/", import.meta.url).pathname;

const popManifest = JSON.parse(readFileSync(DATA + "pop-manifest.json", "utf8"));
const celebManifest = JSON.parse(readFileSync(DATA + "manifest.json", "utf8"));

const TOP_TIER = new Set([
  "Jordan Barrett", "David Gandy", "Francisco Lachowski", "Sean O'Pry", "Henry Cavill",
  "Brad Pitt", "Chris Hemsworth", "Zac Efron", "Christian Bale", "Chris Evans",
  "Ryan Gosling", "Michael B. Jordan", "Robert Pattinson", "Timothée Chalamet",
  "Sydney Sweeney", "Megan Fox", "Margot Robbie", "Angelina Jolie", "Adriana Lima",
  "Bella Hadid", "Ana de Armas", "Gal Gadot", "Emily Ratajkowski", "Monica Bellucci",
  "Scarlett Johansson", "Kendall Jenner", "Zendaya", "Natalie Portman",
]);

const GATE = { yaw: 20, pitch: 20, smile: 0.75, face: 0.22 };

const server = spawn("npx", ["vite", "preview", "--port", "4190", "--strictPort"], { cwd: APP_DIR, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

const pop = { male: [], female: [] };
const top = { male: [], female: [] };

try {
  const page = await browser.newPage();
  await page.goto("http://localhost:4190/");
  await page.waitForSelector("#engine-status.ready", { timeout: 30000 });

  const collect = async (list, bucket, filterTopTier) => {
    for (const row of list) {
      if (filterTopTier && !TOP_TIER.has(row.name)) continue;
      try {
        const url = `data:image/jpeg;base64,${readFileSync(row.file).toString("base64")}`;
        const m = await page.evaluate(async ([u, s]) => await window.__truemaxMeasure(u, s), [url, row.sex]);
        if (!m?.faceFound || !m.shape) continue;
        if (Math.abs(m.yaw) > GATE.yaw || Math.abs(m.pitch) > GATE.pitch) continue;
        if (m.smile > GATE.smile || m.faceWidthFrac < GATE.face) continue;
        bucket[row.sex].push(m.shape);
      } catch {
        /* skip */
      }
    }
  };

  await collect(popManifest, pop, false);
  await collect(celebManifest, top, true);
} finally {
  await browser.close();
  server.kill();
}

// ---- Procrustes helpers (mirror src/engine/shape.ts) ----
function align(shape, ref) {
  const n = shape.length / 2;
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) { cx += shape[2 * i] / n; cy += shape[2 * i + 1] / n; }
  const pts = [];
  let norm = 0;
  for (let i = 0; i < n; i++) {
    const x = shape[2 * i] - cx, y = shape[2 * i + 1] - cy;
    pts.push([x, y]);
    norm += x * x + y * y;
  }
  norm = Math.sqrt(norm) || 1e-9;
  for (const p of pts) { p[0] /= norm; p[1] /= norm; }
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += pts[i][0] * ref[2 * i + 1] - pts[i][1] * ref[2 * i];
    sxx += pts[i][0] * ref[2 * i] + pts[i][1] * ref[2 * i + 1];
  }
  const t = Math.atan2(sxy, sxx), c = Math.cos(t), s = Math.sin(t);
  const out = new Array(shape.length);
  for (let i = 0; i < n; i++) {
    out[2 * i] = pts[i][0] * c - pts[i][1] * s;
    out[2 * i + 1] = pts[i][0] * s + pts[i][1] * c;
  }
  return out;
}
const meanOf = (arr) => {
  const out = new Array(arr[0].length).fill(0);
  for (const a of arr) for (let i = 0; i < a.length; i++) out[i] += a[i] / arr.length;
  return out;
};
// Generalized Procrustes: align to a running mean until it stops moving
function gpa(shapes, iters = 4) {
  let ref = align(shapes[0], shapes[0].map((_, i) => (i % 2 === 0 ? 1 : 0)));
  let aligned = shapes;
  for (let k = 0; k < iters; k++) {
    aligned = shapes.map((s) => align(s, ref));
    const m = meanOf(aligned);
    ref = align(m, ref);
  }
  return { aligned, mean: ref };
}

const model = { male: null, female: null };
for (const sex of ["male", "female"]) {
  if (pop[sex].length < 8 || top[sex].length < 5) {
    console.log(`${sex}: too few shapes (pop ${pop[sex].length}, top ${top[sex].length}) — skipped`);
    continue;
  }
  const { aligned, mean } = gpa(pop[sex]);
  const topAligned = top[sex].map((s) => align(s, mean));
  const topMean = meanOf(topAligned);

  // Direction from population average toward the attractive prototype
  let axis = topMean.map((v, i) => v - mean[i]);
  const mag = Math.sqrt(axis.reduce((a, v) => a + v * v, 0)) || 1e-9;
  axis = axis.map((v) => v / mag);

  const proj = aligned.map((s) => s.reduce((a, v, i) => a + (v - mean[i]) * axis[i], 0));
  const pm = proj.reduce((a, b) => a + b, 0) / proj.length;
  const psd = Math.sqrt(proj.reduce((a, b) => a + (b - pm) ** 2, 0) / Math.max(1, proj.length - 1));

  const topProj = topAligned.map((s) => s.reduce((a, v, i) => a + (v - mean[i]) * axis[i], 0));
  const tm = topProj.reduce((a, b) => a + b, 0) / topProj.length;

  console.log(
    `${sex}: pop ${pop[sex].length}, top ${top[sex].length} — ` +
      `top tier sits ${((tm - pm) / psd).toFixed(2)} SD along the axis`,
  );
  model[sex] = { meanShape: mean, axis, axisMean: pm, axisSD: psd };
}

const fmt = (a) => `[${a.map((v) => v.toFixed(6)).join(",")}]`;
const body = ["male", "female"]
  .map((sex) =>
    model[sex]
      ? `  ${sex}: { meanShape: ${fmt(model[sex].meanShape)}, axis: ${fmt(model[sex].axis)}, axisMean: ${model[sex].axisMean.toFixed(6)}, axisSD: ${model[sex].axisSD.toFixed(6)} },`
      : `  ${sex}: null,`,
  )
  .join("\n");

const src = readFileSync(APP_DIR + "/src/engine/shapeModel.ts", "utf8");
const head = src.slice(0, src.indexOf("export const SHAPE_MODEL"));
writeFileSync(
  APP_DIR + "/src/engine/shapeModel.ts",
  `${head}export const SHAPE_MODEL: Record<Sex, ShapeModel | null> = {\n${body}\n};\n`,
);
console.log("wrote src/engine/shapeModel.ts");
process.exit(0);
