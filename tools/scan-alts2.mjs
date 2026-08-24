// Measure every alternate photo too, so the tuner can evaluate cross-photo
// convergence offline without re-running the browser.
import { launchChromium } from "./launchChromium.mjs";
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const APP_DIR = "/home/user/truemax";
const HERE = new URL("./", import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(HERE + "manifest.json", "utf8"));
const key = (n) => n.replace(/[^a-zA-Z]/g, "_");
const sexOf = Object.fromEntries(manifest.map((m) => [key(m.name), m.sex]));
const leadOf = Object.fromEntries(manifest.map((m) => [key(m.name), m.file]));

const groups={};for(const r of JSON.parse(readFileSync(HERE+"alts2-manifest.json","utf8"))){(groups[r.person]??=[]).push(r.file);}
const sexOf2=Object.fromEntries(JSON.parse(readFileSync(HERE+"alts2-manifest.json","utf8")).map(r=>[r.person,r.sex]));

const server = spawn("npx", ["vite", "preview", "--port", "4187", "--strictPort"], { cwd: APP_DIR, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const browser = await launchChromium();
const out = [];
try {
  const page = await browser.newPage();
  await page.goto("http://localhost:4184/");
  await page.waitForSelector("html[data-engine=\"ready\"]", { timeout: 30000 });
  for (const [person, files] of Object.entries(groups)) {
    const sex = sexOf2[person] ?? "male";
    for (const f of files) {
      const url = `data:image/jpeg;base64,${readFileSync(f).toString("base64")}`;
      const r = await page.evaluate(async ([u, s]) => await window.__truemaxMeasure(u, s), [url, sex]);
      if (r?.faceFound) out.push({ person, sex, yaw: r.yaw, pitch: r.pitch, faceWidthFrac: r.faceWidthFrac, metrics: r.entry.metrics });
    }
    console.log(`${person}: ${out.filter((o) => o.person === person).length} photos`);
  }
} finally {
  await browser.close();
  server.kill();
}
writeFileSync(HERE + "alt2-scans.json", JSON.stringify(out, null, 2));
console.log(`${out.length} alt photo measurements written`);
process.exit(0);
