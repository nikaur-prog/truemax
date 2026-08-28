// Measure the Higgsfield synthetic portrait candidates with the real engine.
//
// Same harness as build-demo-reel.mjs (vite preview + headless Chromium +
// window.__truemaxMeasure) but the inputs are local files rather than
// Wikimedia downloads, so there is no licence machinery: these faces are
// AI-generated for the reel and the reel will say so on screen.
//
// This pass only MEASURES and prints a table. Picking the cast is a separate
// decision made on the numbers plus the pictures.
import { launchChromium } from "./launchChromium.mjs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const CAST_DIR = process.env.TM_CAST_DIR;
if (!CAST_DIR) {
  console.error("TM_CAST_DIR must point at the candidate images");
  process.exit(1);
}

// index:sex pairs for every candidate file cand-<index>.png
const ROSTER = (process.env.TM_CAST ?? "0:male,1:female,2:male,3:female,4:male,6:male,7:female,8:male,9:female,10:male,11:female")
  .split(",").map((s) => { const [id, sex] = s.split(":"); return { id: id.trim(), sex: sex.trim() }; });

const captureCost = (m) => m.smile * 3 + Math.abs(m.yaw) / 28 + Math.abs(m.pitch) / 26;

const server = spawn("npx", ["vite", "preview", "--port", "4207", "--strictPort"], { cwd: APP_DIR, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 3500));
const browser = await launchChromium();

const out = [];
try {
  const page = await browser.newPage();
  await page.goto("http://localhost:4207/");
  await page.waitForSelector('html[data-engine="ready"]', { timeout: 60000 });

  for (const { id, sex } of ROSTER) {
    const b64 = readFileSync(`${CAST_DIR}/cand-${id}.png`).toString("base64");
    let m = null;
    try {
      m = await page.evaluate(async ([u, s]) => {
        const r = await window.__truemaxMeasure(u, s);
        if (!r.faceFound) return null;
        return { overall: r.overall, pillars: r.pillars, regions: r.regions,
          lm: r.reelLandmarks, box: r.reelBox, yaw: r.yaw, pitch: r.pitch,
          smile: r.smile, widthFrac: r.faceWidthFrac };
      }, [`data:image/png;base64,${b64}`, sex]);
    } catch (e) {
      console.log(`cand-${id}: measure threw ${e.message}`);
    }
    if (!m) { console.log(`cand-${id}: no face found`); continue; }
    out.push({ id, sex, ...m, cost: captureCost(m) });
    console.log(
      `cand-${id.padEnd(2)} ${sex.padEnd(6)} overall ${String(m.overall).padStart(4)}  ` +
      `smile ${m.smile.toFixed(2)} yaw ${m.yaw.toFixed(1)} pitch ${m.pitch.toFixed(1)} ` +
      `width ${m.widthFrac.toFixed(2)} cost ${captureCost(m).toFixed(3)}`,
    );
  }
} finally {
  await browser.close();
  server.kill();
}

writeFileSync(`${CAST_DIR}/measured.json`, JSON.stringify(out, null, 1));
console.log(`\nwrote ${out.length} measurements to measured.json`);
process.exit(0);
