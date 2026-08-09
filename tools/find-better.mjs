// For celebrities whose lead portrait failed the frontal/expression gate,
// search Wikimedia Commons for alternative photos, scan each, and keep the
// most frontal + most neutral one. Capture quality drives measurement
// quality, so this is worth the extra fetches.
import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const APP_DIR = "/home/user/truemax";
const UA = "TrueMaxDev/0.1 (reference measurement fetch)";
const DIR = new URL("./alts/", import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });

const scans = JSON.parse(readFileSync(new URL("./scans.json", import.meta.url).pathname));
const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url).pathname));
const sexOf = Object.fromEntries(manifest.map((m) => [m.name, m.sex]));

const GATE = { yaw: 15, pitch: 16, smile: 0.55 };
const ok = (q) => Math.abs(q.yaw) <= GATE.yaw && Math.abs(q.pitch) <= GATE.pitch && q.smile <= GATE.smile;
// Lower is better: how far from an ideal neutral frontal capture
const cost = (q) => Math.abs(q.yaw) + Math.abs(q.pitch) * 0.9 + q.smile * 22;

const targets = scans.filter((s) => !ok(s.quality)).map((s) => s.entry.name);
console.log(`${targets.length} celebrities need a better photo\n`);

function commonsCandidates(name, limit = 6) {
  const q = encodeURIComponent(`${name} filetype:bitmap`);
  const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${q}&gsrnamespace=6&gsrlimit=${limit}&prop=imageinfo&iiprop=url&iiurlwidth=1100&format=json`;
  try {
    const j = JSON.parse(execSync(`curl -sSL -A "${UA}" "${url}"`, { timeout: 30000 }).toString());
    return Object.values(j.query?.pages ?? {})
      .map((p) => p.imageinfo?.[0]?.thumburl?.split("?")[0])
      .filter(Boolean);
  } catch {
    return [];
  }
}

const server = spawn("npx", ["vite", "preview", "--port", "4178", "--strictPort"], { cwd: APP_DIR, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const improved = [];

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto("http://localhost:4178/");
  await page.waitForSelector("#engine-status.ready", { timeout: 30000 });

  for (const name of targets) {
    const sex = sexOf[name] ?? "male";
    const current = scans.find((s) => s.entry.name === name);
    let best = { cost: cost(current.quality), scan: current, src: "wikipedia-lead" };

    const urls = commonsCandidates(name);
    for (const [i, url] of urls.entries()) {
      const dest = `${DIR}${name.replace(/[^a-zA-Z]/g, "_")}_${i}.jpg`;
      try {
        if (!existsSync(dest)) execSync(`curl -sSL -A "${UA}" -o "${dest}" "${url}"`, { timeout: 45000 });
        if (!/image/i.test(execSync(`file -b "${dest}"`).toString())) continue;

        await page.click(`[data-sex="${sex}"]`);
        await page.evaluate(() => { window.__truemax = undefined; });
        await page.setInputFiles("#file-input", dest);
        await page.waitForFunction(
          () => window.__truemax?.report || document.querySelector("#capRight")?.textContent === "NO FACE FOUND",
          { timeout: 20000 },
        );
        const out = await page.evaluate((n) => {
          const t = window.__truemax;
          if (!t?.report) return null;
          return {
            entry: JSON.parse(t.celebEntry(n)),
            quality: { yaw: Math.round(t.quality.yawDeg * 10) / 10, pitch: Math.round(t.quality.pitchDeg * 10) / 10, smile: Math.round(t.quality.smileScore * 100) / 100 },
            overall: t.report.overall,
          };
        }, name);
        await page.click("#btn-new").catch(() => {});
        await page.waitForSelector("#v-upload:not(.hidden)", { timeout: 8000 }).catch(() => {});
        if (!out) continue;
        const c = cost(out.quality);
        if (c < best.cost) best = { cost: c, scan: out, src: url };
      } catch {
        await page.reload();
        await page.waitForSelector("#engine-status.ready", { timeout: 30000 });
      }
    }

    if (best.src !== "wikipedia-lead") {
      const idx = scans.findIndex((s) => s.entry.name === name);
      scans[idx] = best.scan;
      improved.push(name);
      console.log(`IMPROVED ${name.padEnd(22)} yaw ${String(best.scan.quality.yaw).padStart(6)} pitch ${String(best.scan.quality.pitch).padStart(6)} smile ${best.scan.quality.smile} ${ok(best.scan.quality) ? "PASS" : "still fails"}`);
    } else {
      console.log(`no better   ${name}`);
    }
  }
} finally {
  await browser.close();
  server.kill();
}

writeFileSync(new URL("./scans.json", import.meta.url).pathname, JSON.stringify(scans, null, 2));
console.log(`\n${improved.length} improved; ${scans.filter((s) => ok(s.quality)).length}/${scans.length} now pass the strict gate`);
process.exit(0);
