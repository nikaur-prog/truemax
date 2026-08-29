// Build CTA v2 (the Kurzgesagt cut) as one MP4.
//
//   node tools/build-cta2.mjs --out .cta-assets/v2/cta2-master.mp4
//
// Same discipline as build-cta.mjs: the harness draws every frame as a pure
// function of t, this script steps t, ffmpeg assembles. Two differences:
//
//  - The VO is seven per-phrase segments (.cta-assets/v2/vo-seg0..6.mp3),
//    each mixed in at its beat's start, so the narration and the visuals
//    are aligned by construction rather than by eye.
//  - Coach Max does not appear. The two clips this script used to explode and
//    composite were cut from the film, so nothing here decodes video any more.
//
// --fps 12 --seconds 6 exist for quick previews.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { launchChromium } from "./launchChromium.mjs";
import ffmpegPath from "ffmpeg-static";

const ROOT = resolve(import.meta.dirname, "..");
const V2 = join(ROOT, ".cta-assets", "v2");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const out = resolve(arg("out", ".cta-assets/v2/cta2-master.mp4"));
const fps = Number(arg("fps", "30"));
const onlySeconds = arg("seconds") ? Number(arg("seconds")) : null;
const port = Number(arg("port", "4443"));

// Beat starts, duplicated from src/ui/ctaSeries2.ts CTA2_VO_STARTS (the TS
// module is not importable here; ctaSeries2's own tests pin the values).
const VO_STARTS = [0.0, 2.53, 5.4, 11.93, 17.75, 21.88, 23.86];
const TOTAL = 30;

const frameDir = join(V2, "frames");
rmSync(frameDir, { recursive: true, force: true });
mkdirSync(frameDir, { recursive: true });


const server = spawn("npx", ["vite", "--port", String(port), "--strictPort"], {
  cwd: ROOT,
  stdio: ["ignore", "ignore", "inherit"],
});
try {
  await delay(5000);
  const browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 560, height: 990 } });
  page.setDefaultTimeout(120000);
  page.on("pageerror", (e) => console.error("[pageerror]", String(e).slice(0, 300)));

  const q = new URLSearchParams({
    before: "/@fs/" + join(V2, "actor-before2.png"),
    after: "/@fs/" + join(V2, "actor-after.png"),
    person: "/@fs/" + join(V2, "linkbio-person.png"),
  });
    // Not "networkidle". Chromium keeps its own background requests going
    // (variations, safe browsing) and behind a proxy that never answers them
    // they never settle, so networkidle turned a harness error into a hang
    // with no output. The harness announces itself through window.__ready,
    // which is the barrier that actually matters; the wait below is it.
  await page.goto(`http://localhost:${port}/tools/cta2-harness.html?${q}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => window.__ready, undefined, { timeout: 120000 });
  const err = await page.evaluate(() => (window.__ready === "error" ? window.__error : null));
  if (err) throw new Error("harness failed: " + err);

  const total = onlySeconds ?? TOTAL;
  const frames = Math.ceil(total * fps);
  const t0 = Date.now();
  for (let f = 0; f < frames; f++) {
    const t = f / fps;
    const dataUrl = await page.evaluate((tt) => window.__frame(tt), t);
    writeFileSync(join(frameDir, `f${String(f).padStart(5, "0")}.jpg`), Buffer.from(dataUrl.split(",")[1], "base64"));
    if (f % 120 === 0) console.log(`frame ${f}/${frames} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  await browser.close();

  // Assemble: video from frames; audio = each VO segment delayed to its
  // beat start, mixed. adelay wants milliseconds per channel.
  const args = ["-y", "-framerate", String(fps), "-i", join(frameDir, "f%05d.jpg")];
  const segs = VO_STARTS.map((_, i) => join(V2, `vo-seg${i}.mp3`)).filter((f) => existsSync(f));
  for (const s of segs) args.push("-i", s);
  const delays = segs.map((_, i) => {
    const ms = Math.round(VO_STARTS[i] * 1000);
    return `[${i + 1}:a]adelay=${ms}|${ms}[a${i}]`;
  });
  const mix = segs.map((_, i) => `[a${i}]`).join("") + `amix=inputs=${segs.length}:normalize=0[aout]`;
  args.push(
    "-filter_complex", delays.join(";") + ";" + mix,
    "-map", "0:v", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k",
    "-t", String(total), out,
  );
  console.log("ffmpeg assembling…");
  execFileSync(ffmpegPath, args, { stdio: ["ignore", "ignore", "inherit"] });
  console.log("wrote", out);
} finally {
  server.kill();
}
process.exit(0);
