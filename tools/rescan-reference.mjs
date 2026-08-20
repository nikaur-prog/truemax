// Re-measure both local reference archives with the current browser engine.
// Photos stay in the gitignored .calib directory; only generated norms/code
// are ever committed.
import { chromium } from "playwright";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const DATA = process.env.TM_DATA ?? fileURLToPath(new URL("../.calib/", import.meta.url));
const PORT = Number(process.env.TM_PORT ?? 4188);
const CHROME = process.env.TM_CHROME ?? [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/opt/pw-browsers/chromium",
].find(existsSync);

if (!CHROME) throw new Error("No Chrome executable found. Set TM_CHROME.");

const server = spawn(
  "npx",
  ["vite", "preview", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
  { cwd: APP_DIR, stdio: "ignore" },
);

for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/`);
    if (r.ok) break;
  } catch {
    // Still starting.
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (i === 39) throw new Error("Preview server did not start");
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForSelector("#engine-status.ready", { timeout: 30000 });

  const scan = async (manifestName, outputName) => {
    // The photo archives are gitignored, so a fresh checkout has whichever
    // ones were restored into .calib and not the others. Skipping a missing
    // archive with a clear line beats crashing, which used to abandon the
    // archives that ARE present because of one that is not.
    if (!existsSync(`${DATA}${manifestName}`)) {
      console.log(`skip ${manifestName}: not in ${DATA} — nothing to rescan for ${outputName}`);
      return;
    }
    const manifest = JSON.parse(readFileSync(`${DATA}${manifestName}`, "utf8"));
    const results = [];
    for (const [index, { name, sex, file }] of manifest.entries()) {
      try {
        const url = `data:image/jpeg;base64,${readFileSync(file).toString("base64")}`;
        const measured = await page.evaluate(
          async ([u, s]) => await window.__truemaxMeasure(u, s),
          [url, sex],
        );
        if (!measured?.faceFound) continue;
        results.push({
          entry: { ...measured.entry, name, sex },
          quality: {
            yaw: Math.round(measured.yaw * 10) / 10,
            pitch: Math.round(measured.pitch * 10) / 10,
            smile: Math.round(measured.smile * 100) / 100,
          },
          overall: measured.overall,
        });
      } catch (error) {
        console.log(`skip ${name}: ${String(error).slice(0, 90)}`);
      }
      if ((index + 1) % 10 === 0 || index + 1 === manifest.length) {
        console.log(`${outputName}: ${index + 1}/${manifest.length} (${results.length} measured)`);
      }
    }
    writeFileSync(`${DATA}${outputName}`, JSON.stringify(results, null, 2));
  };

  await scan("manifest.json", "scans.json");
  await scan("pop-manifest.json", "pop-scans.json");
} finally {
  await browser.close();
  server.kill();
}
