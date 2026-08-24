// Is landmark 52 the brow's PEAK?
//
// browTilt is lineTiltDeg(BROW_MEDIAL, BROW_LATERAL) — medial end to the tail
// of the brow. The product we benchmark against defines its eyebrow tilt as the
// slope "from medial to PEAK in the lateral third", and ours reads about 11.9
// degrees below theirs on both people measured, negative where theirs is
// positive. A brow rises to its peak then falls to the tail, so measuring to
// the tail averages the rise and the fall — which is exactly that signature.
//
// The proposed fix is to measure to landmark 52 instead of 46. That is only a
// fix if 52 actually sits at the high point of the brow, so this checks, on
// real faces, rather than trusting an index.
//
// Reports, per candidate landmark on the right brow: how often it is the
// HIGHEST point on that brow, and what tilt medial->candidate produces.
//
//   node tools/browtilt-check.mjs
import { launchChromium } from "./launchChromium.mjs";
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

const APP_DIR = "/home/user/truemax";
const PHOTOS = process.env.TM_PHOTOS ?? `${APP_DIR}/.calib/pop-photos`;
const LIMIT = Number(process.env.TM_LIMIT ?? 60);

const files = readdirSync(PHOTOS).filter((f) => f.endsWith(".jpg")).slice(0, LIMIT);
console.log(`Measuring ${files.length} faces...`);

const server = spawn("npx", ["vite", "--port", "4254", "--strictPort"], { cwd: APP_DIR, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 5000));
const browser = await launchChromium();

let rows;
try {
  const page = await browser.newPage();
  await page.goto("http://localhost:4254/");
  await page.waitForSelector("html[data-engine=\"ready\"]", { timeout: 90000 });

  rows = await page.evaluate(async (imgs) => {
    const { detect } = await import("/src/engine/landmarker.ts");
    const load = (u) => new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = u;
    });

    // The LOWER brow line only, medial to lateral.
    //
    // The first version of this used the whole brow ring, upper and lower edges
    // together, and asked which landmark sat highest. That finds the brow's top
    // EDGE (105, 66, 107) on every face, which says nothing about where along
    // its length the arch peaks — the question actually being asked. Comparing
    // points that lie across the brow's thickness answers a different question
    // than comparing points along its span.
    const BROW_R = [55, 65, 52, 53, 46];
    const MEDIAL = 55;
    const LATERAL = 46;
    const out = [];
    for (const u of imgs) {
      let img;
      try { img = await load(u); } catch { continue; }
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const c = document.createElement("canvas");
      c.width = iw; c.height = ih;
      c.getContext("2d").drawImage(img, 0, 0);
      let lm;
      try { lm = detect(c)?.faceLandmarks?.[0]; } catch { continue; }
      if (!lm?.length) continue;
      const P = (i) => ({ x: lm[i].x * iw, y: lm[i].y * ih });
      const tilt = (a, b) => (Math.atan2(P(a).y - P(b).y, Math.abs(P(b).x - P(a).x)) * 180) / Math.PI;

      // Highest = smallest y. Heights are normalised by the brow's own span so
      // they are comparable between a big face and a small one.
      let peak = BROW_R[0];
      for (const i of BROW_R) if (P(i).y < P(peak).y) peak = i;
      const span = Math.abs(P(LATERAL).x - P(MEDIAL).x) || 1;
      const row = { peak, tiltToTail: tilt(MEDIAL, LATERAL), tiltToPeak: tilt(MEDIAL, peak) };
      for (const i of BROW_R) {
        row[`t${i}`] = tilt(MEDIAL, i);
        row[`h${i}`] = (P(MEDIAL).y - P(i).y) / span;
      }
      out.push(row);
    }
    return out;
  }, files.map((f) => `data:image/jpeg;base64,${readFileSync(`${PHOTOS}/${f}`).toString("base64")}`));
} finally {
  await browser.close();
  server.kill("SIGTERM");
}

if (!rows?.length) { console.error("No faces measured."); process.exit(1); }

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const counts = new Map();
for (const r of rows) counts.set(r.peak, (counts.get(r.peak) ?? 0) + 1);

console.log(`\n${rows.length} faces.\n`);
console.log("Which landmark is the highest point of the right brow:");
for (const [id, n] of [...counts].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(id).padStart(4)}  ${n} face(s)  ${((n / rows.length) * 100).toFixed(0)}%`);
}

console.log("\nHeight above the medial end, as a fraction of brow span (bigger = higher):");
for (const id of [65, 52, 53, 46]) {
  const vals = rows.map((r) => r[`h${id}`]).filter(Number.isFinite);
  console.log(`  ${String(id).padStart(4)}  ${mean(vals).toFixed(4)}${id === 46 ? "   <- ours today" : ""}`);
}

console.log("\nTilt from the medial end to each candidate, mean over all faces:");
const cands = [65, 52, 53, 46];
for (const id of cands) {
  const vals = rows.map((r) => r[`t${id}`]).filter(Number.isFinite);
  console.log(`  medial -> ${String(id).padStart(3)}  ${mean(vals).toFixed(2)} deg${id === 46 ? "   <- ours today" : ""}`);
}
const toPeak = rows.map((r) => r.tiltToPeak);
const toTail = rows.map((r) => r.tiltToTail);
console.log(`  medial -> per-face peak  ${mean(toPeak).toFixed(2)} deg`);
console.log(
  `\nOurs (to the tail) averages ${mean(toTail).toFixed(2)} deg.` +
    `\nMeasuring to the per-face peak instead moves it by ${(mean(toPeak) - mean(toTail)).toFixed(2)} deg.` +
    `\nThe benchmark gap against the other product is about +11.9 deg.`,
);
