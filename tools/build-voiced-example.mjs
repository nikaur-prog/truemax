// Build /demo/voiced-example.mp4 — the pop-out that shows what $2.99 buys.
//
// The example is the REAL product on a face that cannot mind being shown:
// Dev, one of the AI-generated demo cast, scanned by the real engine and
// composited frame by frame by the same drawRundownFrame a customer's
// purchase runs. Two substitutions, both forced by the machine this runs on:
//
//   - the voice: /api/tts is staff-gated and this box holds no key, so the
//     voiceover is generated out-of-band for the exact narration phase 1
//     printed, and the timeline fits itself to the real audio span — the
//     same fallback path a production render takes when a voice returns no
//     character alignment.
//   - the encoder: headless Chromium ships no H.264, so frames stream out of
//     the page into ffmpeg instead of into mediabunny. Same frames, same
//     mixed audio track, same container.
//
//   node tools/build-voiced-example.mjs narration <photo.png> [name]
//   node tools/build-voiced-example.mjs render <photo.png> <voice.mp3> [name]
//     → writes .voiced-example/voiced-example.mp4
//
// The disclaimer note is read aloud and typed on screen inside the video, so
// the AI-demonstration status ships inside the file rather than around it.
import { launchChromium } from "./launchChromium.mjs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const OUT = `${APP_DIR}/.voiced-example`;
const FPS = 30;
const [mode, photoPath, ...rest] = process.argv.slice(2);
if (mode !== "narration" && mode !== "render") {
  console.error("mode must be narration or render");
  process.exit(1);
}
const voicePath = mode === "render" ? rest[0] : null;
const name = (mode === "render" ? rest[1] : rest[0]) ?? "Dev";
// Which cut to build. The $2.99 product is the short cut, so the example the
// pop-out plays should be the short cut too.
const CUT = process.env.TM_CUT === "full" ? "full" : "short";
const NOTE =
  "One more thing. Dev is an AI generated demonstration face, so nobody's real face had to stand in a product demo. The scan, the numbers and this voice are exactly what the product produces.";

