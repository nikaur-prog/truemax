// Measure every fetched portrait with the real engine via the direct hook,
// recording metrics plus capture quality for gating.
import { launchChromium } from "./launchChromium.mjs";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const APP_DIR = "/home/user/truemax";
const DATA = process.env.TM_DATA ?? new URL("../.calib/", import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(DATA + "manifest.json", "utf8"));

const server = spawn("npx", ["vite", "preview", "--port", "4182", "--strictPort"], { cwd: APP_DIR, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const browser = await launchChromium();

const results = [];
try {
  const page = await browser.newPage();
  await page.goto("http://localhost:4182/");
  await page.waitForSelector("#engine-status.ready", { timeout: 30000 });

  for (const { name, sex, file } of manifest) {
    try {
      const url = `data:image/jpeg;base64,${readFileSync(file).toString("base64")}`;
      const r = await page.evaluate(
        async ([u, s]) => await window.__truemaxMeasure(u, s),
        [url, sex],
      );
      if (!r?.faceFound) {
        console.log(`NO FACE: ${name}`);
        continue;
      }
      results.push({
        entry: { ...r.entry, name, sex },
        quality: {
          yaw: Math.round(r.yaw * 10) / 10,
          pitch: Math.round(r.pitch * 10) / 10,
          smile: Math.round(r.smile * 100) / 100,
        },
        overall: r.overall,
      });
      console.log(
        `${name.padEnd(22)} ${sex.padEnd(7)} yaw ${String(Math.round(r.yaw * 10) / 10).padStart(6)} ` +
          `pitch ${String(Math.round(r.pitch * 10) / 10).padStart(6)} smile ${(Math.round(r.smile * 100) / 100)} overall ${r.overall}`,
      );
    } catch (e) {
      console.log(`ERROR: ${name} — ${String(e).slice(0, 80)}`);
    }
  }
} finally {
  await browser.close();
  server.kill();
}

writeFileSync(DATA + "scans.json", JSON.stringify(results, null, 2));
console.log(`\n${results.length}/${manifest.length} scans recorded`);
process.exit(0);
