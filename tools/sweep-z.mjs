// Sweep POSE_CALIBRATION.zScale and pick the value that minimizes score
// disagreement across different photos of the same person. Uses the direct
// measure hook, so each scan is a few hundred milliseconds.
import { launchChromium } from "./launchChromium.mjs";
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

const APP_DIR = "/home/user/truemax";
const HERE = new URL("./", import.meta.url).pathname;
const DATA = process.env.TM_DATA ?? HERE + "../.calib/";

const manifest = JSON.parse(readFileSync(DATA + "manifest.json", "utf8"));
const key = (n) => n.replace(/[^a-zA-Z]/g, "_");
const sexOf = Object.fromEntries(manifest.map((m) => [key(m.name), m.sex]));
const leadOf = Object.fromEntries(manifest.map((m) => [key(m.name), m.file]));

const groups = {};
for (const f of readdirSync(DATA + "alts")) (groups[f.replace(/_\d+\.jpg$/, "")] ??= []).push(DATA + "alts/" + f);
for (const [p, files] of Object.entries(groups)) {
  if (leadOf[p]) files.unshift(leadOf[p]);
  if (files.length < 3) delete groups[p];
}

const Z_VALUES = process.env.TM_Z ? process.env.TM_Z.split(",").map(Number) : [1, 1.5, 2, 2.5, 3, 4, 5];
const dataUrl = (f) => `data:image/jpeg;base64,${readFileSync(f).toString("base64")}`;

const server = spawn("npx", ["vite", "preview", "--port", "4181", "--strictPort"], { cwd: APP_DIR, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const browser = await launchChromium();

try {
  const page = await browser.newPage();
  await page.goto("http://localhost:4181/");
  await page.waitForSelector("#engine-status.ready", { timeout: 30000 });

  const results = Object.fromEntries(Z_VALUES.map((z) => [z, {}]));
  for (const [person, files] of Object.entries(groups)) {
    const sex = sexOf[person] ?? "male";
    for (const f of files) {
      const url = dataUrl(f);
      for (const z of Z_VALUES) {
        const r = await page.evaluate(
          async ([u, s, zv]) => {
            window.__truemaxPose.zScale = zv;
            return await window.__truemaxMeasure(u, s);
          },
          [url, sex, z],
        );
        if (r?.faceFound && Math.abs(r.yaw) <= 28) (results[z][person] ??= []).push(r.overall);
      }
    }
  }

  console.log("\nz-scale   avg spread   worst   n");
  let best = null;
  for (const z of Z_VALUES) {
    const spreads = Object.values(results[z])
      .filter((s) => s.length >= 3)
      .map((s) => Math.max(...s) - Math.min(...s));
    if (!spreads.length) continue;
    const avg = spreads.reduce((a, b) => a + b, 0) / spreads.length;
    const worst = Math.max(...spreads);
    console.log(`${String(z).padEnd(9)} ${avg.toFixed(2).padStart(10)} ${worst.toFixed(1).padStart(7)} ${String(spreads.length).padStart(3)}`);
    if (!best || avg < best.avg) best = { z, avg, worst };
  }
  console.log(`\nbest z-scale: ${best.z} (avg spread ${best.avg.toFixed(2)}, worst ${best.worst.toFixed(1)})`);
} finally {
  await browser.close();
  server.kill();
  process.exit(0);
}