mkdirSync(OUT, { recursive: true });
const server = spawn("npx", ["vite", "--port", "4257", "--strictPort"], { cwd: APP_DIR, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 5000));
const browser = await launchChromium();

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("console", (m) => {
    if (m.type() === "error") console.log("page:", m.text().slice(0, 220));
  });
  await page.goto("http://localhost:4257/");
  await page.waitForSelector('html[data-engine="ready"]', { timeout: 90000 });

  const photoB64 = `data:image/png;base64,${readFileSync(photoPath).toString("base64")}`;
  const voiceB64 = voicePath ? readFileSync(voicePath).toString("base64") : null;

  const setup = await page.evaluate(
    async ([dataUrl, mode2, audioB64, personName, note, cut]) => {
      const { detect } = await import("/src/engine/landmarker.ts");
      const { analyze } = await import("/src/engine/scoring.ts");
      const { buildReelScript, narrationFrom } = await import("/src/engine/reelScript.ts");

      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = dataUrl;
      });
      const photo = document.createElement("canvas");
      photo.width = img.naturalWidth;
      photo.height = img.naturalHeight;
      photo.getContext("2d").drawImage(img, 0, 0);

      const lm = detect(photo)?.faceLandmarks?.[0];
      if (!lm?.length) return { error: "no face found" };
      const report = analyze(lm, photo.width, photo.height, "male", photo);
      const beats = buildReelScript(report, { name: personName, note, cut });
      if (mode2 === "narration") return { narration: narrationFrom(beats) };

      const { buildTimeline, fitTimeline } = await import("/src/engine/rundownTimeline.ts");
      const { decodeVoice, speechSpan, mixRundownAudio } = await import("/src/ui/rundownAudio.ts");
      const { drawRundownFrame } = await import("/src/ui/rundownFrame.ts");

      const bin = atob(audioB64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const voice = await decodeVoice(bytes.buffer);
      if (!voice) return { error: "voice would not decode" };

      const estimated = buildTimeline(beats);
      const span = speechSpan(voice);
      const timeline = fitTimeline(estimated, span.end - span.start, span.start);
      const audio = await mixRundownAudio(voice, timeline);

      // The mixed track as 16-bit PCM WAV, so ffmpeg gets exactly the buffer
      // the in-browser encoder would have been handed.
      const ab = audio.buffer;
      const ch = ab.getChannelData(0);
      const wav = new DataView(new ArrayBuffer(44 + ch.length * 2));
      const w8 = (o, s) => { for (let i = 0; i < s.length; i++) wav.setUint8(o + i, s.charCodeAt(i)); };
      w8(0, "RIFF"); wav.setUint32(4, 36 + ch.length * 2, true); w8(8, "WAVEfmt ");
      wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true);
      wav.setUint32(24, ab.sampleRate, true); wav.setUint32(28, ab.sampleRate * 2, true);
      wav.setUint16(32, 2, true); wav.setUint16(34, 16, true); w8(36, "data");
      wav.setUint32(40, ch.length * 2, true);
      for (let i = 0; i < ch.length; i++) {
        const s = Math.max(-1, Math.min(1, ch[i]));
        wav.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      }
      let wb = "";
      const bytesOut = new Uint8Array(wav.buffer);
      for (let i = 0; i < bytesOut.length; i += 0x8000) {
        wb += String.fromCharCode(...bytesOut.subarray(i, i + 0x8000));
      }

      // Frame server for the node side. Same geometry as rundownExport.ts:
      // 1080x1920 raster over a 720x1280 logical layout.
      const W = 1080, H = 1920, LOGICAL_W = 720, LOGICAL_H = 1280, SCALE = W / LOGICAL_W;
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      const overlayCanvas = document.createElement("canvas");
      const metrics = new Map();
      for (const metric of report.metrics) metrics.set(metric.def.id, metric);
      const input = {
        timeline,
        metrics,
        name: personName.trim().split(/\s+/)[0],
        disclaimerLine: note.trim(),
        disclaimerClip: undefined,
        cut,
      };
      window.__vframe = (frame, fps) => {
        ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
        drawRundownFrame(ctx, photo, lm, input, frame / fps, {
          width: LOGICAL_W,
          height: LOGICAL_H,
          overlayCanvas,
        });
        return canvas.toDataURL("image/jpeg", 0.9);
      };
      return { wav: btoa(wb), duration: audio.duration };
    },
    [photoB64, mode, voiceB64, name, NOTE, CUT],
  );

  if (setup.error) {
    console.error("failed:", setup.error);
    process.exit(1);
  }
  if (mode === "narration") {
    writeFileSync(`${OUT}/narration.txt`, setup.narration);
    console.log(setup.narration);
  } else {
    writeFileSync(`${OUT}/mix.wav`, Buffer.from(setup.wav, "base64"));
    const frames = Math.round(FPS * setup.duration);
    console.log(`duration ${setup.duration.toFixed(1)}s → ${frames} frames`);

    const require = createRequire(import.meta.url);
    const ffmpeg = require("ffmpeg-static");
    const ff = spawn(
      ffmpeg,
      [
        "-y",
        "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
        "-i", `${OUT}/mix.wav`,
        "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-shortest", "-movflags", "+faststart",
        `${OUT}/voiced-example.mp4`,
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    let ffErr = "";
    ff.stderr.on("data", (d) => { ffErr += d.toString(); ffErr = ffErr.slice(-4000); });

    for (let f = 0; f < frames; f++) {
      const dataUrl = await page.evaluate(([fr, fps]) => window.__vframe(fr, fps), [f, FPS]);
      const buf = Buffer.from(dataUrl.split(",")[1], "base64");
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
      if (f % 300 === 0) console.log(`frame ${f}/${frames}`);
    }
    ff.stdin.end();
    const code = await new Promise((r) => ff.on("close", r));
    if (code !== 0) {
      console.error("ffmpeg failed:", ffErr.slice(-1500));
      process.exit(1);
    }
    console.log(`wrote ${OUT}/voiced-example.mp4`);
  }
} finally {
  await browser.close();
  server.kill();
}
process.exit(0);
