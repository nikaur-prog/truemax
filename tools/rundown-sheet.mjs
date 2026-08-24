// Render the rundown as still frames, so it can be LOOKED AT.
//
// The rundown is a ninety-second video assembled from a dozen beat types, and
// until now the only way to see one was to export it from a browser with a
// narration key. That is a slow loop for judging whether something looks good,
// and a slow loop is why visual problems survive.
//
// This drives the same drawRundownFrame the exporter uses, with the estimated
// timeline (no narration), and writes one PNG per sampled moment plus a contact
// sheet of all of them. No audio, no muxing, no billable call.
//
//   node tools/rundown-sheet.mjs [photo.jpg]
//
// Output lands in .rundown-sheet/ (gitignored).
import { launchChromium } from "./launchChromium.mjs";
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";

const APP_DIR = "/home/user/truemax";
const OUT = `${APP_DIR}/.rundown-sheet`;
const PHOTOS = `${APP_DIR}/.calib/pop-photos`;
const PHOTO = process.argv[2] ?? `${PHOTOS}/${readdirSync(PHOTOS).filter((f) => f.endsWith(".jpg"))[0]}`;
const SAMPLES = Number(process.env.TM_SAMPLES ?? 12);

mkdirSync(OUT, { recursive: true });
console.log(`Rendering from ${PHOTO}`);

const server = spawn("npx", ["vite", "--port", "4253", "--strictPort"], { cwd: APP_DIR, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 5000));
const browser = await launchChromium();

let result;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("console", (m) => { if (m.type() === "error") console.log("page error:", m.text().slice(0, 200)); });
  await page.goto("http://localhost:4253/");
  await page.waitForSelector("html[data-engine=\"ready\"]", { timeout: 90000 });

  result = await page.evaluate(async ([dataUrl, samples]) => {
    const { detect } = await import("/src/engine/landmarker.ts");
    const { analyze } = await import("/src/engine/scoring.ts");
    const { buildReelScript } = await import("/src/engine/reelScript.ts");
    const { buildTimeline } = await import("/src/engine/rundownTimeline.ts");
    const { drawRundownFrame } = await import("/src/ui/rundownFrame.ts");

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

    const beats = buildReelScript(report, { name: "Reference", shortName: "Ref" });
    const timeline = buildTimeline(beats);

    // MUST match rundownExport's canvas exactly. Every font size, safe margin
    // and stroke width in rundownFrame is an absolute pixel value tuned for
    // 1080x1920; rendering this sheet at half that made the type twice as large
    // relative to the frame and produced overlaps that do not exist in the
    // real export. A preview at the wrong resolution is worse than no preview,
    // because it invents bugs and hides real ones.
    const W = 1080;
    const H = 1920;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    const overlayCanvas = document.createElement("canvas");

    const metrics = new Map(report.metrics.map((m) => [m.def.id, m]));
    const input = { timeline, metrics, name: "Reference" };

    const out = [];
    const dur = timeline.duration;
    for (let i = 0; i < samples; i++) {
      // Sample at 34% of each beat. A uniform grid lands on cut boundaries and shows
      // half-drawn transitions; sampling late is worse still, because a metric
      // beat's overlay RETRACTS over its last third, so a frame at 72% shows a
      // face with nothing drawn on it and reads as a renderer bug. 34% is after
      // the line lands and before it starts leaving.
      const tb = timeline.beats[Math.floor((i / samples) * timeline.beats.length)];
      const t = tb ? tb.start + tb.duration * 0.34 : (i / samples) * dur;
      ctx.clearRect(0, 0, W, H);
      try {
        drawRundownFrame(ctx, photo, lm, input, t, { width: W, height: H, overlayCanvas });
      } catch (e) {
        out.push({ t, kind: tb?.beat.kind ?? "?", error: String(e).slice(0, 160) });
        continue;
      }
      out.push({
        t: Math.round(t * 100) / 100,
        kind: tb?.beat.kind ?? "?",
        line: (tb?.beat.line ?? "").slice(0, 70),
        png: canvas.toDataURL("image/png"),
      });
    }
    return {
      duration: Math.round(dur * 10) / 10,
      beats: timeline.beats.map((b) => ({ kind: b.beat.kind, at: Math.round(b.start * 10) / 10, dur: Math.round(b.duration * 10) / 10 })),
      frames: out,
    };
  }, [`data:image/jpeg;base64,${readFileSync(PHOTO).toString("base64")}`, SAMPLES]);
} finally {
  await browser.close();
  server.kill("SIGTERM");
}

if (result?.error) { console.error(result.error); process.exit(1); }

console.log(`\nTimeline: ${result.duration}s, ${result.beats.length} beats`);
for (const b of result.beats) console.log(`  ${String(b.at).padStart(6)}s  ${String(b.dur).padStart(5)}s  ${b.kind}`);

console.log(`\n${result.frames.length} frames:`);
const html = [`<style>body{background:#111;color:#eee;font:12px system-ui;display:flex;flex-wrap:wrap;gap:14px;padding:16px}
figure{margin:0;width:270px}img{width:100%;display:block;border-radius:8px}figcaption{padding:6px 2px;opacity:.75;line-height:1.4}</style>`];
for (const [i, f] of result.frames.entries()) {
  if (f.error) { console.log(`  ${f.t}s ${f.kind}: ERROR ${f.error}`); continue; }
  const file = `${String(i).padStart(2, "0")}-${f.kind}.png`;
  writeFileSync(`${OUT}/${file}`, Buffer.from(f.png.split(",")[1], "base64"));
  console.log(`  ${String(f.t).padStart(6)}s  ${f.kind.padEnd(14)} ${f.line}`);
  html.push(`<figure><img src="${file}"><figcaption><b>${f.t}s · ${f.kind}</b><br>${f.line.replace(/</g, "&lt;")}</figcaption></figure>`);
}
writeFileSync(`${OUT}/sheet.html`, html.join("\n"));
console.log(`\nWrote ${OUT}/sheet.html`);
