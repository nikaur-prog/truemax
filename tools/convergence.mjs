// Acceptance criterion #2: different photos of the SAME person must produce
// near-identical scores. This is the direct test of pose normalization.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

const APP_DIR = "/home/user/truemax";
const ALTS = new URL("./alts/", import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url).pathname));
const sexOf = Object.fromEntries(manifest.map((m) => [m.name.replace(/[^a-zA-Z]/g, "_"), m.sex]));
const leadOf = Object.fromEntries(manifest.map((m) => [m.name.replace(/[^a-zA-Z]/g, "_"), m.file]));

// Group alternate photos by person
const groups = {};
for (const f of readdirSync(ALTS)) {
  const person = f.replace(/_\d+\.jpg$/, "");
  (groups[person] ??= []).push(ALTS + f);
}
for (const [person, files] of Object.entries(groups)) {
  if (leadOf[person]) files.unshift(leadOf[person]);
  if (files.length < 3) delete groups[person];
}

const server = spawn("npx", ["vite", "preview", "--port", "4179", "--strictPort"], { cwd: APP_DIR, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto("http://localhost:4179/");
  await page.waitForSelector("#engine-status.ready", { timeout: 30000 });

  const spreads = [];
  for (const [person, files] of Object.entries(groups)) {
    const sex = sexOf[person] ?? "male";
    const rows = [];
    for (const f of files) {
      try {
        await page.click(`[data-sex="${sex}"]`);
        await page.evaluate(() => { window.__truemax = undefined; });
        await page.setInputFiles("#file-input", f);
        await page.waitForFunction(
          () => window.__truemax?.report || document.querySelector("#capRight")?.textContent === "NO FACE FOUND",
          { timeout: 20000 },
        );
        const r = await page.evaluate(() => {
          const t = window.__truemax;
          if (!t?.report) return null;
          return {
            overall: t.report.overall,
            yaw: Math.round(t.quality.yawDeg * 10) / 10,
            pitch: Math.round(t.quality.pitchDeg * 10) / 10,
            // Pose the geometry layer actually removed
            gYaw: Math.round((t.geomPose?.yawDeg ?? 0) * 10) / 10,
          };
        });
        await page.click("#btn-new").catch(() => {});
        await page.waitForSelector("#v-upload:not(.hidden)", { timeout: 8000 }).catch(() => {});
        if (r) rows.push(r);
      } catch {
        await page.reload();
        await page.waitForSelector("#engine-status.ready", { timeout: 30000 });
      }
    }
    if (rows.length < 3) continue;
    // Only compare photos whose capture is within the usable envelope
    const usable = rows.filter((r) => Math.abs(r.yaw) <= 28 && Math.abs(r.pitch) <= 26);
    if (usable.length < 3) continue;
    const scores = usable.map((r) => r.overall);
    const spread = Math.max(...scores) - Math.min(...scores);
    spreads.push({ person, n: usable.length, spread, scores, yaws: usable.map((r) => r.yaw) });
    console.log(
      `${person.replace(/_/g, " ").padEnd(22)} n=${usable.length}  spread ${spread.toFixed(1)}  ` +
        `scores [${scores.join(", ")}]  yaws [${usable.map((r) => r.yaw).join(", ")}]`,
    );
  }

  const avg = spreads.reduce((a, s) => a + s.spread, 0) / (spreads.length || 1);
  const worst = Math.max(...spreads.map((s) => s.spread));
  console.log(`\naverage spread ${avg.toFixed(2)}   worst ${worst.toFixed(1)}`);
  console.log(avg <= 0.5 ? "CONVERGENCE OK" : "CONVERGENCE POOR");
} finally {
  await browser.close();
  server.kill();
  process.exit(0);
}
