// Build the Creator League gate montage as one MP4.
//
//   node tools/build-montage.mjs --out public/league/montage.mp4
//
// Same discipline as build-cta.mjs: the harness draws every frame as a pure
// function of t, this script steps t at a fixed fps, ffmpeg assembles. The
// montage is silent — the gate plays it muted on loop.
//
// --fps 12 --seconds 4 exist for quick previews while iterating on the look.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { launchChromium } from "./launchChromium.mjs";
import ffmpegPath from "ffmpeg-static";

const ROOT = resolve(import.meta.dirname, "..");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const out = resolve(arg("out", ".cta-assets/league-montage.mp4"));
const fps = Number(arg("fps", "30"));
const onlySeconds = arg("seconds") ? Number(arg("seconds")) : null;
const port = Number(arg("port", "4442"));

const frameDir = join(ROOT, ".cta-assets", "montage-frames");
rmSync(frameDir, { recursive: true, force: true });
mkdirSync(frameDir, { recursive: true });
mkdirSync(dirname(out), { recursive: true });

const server = spawn("npx", ["vite", "--port", String(port), "--strictPort"], {
  cwd: ROOT,
  stdio: ["ignore", "ignore", "inherit"],
});
try {
  await delay(5000);
  const browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 990, height: 580 } });
  page.on("pageerror", (e) => console.error("[pageerror]", String(e).slice(0, 300)));

    // Not "networkidle". Chromium keeps its own background requests going
    // (variations, safe browsing) and behind a proxy that never answers them
    // they never settle, so networkidle turned a harness error into a hang
    // with no output. The harness announces itself through window.__ready,
    // which is the barrier that actually matters; the wait below is it.
  await page.goto(`http://localhost:${port}/tools/montage-harness.html`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => window.__ready, undefined, { timeout: 120000 });
  const err = await page.evaluate(() => (window.__ready === "error" ? window.__error : null));
  if (err) throw new Error("harness failed: " + err);

  const total = onlySeconds ?? (await page.evaluate(() => window.__seconds));
  console.log(`rendering ${total}s at ${fps}fps`);
  const frames = Math.ceil(total * fps);
  const t0 = Date.now();
  for (let f = 0; f < frames; f++) {
    const t = f / fps;
    const dataUrl = await page.evaluate((tt) => window.__frame(tt), t);
    writeFileSync(join(frameDir, `f${String(f).padStart(5, "0")}.jpg`), Buffer.from(dataUrl.split(",")[1], "base64"));
    if (f % 120 === 0) console.log(`frame ${f}/${frames} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  await browser.close();

  // CRF 23: this file ships in the repo and streams on a marketing page — it
  // should look clean, not weigh like a master.
  execFileSync(ffmpegPath, [
    "-y", "-framerate", String(fps), "-i", join(frameDir, "f%05d.jpg"),
    "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-t", String(total), out,
  ], { stdio: ["ignore", "ignore", "inherit"] });
  console.log("wrote", out);
} finally {
  server.kill();
}
process.exit(0);
