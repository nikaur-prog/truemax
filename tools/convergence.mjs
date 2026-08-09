// Acceptance criterion: different photos of the SAME person must score alike.
//
// Photos are filtered to portrait-scale faces (>=22% of frame width). Scraped
// sets are full of group shots where the detector locks onto a different
// person entirely — including those silently measures strangers against each
// other and makes the engine look far less stable than it is.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const APP_DIR = "/home/user/truemax";
const DATA = process.env.TM_DATA ?? new URL("../.calib/", import.meta.url).pathname;
const SET = process.env.TM_SET ?? "alts2-manifest.json";
const MIN_FACE = 0.22;
const MAX_YAW = 28;
const MAX_PITCH = 26;

const rows = JSON.parse(readFileSync(DATA + SET, "utf8"));
const groups = {};
for (const r of rows) (groups[r.person ?? r.name] ??= []).push(r);

const server = spawn("npx", ["vite", "preview", "--port", "4188", "--strictPort"], { cwd: APP_DIR, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

try {
  const page = await browser.newPage();
  await page.goto("http://localhost:4188/");
  await page.waitForSelector("#engine-status.ready", { timeout: 30000 });

  const spreads = [];
  for (const [person, files] of Object.entries(groups)) {
    const kept = [];
    for (const f of files) {
      const url = `data:image/jpeg;base64,${readFileSync(f.file).toString("base64")}`;
      const m = await page.evaluate(async ([u, s]) => await window.__truemaxMeasure(u, s), [url, f.sex]);
      if (!m?.faceFound) continue;
      if (m.faceWidthFrac < MIN_FACE) continue;
      if (Math.abs(m.yaw) > MAX_YAW || Math.abs(m.pitch) > MAX_PITCH) continue;
      kept.push(m.overall);
    }
    if (kept.length < 3) continue;
    const spread = Math.max(...kept) - Math.min(...kept);
    const mean = kept.reduce((a, b) => a + b, 0) / kept.length;
    const sd = Math.sqrt(kept.reduce((a, b) => a + (b - mean) ** 2, 0) / (kept.length - 1));
    spreads.push({ person, n: kept.length, spread, sd });
    console.log(`${person.replace(/_/g, " ").padEnd(22)} n=${kept.length}  spread ${spread.toFixed(1)}  sd ${sd.toFixed(2)}  [${kept.join(", ")}]`);
  }

  const avgSpread = spreads.reduce((a, s) => a + s.spread, 0) / (spreads.length || 1);
  const avgSD = spreads.reduce((a, s) => a + s.sd, 0) / (spreads.length || 1);
  console.log(`\npeople ${spreads.length}   average spread ${avgSpread.toFixed(2)}   average SD ${avgSD.toFixed(2)}`);
  console.log(avgSD <= 0.4 ? "CONVERGENCE OK" : "CONVERGENCE POOR");
} finally {
  await browser.close();
  server.kill();
  process.exit(0);
}
