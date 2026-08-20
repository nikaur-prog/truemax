// Is our bizygomatic width actually the bizygomatic width?
//
// `bizygo` is dist(landmark 116, landmark 345) and it divides SIX metrics —
// eyeSeparationRatio, fwhr, cheekboneHeight, jawCheekRatio, fifthsEyeRatio and
// facialIndex. The benchmark file has us reading high against a competing
// product on eyeSeparationRatio (+6.0%, three people) and jawCheekRatio
// (+10.1%), and both of those divide by bizygo. A denominator that is too
// narrow inflates both by the same fraction, which is exactly that pattern.
//
// So: measure, on real faces, how far 116/345 sit inside the widest part of
// the face at cheekbone height. If they are well inside it, `bizygo` is not
// the bizygomatic width and one landmark change moves six scores.
//
// This is a MEASUREMENT of our own pipeline against our own reference
// photographs. It borrows nothing from anyone else — the competing product's
// numbers only told us where to look.
//
//   node tools/bizygo-check.mjs
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

const APP_DIR = "/home/user/truemax";
const PHOTOS = process.env.TM_PHOTOS ?? `${APP_DIR}/.calib/pop-photos`;
const LIMIT = Number(process.env.TM_LIMIT ?? 60);

const files = readdirSync(PHOTOS).filter((f) => f.endsWith(".jpg")).slice(0, LIMIT);
console.log(`Measuring ${files.length} faces...`);

const server = spawn("npx", ["vite", "--port", "4251", "--strictPort"], { cwd: APP_DIR, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 5000));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

let rows;
try {
  const page = await browser.newPage();
  await page.goto("http://localhost:4251/");
  await page.waitForSelector("#engine-status.ready", { timeout: 90000 });

  rows = await page.evaluate(async (imgs) => {
    const { detect } = await import("/src/engine/landmarker.ts");
    const load = (u) => new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = u;
    });

    // MediaPipe's face-oval ring. The outer boundary of the mesh, so the
    // widest pair on it is the widest the mesh believes the face to be.
    const OVAL = [
      10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
      378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
      162, 21, 54, 103, 67, 109,
    ];
    const out = [];
    for (const u of imgs) {
      let img;
      try { img = await load(u); } catch { continue; }
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const c = document.createElement("canvas");
      c.width = iw; c.height = ih;
      c.getContext("2d").drawImage(img, 0, 0);
      // detect() is synchronous and returns a FaceLandmarkerResult, so the
      // landmark array is one level down.
      let lm;
      try { lm = detect(c)?.faceLandmarks?.[0]; } catch { continue; }
      if (!lm || !lm.length) continue;
      const P = (i) => ({ x: lm[i].x * iw, y: lm[i].y * ih });

      const m116 = P(116), m345 = P(345);
      const ours = Math.hypot(m345.x - m116.x, m345.y - m116.y);
      const cheekY = (m116.y + m345.y) / 2;

      // Widest pair anywhere on the oval — the mesh's own idea of face width.
      let widest = 0;
      for (const a of OVAL) for (const b of OVAL) {
        const pa = P(a), pb = P(b);
        const d = Math.hypot(pb.x - pa.x, pb.y - pa.y);
        if (d > widest) widest = d;
      }

      // Oval width measured AT cheekbone height, which is the fair comparison:
      // the widest point of the whole oval could sit at the jaw or the temple.
      let leftX = Infinity, rightX = -Infinity;
      for (const i of OVAL) {
        const p = P(i);
        if (Math.abs(p.y - cheekY) > 0.06 * ih) continue;
        if (p.x < leftX) leftX = p.x;
        if (p.x > rightX) rightX = p.x;
      }
      const atCheek = rightX - leftX;

      // Sanity: skip anything that failed to find oval points at that height.
      if (!Number.isFinite(atCheek) || atCheek <= 0) continue;
      out.push({ ours, atCheek, widest });
    }
    return out;
    // Data URLs rather than paths: the dev server does not serve .calib, and
    // inlining is what the other scanning tools here already do.
  }, files.map((f) => `data:image/jpeg;base64,${readFileSync(`${PHOTOS}/${f}`).toString("base64")}`));
} finally {
  await browser.close();
  server.kill("SIGTERM");
}

if (!rows?.length) {
  console.error("No faces measured.");
  process.exit(1);
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const vsCheek = rows.map((r) => (r.ours / r.atCheek) * 100);
const vsWidest = rows.map((r) => (r.ours / r.widest) * 100);

console.log(`\n${rows.length} faces measured.\n`);
console.log(`our bizygo (116-345) as a share of the mesh's face width AT cheekbone height:`);
console.log(`  mean ${mean(vsCheek).toFixed(1)}%   median ${med(vsCheek).toFixed(1)}%`);
console.log(`\nand as a share of the widest span anywhere on the face oval:`);
console.log(`  mean ${mean(vsWidest).toFixed(1)}%   median ${med(vsWidest).toFixed(1)}%`);

const shortfall = 100 - mean(vsCheek);
console.log(
  `\nOur bizygo runs ${shortfall.toFixed(1)}% narrower than the face at that height.` +
    `\nA denominator that short inflates every ratio dividing by it by about ` +
    `${(100 / mean(vsCheek) * 100 - 100).toFixed(1)}%.`,
);
console.log(
  `\nFor reference, the benchmark has us reading high by 6.0% on eyeSeparationRatio` +
    `\nand 10.1% on jawCheekRatio, both of which divide by bizygo.`,
);
