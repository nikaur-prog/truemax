// ---------------------------------------------------------------------------
// Harvest 2-second face clips from a folder of videos.
//
//   node scripts/harvest-clips.mjs <input-dir> <output-dir> [--per-video 4]
//
// The problem this solves: the /quick reel producer wants short clips of a
// face, and finding them by scrubbing interview footage by hand is the slowest
// part of making a reel. This walks every video in a folder, finds the scene
// cuts, and keeps only the segments where the app's OWN face engine — the same
// MediaPipe pipeline that scores faces in production — sees exactly one large,
// sharp, roughly frontal face. What comes out is a folder of ready-to-drop
// 2-second clips and a manifest describing where each one came from.
//
// Sourcing the input videos is deliberately not this script's job. Point it at
// whatever footage you have the right to use; it never touches the network.
//
// Requires the repo's devDependencies (ffmpeg-static, playwright) and a built
// dev server it can start itself. Runs headless; a machine with no display is
// fine.
// ---------------------------------------------------------------------------

import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { join, basename, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";
import { chromium } from "playwright";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".mkv", ".m4v"]);
const CLIP_SECONDS = 2;
// A scene has to run at least this long to yield a stable 2-second cut; a
// faster cut is usually a montage frame that looks terrible frozen mid-motion.
const MIN_SCENE = 1.2;

const [, , inDirArg, outDirArg, ...rest] = process.argv;
if (!inDirArg || !outDirArg) {
  console.error("usage: node scripts/harvest-clips.mjs <input-dir> <output-dir> [--per-video 4]");
  process.exit(1);
}
const PER_VIDEO = Math.max(1, Number(rest[rest.indexOf("--per-video") + 1]) || 4);
const inDir = resolve(inDirArg);
const outDir = resolve(outDirArg);
mkdirSync(outDir, { recursive: true });

const ff = (args) =>
  execFileSync(ffmpegPath, args, { encoding: "utf8", stdio: "pipe", maxBuffer: 64e6 });

// Run ffmpeg and hand back its stderr whether it succeeds or fails.
import { spawnSync } from "node:child_process";
const spawnSyncFfmpeg = (args) => {
  const r = spawnSync(ffmpegPath, args, { encoding: "utf8", maxBuffer: 64e6 });
  return String(r.stderr || "");
};

// ---------------------------------------------------------------------------
// 1. Scene boundaries, from ffmpeg's own scene-change detector. The showinfo
//    lines land on stderr; each pts_time is the first frame of a new scene.
// ---------------------------------------------------------------------------
function sceneStarts(file) {
  // Everything useful — the showinfo lines AND the duration — arrives on
  // stderr, and ffmpeg exits 0 on success, so stderr has to be captured from
  // the success path too, not only from the catch.
  let err = "";
  try {
    const r = spawnSyncFfmpeg([
      "-i", file,
      "-vf", "select='gt(scene,0.3)',showinfo",
      "-f", "null", "-",
    ]);
    err = r;
  } catch (e) {
    err = String(e.stderr || "");
  }
  const times = [0];
  for (const m of err.matchAll(/pts_time:([0-9.]+)/g)) times.push(Number(m[1]));
  const durMatch = err.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const duration = durMatch ? Number(durMatch[1]) * 3600 + Number(durMatch[2]) * 60 + Number(durMatch[3]) : 0;
  times.push(duration);
  // Candidate segments: one per scene, starting a beat after the cut so the
  // clip does not open on the transition frame itself.
  const segments = [];
  for (let i = 0; i < times.length - 1; i++) {
    const len = times[i + 1] - times[i];
    if (len < Math.max(MIN_SCENE, CLIP_SECONDS + 0.3)) continue;
    segments.push({ start: times[i] + 0.15, sceneLength: Math.round(len * 10) / 10 });
  }
  return segments;
}

// ---------------------------------------------------------------------------
// 2. One probe frame per candidate, pulled at the middle of the would-be clip.
// ---------------------------------------------------------------------------
function probeFrame(file, seconds, dest) {
  ff(["-ss", String(seconds), "-i", file, "-frames:v", "1", "-q:v", "3", "-y", dest]);
}

