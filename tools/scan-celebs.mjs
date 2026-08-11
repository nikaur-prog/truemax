// Measure every fetched portrait with the real engine via the direct hook,
// recording metrics plus capture quality for gating.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { dataFile, launchChromium, startVite } from "./runtime.mjs";

const requestedSets = process.env.TM_SETS
  ? new Set(process.env.TM_SETS.split(",").map((name) => name.trim()).filter(Boolean))
  : null;
const sets = [
  { label: "celebrity", manifest: "manifest.json", output: "scans.json" },
  { label: "population", manifest: "pop-manifest.json", output: "pop-scans.json" },
].filter((set) => !requestedSets || requestedSets.has(set.label));

const { server, url } = await startVite(4182);
const browser = await launchChromium(chromium);
try {
  const page = await browser.newPage();
  await page.goto(url);
  await page.waitForSelector("#engine-status.ready", { timeout: 60_000 });

  for (const set of sets) {
    const manifest = JSON.parse(readFileSync(dataFile(set.manifest), "utf8"));
    const results = [];
    console.log(`\nScanning ${manifest.length} ${set.label} reference photos`);
    for (const { name, sex, file } of manifest) {
      try {
        const imageUrl = `data:image/jpeg;base64,${readFileSync(file).toString("base64")}`;
        const r = await page.evaluate(
          async ([u, s]) => await window.__truemaxMeasure(u, s),
          [imageUrl, sex],
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
            faceWidthFrac: Math.round(r.faceWidthFrac * 10_000) / 10_000,
          },
          overall: r.overall,
        });
        console.log(
          `${name.padEnd(22)} ${sex.padEnd(7)} yaw ${String(Math.round(r.yaw * 10) / 10).padStart(6)} ` +
            `pitch ${String(Math.round(r.pitch * 10) / 10).padStart(6)} smile ${Math.round(r.smile * 100) / 100} overall ${r.overall}`,
        );
      } catch (e) {
        console.log(`ERROR: ${name} — ${String(e).slice(0, 80)}`);
      }
    }
    writeFileSync(dataFile(set.output), JSON.stringify(results, null, 2));
    console.log(`${results.length}/${manifest.length} ${set.label} scans recorded`);
  }
} finally {
  await browser.close();
  server.kill();
}
process.exit(0);
