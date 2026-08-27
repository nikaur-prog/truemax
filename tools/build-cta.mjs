// Build the universal CTA outro as one MP4.
//
//   node tools/build-cta.mjs --girl .cta-assets/girl-a.mp4 \
//     --vo .cta-assets/vo-holden.mp3 --out .cta-assets/cta-master.mp4
//
// Deterministic on purpose: the harness draws every frame as a pure function
// of t (src/ui/ctaSeries.ts), this script steps t at a fixed fps, and ffmpeg
// assembles the sequence with the VO track. Same inputs, same master — the
// brief was one CTA series, identical on every video, never regenerated.
//
// --fps 12 --seconds 4 exist for quick previews while iterating on the look.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { launchChromium } from "./launchChromium.mjs";
import ffmpegPath from "ffmpeg-static";

const ROOT = resolve(import.meta.dirname, "..");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const girl = arg("girl");
const vo = arg("vo");
const out = resolve(arg("out", ".cta-assets/cta-master.mp4"));
const fps = Number(arg("fps", "30"));
const onlySeconds = arg("seconds") ? Number(arg("seconds")) : null;
const port = Number(arg("port", "4441"));

// The video must outlast the voice — a narrator cut off mid-sentence is the
// least premium thing an outro can do. ffmpeg-static ships no ffprobe, but
// ffmpeg -i prints the duration to stderr on its way to complaining that no
// output file was given.
function audioSeconds(file) {
  if (!file) return 0;
  try {
    execFileSync(ffmpegPath, ["-i", file], { stdio: "pipe" });
  } catch (e) {
    const m = String(e.stderr).match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  return 0;
}

const voSeconds = audioSeconds(vo);
const { CTA_SECONDS } = { CTA_SECONDS: 26 }; // duplicated: the TS module is not importable here; pinned by ctaSeries.test.ts
const total = onlySeconds ?? Math.max(CTA_SECONDS, voSeconds + 0.6);
console.log(`vo: ${voSeconds.toFixed(1)}s → rendering ${total.toFixed(1)}s at ${fps}fps`);

const frameDir = join(ROOT, ".cta-assets", "frames");
rmSync(frameDir, { recursive: true, force: true });
mkdirSync(frameDir, { recursive: true });

// The AI actor clip is H.264, which Playwright's Chromium cannot decode — no
// proprietary codecs in the test build. Rather than transcoding and still
// trusting <video> seeking, the clip is exploded to JPEG frames here and the
// harness treats it as an image sequence: no codecs, no seek events, and the
// mapping from t to frame is arithmetic, which is also what keeps it
// deterministic.
const girlDir = join(ROOT, ".cta-assets", "girlframes");
let girlMeta = null;
if (girl) {
  rmSync(girlDir, { recursive: true, force: true });
  mkdirSync(girlDir, { recursive: true });
  const gfps = Math.max(fps, 12);
  execFileSync(ffmpegPath, [
    "-y", "-i", resolve(girl), "-t", "3.4", "-vf", `fps=${gfps},scale=1080:-2`,
    "-q:v", "3", join(girlDir, "g%04d.jpg"),
  ], { stdio: "pipe" });
  const count = (await import("node:fs")).readdirSync(girlDir).length;
  girlMeta = { fps: gfps, count };
  console.log(`girl clip → ${count} frames at ${gfps}fps`);
}

const server = spawn("npx", ["vite", "--port", String(port), "--strictPort"], {
  cwd: ROOT,
  stdio: ["ignore", "ignore", "inherit"],
});
try {
  await delay(5000);
  const browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 560, height: 990 } });
  page.on("pageerror", (e) => console.error("[pageerror]", String(e).slice(0, 300)));

  const girlParam = girlMeta
    ? `?girldir=${encodeURIComponent("/@fs/" + girlDir)}&girlfps=${girlMeta.fps}&girlcount=${girlMeta.count}`
    : "";
  await page.goto(`http://localhost:${port}/tools/cta-harness.html${girlParam}`, {
    waitUntil: "networkidle",
  });
  await page.waitForFunction(() => window.__ready, { timeout: 120000 });
  const err = await page.evaluate(() => (window.__ready === "error" ? window.__error : null));
  if (err) throw new Error("harness failed: " + err);

  const frames = Math.ceil(total * fps);
  const t0 = Date.now();
  for (let f = 0; f < frames; f++) {
    const t = f / fps;
    const dataUrl = await page.evaluate((tt) => window.__frame(tt), t);
    writeFileSync(join(frameDir, `f${String(f).padStart(5, "0")}.jpg`), Buffer.from(dataUrl.split(",")[1], "base64"));
    if (f % 120 === 0) console.log(`frame ${f}/${frames} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  await browser.close();

  const args = ["-y", "-framerate", String(fps), "-i", join(frameDir, "f%05d.jpg")];
  if (vo && existsSync(vo)) args.push("-i", resolve(vo));
  args.push("-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p");
  if (vo && existsSync(vo)) args.push("-c:a", "aac", "-b:a", "192k");
  // Video length rules; a shorter VO just ends and the endcard holds in quiet.
  args.push("-t", String(total), out);
  console.log("ffmpeg assembling…");
  execFileSync(ffmpegPath, args, { stdio: ["ignore", "ignore", "inherit"] });
  console.log("wrote", out);
} finally {
  server.kill();
}
process.exit(0);
