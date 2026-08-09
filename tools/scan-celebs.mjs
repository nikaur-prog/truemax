// Scan every fetched portrait through the real engine; record measurements
// plus capture-quality (yaw/pitch/smile) for gating.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const APP_DIR = "/home/user/truemax";
const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url).pathname));

const server = spawn("npx", ["vite", "preview", "--port", "4177", "--strictPort"], { cwd: APP_DIR, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto("http://localhost:4177/");
  await page.waitForSelector("#engine-status.ready", { timeout: 30000 });

  for (const { name, sex, file } of manifest) {
    try {
      await page.click(`[data-sex="${sex}"]`);
      await page.evaluate(() => { window.__truemax = undefined; });
      await page.setInputFiles("#file-input", file);
      await page.waitForFunction(() => window.__truemax?.report || document.querySelector("#capRight")?.textContent === "NO FACE FOUND", { timeout: 25000 });
      const out = await page.evaluate((n) => {
        const t = window.__truemax;
        if (!t?.report) return null;
        return {
          entry: JSON.parse(t.celebEntry(n)),
          quality: {
            yaw: Math.round(t.quality.yawDeg * 10) / 10,
            pitch: Math.round(t.quality.pitchDeg * 10) / 10,
            smile: Math.round(t.quality.smileScore * 100) / 100,
          },
          overall: t.report.overall,
        };
      }, name);
      if (!out) {
        console.log(`NO FACE: ${name}`);
        await page.waitForSelector("#v-upload:not(.hidden)", { timeout: 8000 }).catch(() => page.reload().then(() => page.waitForSelector("#engine-status.ready", { timeout: 30000 })));
        continue;
      }
      results.push(out);
      console.log(`${name.padEnd(24)} ${sex.padEnd(7)} yaw ${String(out.quality.yaw).padStart(6)}  pitch ${String(out.quality.pitch).padStart(6)}  smile ${out.quality.smile}  overall ${out.overall}`);
      await page.click("#btn-new");
      await page.waitForSelector("#v-upload:not(.hidden)", { timeout: 8000 });
    } catch (e) {
      console.log(`ERROR: ${name} — ${String(e).slice(0, 90)}`);
      await page.reload();
      await page.waitForSelector("#engine-status.ready", { timeout: 30000 });
    }
  }
} finally {
  await browser.close();
  server.kill();
}

writeFileSync(new URL("./scans.json", import.meta.url).pathname, JSON.stringify(results, null, 2));
console.log(`\n${results.length}/${manifest.length} scans recorded → scans.json`);
process.exit(0);
