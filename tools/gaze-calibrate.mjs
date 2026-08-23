// Pick the gaze tolerance from real portraits instead of guessing it.
//
// The reference sets are photographs of people looking at a photographer's
// lens, which is exactly the shot the capture guide is asking someone to take.
// Whatever iris offset those portraits land at IS "looking at the lens"; the
// threshold should sit at the far tail of that distribution, tight enough to
// catch someone reading their own image but loose enough that a good shot
// never gets held back by it.
import { launchChromium } from "./launchChromium.mjs";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const APP_DIR = "/home/user/truemax";
const DATA = process.env.TM_DATA ?? new URL("../.calib/", import.meta.url).pathname;

const FACES = [
  ...JSON.parse(readFileSync(DATA + "pop-manifest.json", "utf8")),
  ...JSON.parse(readFileSync(DATA + "manifest.json", "utf8")),
];

const server = spawn("npx", ["vite", "preview", "--port", "4207", "--strictPort"], {
  cwd: APP_DIR,
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 2500));
const browser = await launchChromium();

const rows = [];
try {
  const page = await browser.newPage();
  await page.goto("http://localhost:4207/");
  await page.waitForSelector("#engine-status.ready", { timeout: 60000 });

  for (const { name, sex, file } of FACES) {
    const url = `data:image/jpeg;base64,${readFileSync(file).toString("base64")}`;
    const m = await page.evaluate(async ([u, s]) => {
      const r = await window.__truemaxMeasure(u, s);
      return r.faceFound ? { gaze: r.gaze, w: r.faceWidthFrac, yaw: r.yaw } : null;
    }, [url, sex]);
    // Same portrait filter the rest of the pipeline uses: a face filling little
    // of the frame is usually a bystander in a group shot, not the subject.
    if (!m?.gaze || m.w < 0.22) continue;
    rows.push({ name, ...m.gaze });
  }
} finally {
  await browser.close();
  server.kill();
}

const q = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const off = rows.map((r) => r.offset);
const ax = rows.map((r) => Math.abs(r.x));
const ay = rows.map((r) => Math.abs(r.y));

console.log(`n = ${rows.length} portraits\n`);
for (const [label, arr] of [["offset", off], ["|x|", ax], ["|y|", ay]]) {
  console.log(
    `${label.padEnd(7)} p50 ${q(arr, 0.5).toFixed(3)}  p75 ${q(arr, 0.75).toFixed(3)}  ` +
      `p90 ${q(arr, 0.9).toFixed(3)}  p95 ${q(arr, 0.95).toFixed(3)}  max ${Math.max(...arr).toFixed(3)}`,
  );
}
console.log("\nworst 10 by offset:");
for (const r of [...rows].sort((a, b) => b.offset - a.offset).slice(0, 10)) {
  console.log(`  ${r.name.padEnd(24)} offset ${r.offset.toFixed(3)}  x ${r.x.toFixed(3)}  y ${r.y.toFixed(3)}`);
}
for (const t of [0.15, 0.18, 0.2, 0.22, 0.25, 0.3]) {
  const pass = off.filter((v) => v <= t).length;
  console.log(`threshold ${t.toFixed(2)} → ${((pass / off.length) * 100).toFixed(1)}% of real portraits pass`);
}
process.exit(0);
