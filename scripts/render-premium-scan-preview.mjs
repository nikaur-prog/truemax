#!/usr/bin/env node

import { spawn, execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const output = resolve(process.argv[2] || join(root, "artifacts", "premium-scan-preview.mp4"));
const port = Number(process.env.TRUEMAX_PREVIEW_PORT || 4178);
const fps = 30;
const seconds = 4;
const frames = Math.round(fps * seconds);
const scratch = await mkdtemp(join(tmpdir(), "truemax-premium-scan-"));

await mkdir(dirname(output), { recursive: true });

const vite = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(port)], {
  cwd: root,
  stdio: "ignore",
});

let browser;
try {
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(`${origin}/methodology.html`);
      if (response.ok) break;
    } catch {
      // Vite has not bound the port yet.
    }
    if (attempt >= 100) throw new Error("The preview server did not start.");
    await new Promise((done) => setTimeout(done, 100));
  }

  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 720, height: 1280 }, deviceScaleFactor: 1 });
  await page.goto(`${origin}/methodology.html`, { waitUntil: "networkidle" });

  await page.evaluate(async () => {
    const landmarker = await import("/src/engine/landmarker.ts");
    const video = await import("/src/ui/quickVideoExport.ts");
    await landmarker.initLandmarker();

    const image = new Image();
    image.src = "/demo/dev.jpg";
    await image.decode();

    const photo = document.createElement("canvas");
    photo.width = image.naturalWidth * 2;
    photo.height = image.naturalHeight * 2;
    photo.getContext("2d").drawImage(image, 0, 0, photo.width, photo.height);

    const landmarks = landmarker.detect(photo).faceLandmarks[0];
    if (!landmarks) throw new Error("The preview portrait did not produce face landmarks.");

    const frame = document.createElement("canvas");
    document.body.replaceChildren(frame);
    Object.assign(document.body.style, { margin: "0", background: "#050606" });

    const regions = ["Eyes", "Jaw", "Chin", "Midface", "Lips", "Nose", "Symmetry", "Proportions"]
      .map((name, i) => ({ name, score: [7.2, 7.8, 7.1, 6.9, 7.4, 6.8, 8.1, 7.3][i] }));
    await document.fonts.ready;

    window.renderPremiumScanFrame = (time) => {
      video.renderQuickVideoFrame(frame, photo, landmarks, "male", {
        overall: 7.4,
        percentile: 82,
        regions,
      }, time, "breakdown", 1.5);
      return frame.toDataURL("image/jpeg", 0.95).slice("data:image/jpeg;base64,".length);
    };
  });

  for (let index = 0; index < frames; index++) {
    const encoded = await page.evaluate((time) => window.renderPremiumScanFrame(time), index / fps);
    await writeFile(join(scratch, `frame-${String(index).padStart(4, "0")}.jpg`), Buffer.from(encoded, "base64"));
    if (index % 15 === 0) process.stdout.write(`Rendered ${index}/${frames}\r`);
  }
  process.stdout.write(`Rendered ${frames}/${frames}\n`);

  await exec(process.env.FFMPEG_PATH || "ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-framerate", String(fps),
    "-i", join(scratch, "frame-%04d.jpg"),
    "-c:v", "libx264",
    "-preset", "slow",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-an",
    output,
  ]);

  process.stdout.write(`${output}\n`);
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
  await rm(scratch, { recursive: true, force: true });
}
