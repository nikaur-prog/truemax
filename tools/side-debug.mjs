// One-off: print the segmentation seeder's internal anchor rows for one image.
import { launchChromium } from "./launchChromium.mjs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const file = process.argv[2];

const server = spawn("npx", ["vite", "--port", "4262", "--strictPort"], { cwd: APP_DIR, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 5000));
const browser = await launchChromium();
try {
  const page = await browser.newPage();
  await page.goto("http://localhost:4262/");
  await page.waitForSelector('html[data-engine="ready"]', { timeout: 90000 });
  const dataUrl = `data:image/png;base64,${readFileSync(file).toString("base64")}`;
  const out = await page.evaluate(async (url) => {
    const { sideMaskGeometry } = await import("/src/engine/sideMask.ts");
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
    const g = await sideMaskGeometry(src);
    if (!g) return { error: "no mask" };
    const H = g.faceBottom - g.faceTop;
    const prot = [];
    for (let y = g.faceTop; y <= g.faceBottom; y++) {
      const v = g.front[y];
      prot.push(Number.isNaN(v) ? null : Math.round(g.faceDir * v));
    }
    // Reimplement seedFromMask's row selection exactly, to see its picks.
    const sm = new Float32Array(g.h).fill(NaN);
    for (let y = g.faceTop; y <= g.faceBottom; y++) {
      let sum = 0, n = 0;
      for (let k = -2; k <= 2; k++) {
        const v = g.front[y + k];
        if (!Number.isNaN(v)) { sum += v; n++; }
      }
      if (n) sm[y] = (g.faceDir * sum) / n;
    }
    const rowAt = (f) => g.faceTop + Math.round(f * H);
    const extremum = (y0, y1, sign) => {
      let best = -1, bestV = -Infinity;
      const lo = Math.max(g.faceTop, Math.min(y0, y1));
      const hi = Math.min(g.faceBottom, Math.max(y0, y1));
      for (let y = lo; y <= hi; y++) {
        const v = sm[y];
        if (Number.isNaN(v)) continue;
        if (sign * v > bestV) { bestV = sign * v; best = y; }
      }
      return best;
    };
    const noseY = extremum(rowAt(0.28), rowAt(0.75), 1);
    const nasionY = extremum(rowAt(0.05), noseY - Math.round(0.06 * H), -1);
    const glabellaY = nasionY > 0 ? extremum(nasionY - Math.round(0.15 * H), nasionY - Math.round(0.03 * H), 1) : -1;
    return {
      maskDims: [g.w, g.h],
      canvas: [src.width, src.height],
      faceDir: g.faceDir,
      faceTop: g.faceTop,
      faceBottom: g.faceBottom,
      H,
      noseY, nasionY, glabellaY,
      display: { noseY: noseY * 640 / src.width, nasionY: nasionY * 640 / src.width, glabellaY: glabellaY * 640 / src.width },
      curve: prot.filter((_, i) => i % 8 === 0),
    };
  }, dataUrl);
  console.log(JSON.stringify(out));
} finally {
  await browser.close();
  server.kill();
}