// ---------------------------------------------------------------------------
// 3. Face-score every probe frame in one browser session against the app's
//    real engine. Kept deliberately strict: a reel clip has one job, showing
//    the face, so anything ambiguous is dropped rather than ranked kindly.
// ---------------------------------------------------------------------------
async function scoreFrames(frames) {
  const server = spawn("npx", ["vite", "--port", "4396", "--strictPort"], { cwd: ROOT, stdio: "ignore" });
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium",
  });
  try {
    const page = await browser.newPage();
    // The dev server takes a few seconds to come up; retry rather than racing it.
    for (let attempt = 0; ; attempt++) {
      try {
        await page.goto("http://localhost:4396/", { timeout: 15000, waitUntil: "domcontentloaded" });
        break;
      } catch (e) {
        if (attempt >= 10) throw e;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    await page.waitForSelector("#engine-status.ready", { timeout: 90000 });
    const results = [];
    for (const frame of frames) {
      const data = "data:image/jpeg;base64," + Buffer.from(execFileSync("cat", [frame.png])).toString("base64");
      const score = await page.evaluate(async (u) => {
        const { detectStable } = await import("/src/engine/consensus.ts");
        const { assessQuality } = await import("/src/engine/quality.ts");
        const { setRunningMode } = await import("/src/engine/landmarker.ts");
        await setRunningMode("IMAGE");
        const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = u; });
        if (!img) return null;
        const c = document.createElement("canvas");
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext("2d").drawImage(img, 0, 0);
        const r = await detectStable(c);
        const lm = r?.faceLandmarks?.[0];
        if (!lm) return { face: false };
        const xs = lm.map((p) => p.x), ys = lm.map((p) => p.y);
        const w = Math.max(...xs) - Math.min(...xs);
        const h = Math.max(...ys) - Math.min(...ys);
        const q = assessQuality(r);
        return {
          face: true,
          faces: r.faceLandmarks.length,
          // Fraction of the frame the face occupies; small faces read as
          // background people, not subjects.
          size: Math.round(w * h * 1000) / 1000,
          yaw: Math.round(q.yawDeg),
          pitch: Math.round(q.pitchDeg),
        };
      }, data);
      results.push({ ...frame, score });
    }
    return results;
  } finally {
    await browser.close();
    server.kill();
  }
}

const keep = (s) =>
  s && s.face && s.faces === 1 && s.size >= 0.04 && Math.abs(s.yaw) <= 35 && Math.abs(s.pitch) <= 30;

// ---------------------------------------------------------------------------
// 4. Cut the winners. Re-encoded rather than stream-copied, because -c copy
//    can only cut on keyframes and a clip that starts a second early defeats
//    the whole point of scene-aware cutting.
// ---------------------------------------------------------------------------
function cutClip(file, start, dest) {
  ff([
    "-ss", String(start), "-i", file, "-t", String(CLIP_SECONDS),
    "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
    "-pix_fmt", "yuv420p", "-y", dest,
  ]);
}

const videos = readdirSync(inDir).filter((f) => VIDEO_EXT.has(extname(f).toLowerCase()));
if (!videos.length) {
  console.error(`no videos found in ${inDir}`);
  process.exit(1);
}
console.log(`${videos.length} video(s) in ${inDir}`);

const allCandidates = [];
for (const v of videos) {
  const file = join(inDir, v);
  const segments = sceneStarts(file);
  console.log(`  ${v}: ${segments.length} candidate scene(s)`);
  for (const [i, seg] of segments.entries()) {
    const png = join(outDir, `.probe-${basename(v, extname(v))}-${i}.jpg`);
    const mid = seg.start + CLIP_SECONDS / 2;
    try {
      probeFrame(file, mid, png);
      allCandidates.push({ video: v, file, start: seg.start, sceneLength: seg.sceneLength, png });
    } catch {
      /* an unreadable timestamp near EOF: skip the candidate, keep the rest */
    }
  }
}

console.log(`scoring ${allCandidates.length} frame(s) against the face engine...`);
const scored = await scoreFrames(allCandidates);

const manifest = [];
const perVideo = new Map();
for (const c of scored) {
  if (!keep(c.score)) continue;
  const n = perVideo.get(c.video) ?? 0;
  if (n >= PER_VIDEO) continue;
  perVideo.set(c.video, n + 1);
  const name = `${basename(c.video, extname(c.video))}-${String(Math.round(c.start * 10)).padStart(5, "0")}.mp4`;
  cutClip(c.file, c.start, join(outDir, name));
  manifest.push({
    clip: name,
    source: c.video,
    start: Math.round(c.start * 10) / 10,
    face: c.score,
  });
  console.log(`  ✓ ${name}  (t=${c.start.toFixed(1)}s, face ${Math.round(c.score.size * 100)}% of frame, yaw ${c.score.yaw})`);
}

// Clean the probe frames; they were working files.
for (const c of allCandidates) {
  try { execFileSync("rm", ["-f", c.png]); } catch { /* already gone */ }
}

writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`\n${manifest.length} clip(s) → ${outDir}/manifest.json`);
if (!manifest.length) {
  console.log("Nothing kept. Loosen with --per-video, or check the footage actually holds a large frontal face.");
}
