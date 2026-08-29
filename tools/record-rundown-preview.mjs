import { chromium } from "playwright";
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Bundle the module-based harness into one file so this command does not need a
// localhost server. That makes the visual check usable on a normal Mac even
// when the developer environment has no network permission.
const root = process.cwd();
const temp = join(tmpdir(), "truemax-rundown-preview");
mkdirSync(temp, { recursive: true });
const source = readFileSync(join(root, "tools/framecheck.html"), "utf8");
const match = source.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!match) throw new Error("tools/framecheck.html has no module script");
const entry = match[1].replaceAll('"/src/', '"./src/');
const bundled = await build({
  stdin: { contents: entry, resolveDir: root, sourcefile: "framecheck-entry.ts", loader: "ts" },
  bundle: true,
  format: "iife",
  platform: "browser",
  write: false,
});
const htmlPath = join(temp, "framecheck.html");
writeFileSync(htmlPath, source.replace(match[0], `<script>${bundled.outputFiles[0].text}</script>`));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
await page.goto(pathToFileURL(htmlPath).href);
await page.waitForFunction(() => window.ready === true);
await page.evaluate(() => window.scale(1.5));

const downloadPromise = page.waitForEvent("download");
const duration = await page.evaluate(async () => {
  const canvas = document.querySelector("canvas");
  const mixed = await window.makePreviewAudio();
  const live = new AudioContext({ sampleRate: mixed.buffer.sampleRate });
  const destination = live.createMediaStreamDestination();
  const source = live.createBufferSource();
  source.buffer = mixed.buffer;
  source.connect(destination);

  const video = canvas.captureStream(30);
  const stream = new MediaStream([
    ...video.getVideoTracks(),
    ...destination.stream.getAudioTracks(),
  ]);
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
    ? "video/webm;codecs=vp9,opus"
    : "video/webm";
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 12_000_000,
    audioBitsPerSecond: 128_000,
  });
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  const stopped = new Promise((resolve) => {
    recorder.onstop = resolve;
  });

  window.frameAt(0);
  recorder.start(250);
  await live.resume();
  source.start();
  const started = performance.now();
  await new Promise((resolve) => {
    const draw = (now) => {
      const elapsed = (now - started) / 1000;
      window.frameAt(Math.min(elapsed, window.previewDuration - 0.001));
      if (elapsed < mixed.duration) requestAnimationFrame(draw);
      else resolve();
    };
    requestAnimationFrame(draw);
  });
  recorder.stop();
  await stopped;
  await live.close();

  const blob = new Blob(chunks, { type: mimeType });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = "truemax-rundown-preview.webm";
  anchor.click();
  return mixed.duration;
});
const download = await downloadPromise;
const webmPath = join(temp, "truemax-rundown-preview.webm");
await download.saveAs(webmPath);
await browser.close();

const exportsDir = join(root, "exports");
mkdirSync(exportsDir, { recursive: true });
const mp4Path = join(exportsDir, "truemax-rundown-preview.mp4");
const encode = spawnSync("ffmpeg", [
  "-y", "-i", webmPath,
  "-c:v", "libx264", "-preset", "medium", "-crf", "18",
  "-c:a", "aac", "-b:a", "128k",
  "-pix_fmt", "yuv420p", "-movflags", "+faststart",
  mp4Path,
], { stdio: "inherit" });
if (encode.status !== 0) {
  const fallback = join(exportsDir, "truemax-rundown-preview.webm");
  copyFileSync(webmPath, fallback);
  process.stdout.write(JSON.stringify({ duration, output: fallback, warning: "ffmpeg was unavailable" }));
} else {
  process.stdout.write(JSON.stringify({ duration, output: mp4Path }));
}
