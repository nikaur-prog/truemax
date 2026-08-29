// RESEARCH SPIKE — not wired into the app. Does the segmentation model give us
// anything to localize the ear directly, instead of guessing it from a
// population-average template?
//
// The multiclass segmenter has no "ear" category (0 bg, 1 hair, 2 body-skin,
// 3 face-skin, 4 clothes, 5 accessories) — so there is no direct signal. The
// only plausible proxy: on a profile, an ear not fully covered by hair often
// shows as a small, roughly circular patch of skin-category pixels SEPARATE
// from the main face blob, sitting inside the hair-bounded head silhouette.
// This does connected-component labeling on skin categories, finds candidate
// blobs other than the main face, and checks whether any of them land near
// the hand-labeled tragion position across the dataset.
import { launchChromium } from "./launchChromium.mjs";
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const labels = JSON.parse(readFileSync(`${APP_DIR}/.side-dataset/labels.json`, "utf8"));
const DISPLAY_W = 640;

const server = spawn("npx", ["vite", "--port", "4269", "--strictPort"], { cwd: APP_DIR, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 5000));
const browser = await launchChromium();
try {
  const page = await browser.newPage();
  await page.goto("http://localhost:4269/");
  await page.waitForSelector('html[data-engine="ready"]', { timeout: 90000 });

  const files = readdirSync(`${APP_DIR}/.side-dataset/raw`)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .sort();

  const rows = [];
  for (const f of files) {
    const name = f.replace(/\..*/, "");
    const label = labels[name];
    if (!label) continue;
    const dataUrl = `data:image/png;base64,${readFileSync(`${APP_DIR}/.side-dataset/raw/${f}`).toString("base64")}`;
    const out = await page.evaluate(async (url) => {
      const { segmentCategories } = await import("/src/engine/headCovering.ts");
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = url;
      });
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d").drawImage(img, 0, 0);
      const seg = await segmentCategories(c);
      if (!seg) return null;
      const { data, width: w, height: h } = seg;
      const FACE_SKIN = 3;
      const BODY_SKIN = 2;
      const HAIR = 1;
      const isSkin = (v) => v === FACE_SKIN || v === BODY_SKIN;

      // Connected components (4-neighbour) over skin-category pixels.
      const labelsArr = new Int32Array(w * h).fill(-1);
      const blobs = [];
      const stackX = new Int32Array(w * h);
      const stackY = new Int32Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          if (!isSkin(data[idx]) || labelsArr[idx] !== -1) continue;
          let sp = 0;
          stackX[sp] = x;
          stackY[sp] = y;
          sp++;
          labelsArr[idx] = blobs.length;
          let sumX = 0, sumY = 0, n = 0, minX = x, maxX = x, minY = y, maxY = y;
          while (sp > 0) {
            sp--;
            const cx = stackX[sp], cy = stackY[sp];
            sumX += cx; sumY += cy; n++;
            if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
            if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
            const neighbours = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
            for (const [nx, ny] of neighbours) {
              if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
              const nidx = ny * w + nx;
              if (!isSkin(data[nidx]) || labelsArr[nidx] !== -1) continue;
              labelsArr[nidx] = blobs.length;
              stackX[sp] = nx; stackY[sp] = ny; sp++;
            }
          }
          blobs.push({ n, cx: sumX / n, cy: sumY / n, minX, maxX, minY, maxY });
        }
      }
      blobs.sort((a, b) => b.n - a.n);
      const main = blobs[0];
      if (!main) return { error: "no skin blobs" };
      // Candidates: other blobs, size-filtered (an ear is small — a few
      // hundred to a couple thousand pixels at this resolution, not a stray
      // pixel and not another major body region), reported with their
      // position and how much hair surrounds them (an ear sits IN hair).
      const candidates = blobs.slice(1, 12).map((b) => {
        // Hair fraction in a ring just outside the blob's box.
        const pad = Math.max(4, Math.round((b.maxX - b.minX) * 0.5));
        const rx0 = Math.max(0, b.minX - pad), rx1 = Math.min(w, b.maxX + pad);
        const ry0 = Math.max(0, b.minY - pad), ry1 = Math.min(h, b.maxY + pad);
        let hairN = 0, ringN = 0;
        for (let y = ry0; y < ry1; y++) {
          for (let x = rx0; x < rx1; x++) {
            const idx = y * w + x;
            const inBox = x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
            if (inBox) continue;
            ringN++;
            if (data[idx] === HAIR) hairN++;
          }
        }
        return { n: b.n, cx: b.cx, cy: b.cy, hairSurround: ringN ? hairN / ringN : 0 };
      });
      return {
        w, h,
        mainN: main.n,
        candidates,
      };
    }, dataUrl);

    if (!out || out.error) {
      rows.push({ name, error: out?.error ?? "no seg" });
      continue;
    }
    const scale = DISPLAY_W / out.w;
    const tragion = label.points.tragion;
    const condylion = label.points.condylion;
    if (!tragion) { rows.push({ name, error: "no tragion label" }); continue; }
    // Best candidate = closest to the hand-labeled tragion, in display px.
    let best = null, bestDist = Infinity;
    for (const c of out.candidates) {
      const dx = c.cx * scale - tragion.x;
      const dy = c.cy * scale - tragion.y;
      const dist = Math.hypot(dx, dy);
      if (dist < bestDist) { bestDist = dist; best = c; }
    }
    // Face height in display px, for a normalized error.
    const fh = Math.hypot(
      (label.points.trichion?.x ?? 0) - (label.points.menton?.x ?? label.points.pogonion?.x ?? 0),
      (label.points.trichion?.y ?? 0) - (label.points.menton?.y ?? label.points.pogonion?.y ?? 0),
    ) || 640;
    rows.push({
      name,
      candidateCount: out.candidates.length,
      bestDistPx: bestDist === Infinity ? null : +bestDist.toFixed(1),
      bestErrPctHeight: bestDist === Infinity ? null : +((bestDist / fh) * 100).toFixed(1),
      bestHairSurround: best ? +best.hairSurround.toFixed(2) : null,
      bestSize: best ? best.n : null,
    });
  }
  console.log(JSON.stringify(rows, null, 1));
  const withDist = rows.filter((r) => r.bestErrPctHeight != null);
  const errs = withDist.map((r) => r.bestErrPctHeight).sort((a, b) => a - b);
  const median = errs.length ? errs[Math.floor(errs.length / 2)] : null;
  const p90 = errs.length ? errs[Math.floor(errs.length * 0.9)] : null;
  console.log(`\n${withDist.length}/${rows.length} faces had a candidate blob at all.`);
  console.log(`Nearest-candidate error vs hand-labeled tragion, % of face height: median ${median} / p90 ${p90}`);
} finally {
  await browser.close();
  server.kill();
}
