import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { Sex } from "../engine/types.js";
import { rankShort } from "./templates.js";
import { verdictForPercentile } from "../engine/analysisMode.js";

// Which cut to render.
//
//   breakdown — the eight-region analysis. Explains the product.
//   verdict   — one word, held on screen. Explains nothing, travels further.
//
// Both are the same footage of the same face, scanned by the same engine and
// composited by the same code. The verdict cut is shorter because a word does
// not need five seconds, and because the thing people re-post is the reaction,
// not the table.
export type QuickVariant = "breakdown" | "verdict";

// A real 720×1280, 30fps export. The previous renderer called a 540×960,
// 10fps file “720p”; no easing curve can make ten distinct images per second
// look fluid during a resize. Thirty frames gives social apps normal motion
// cadence while 720p remains practical to encode on-device.
const W = 720;
const H = 1280;
const FPS = 30;
const DURATION: Record<QuickVariant, number> = { breakdown: 5.5, verdict: 4 };

// The producer re-renders the analysis segment frame by frame through
// renderQuickVideoFrame rather than decoding an MP4 back in, so it needs to
// know where the animation ends without duplicating the number.
export function quickVideoDuration(variant: QuickVariant): number {
  return DURATION[variant];
}

export interface QuickExportScores {
  overall: number;
  percentile: number;
  regions: Array<{ name: string; score: number }>;
}

export async function downloadQuickVideo(
  photo: HTMLCanvasElement,
  landmarks: NormalizedLandmark[],
  sex: Sex,
  scores: QuickExportScores,
  onProgress?: (progress: number) => void,
  variant: QuickVariant = "breakdown",
): Promise<void> {
  const frameCount = Math.round(FPS * DURATION[variant]);
  const { Output, BufferTarget, Mp4OutputFormat, CanvasSource, QUALITY_HIGH, getFirstEncodableVideoCodec } =
    await import("mediabunny");
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const format = new Mp4OutputFormat({ fastStart: "in-memory" });
  const codec = await getFirstEncodableVideoCodec(
    format.getSupportedVideoCodecs().filter((candidate) => candidate === "avc"),
    { width: W, height: H, quality: QUALITY_HIGH },
  );
  if (!codec) throw new Error("This browser cannot encode an H.264 MP4.");

  const target = new BufferTarget();
  const output = new Output({ format, target });
  const source = new CanvasSource(canvas, {
    codec,
    bitrate: 6_000_000,
    keyFrameInterval: 2,
  });
  output.addVideoTrack(source, { frameRate: FPS, maximumPacketCount: frameCount + 4 });
  output.setMetadataTags({ title: "TrueMax face analysis", artist: "TrueMax" });
  await output.start();

  for (let frame = 0; frame < frameCount; frame++) {
    const t = frame / FPS;
    drawFrame(canvas, photo, landmarks, sex, scores, t, variant);
    await source.add(t, 1 / FPS, { keyFrame: frame % (FPS * 2) === 0 });
    if (frame % 6 === 0) onProgress?.(frame / frameCount);
  }
  await output.finalize();
  if (!target.buffer) throw new Error("The MP4 encoder returned no file.");
  const url = URL.createObjectURL(new Blob([target.buffer], { type: format.mimeType }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `truemax-${variant}-${Date.now()}.mp4`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  onProgress?.(1);
}

// Development-only render hook used by the visual regression preview. It
// exercises the exact production compositor without invoking WebCodecs or a
// download, and is tree-shaken from the production quick page call path.
export function renderQuickVideoFrame(
  canvas: HTMLCanvasElement,
  photo: HTMLCanvasElement,
  landmarks: NormalizedLandmark[],
  sex: Sex,
  scores: QuickExportScores,
  t: number,
  variant: QuickVariant = "breakdown",
): void {
  canvas.width = W;
  canvas.height = H;
  drawFrame(canvas, photo, landmarks, sex, scores, t, variant);
}

function drawFrame(
  canvas: HTMLCanvasElement,
  photo: HTMLCanvasElement,
  landmarks: NormalizedLandmark[],
  sex: Sex,
  scores: QuickExportScores,
  t: number,
  variant: QuickVariant = "breakdown",
): void {
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#050606";
  ctx.fillRect(0, 0, W, H);
  if (variant === "verdict") {
    drawVerdictFrame(ctx, photo, landmarks, scores, t);
    drawWatermark(ctx);
    return;
  }
  drawWatermark(ctx);

  ctx.font = "600 18px Inter, Arial, sans-serif";
  ctx.letterSpacing = "5px";
  ctx.fillStyle = "#f5f5f1";
  ctx.fillText("TRUE", 48, 58);
  const trueW = ctx.measureText("TRUE").width;
  ctx.fillStyle = "#0c876f";
  ctx.fillText("MAX", 48 + trueW, 58);
  ctx.font = "500 12px Inter, Arial, sans-serif";
  ctx.letterSpacing = "3px";
  ctx.fillStyle = "#747a77";
  ctx.textAlign = "right";
  ctx.fillText("FRONT ANALYSIS", W - 48, 57);
  ctx.textAlign = "left";

  // Start nearly full-screen so the face/skin is the subject, then lift and
  // resize it into a wide analysis portrait. Interpolating all four bounds
  // makes this a genuine reposition rather than a max-height jump.
  const collapse = smoother(clamp01((t - 2.05) / 0.95));
  const px = lerp(22, 34, collapse);
  const py = lerp(92, 74, collapse);
  const pw = lerp(W - 44, W - 68, collapse);
  const ph = lerp(1118, 580, collapse);
  const crop = faceCrop(photo, landmarks, pw / ph, lerp(0.78, 0.68, collapse));
  roundedImage(ctx, photo, crop, px, py, pw, ph, lerp(34, 26, collapse));

  if (t < 3.05) {
    if (t < 1.75) drawScanLine(ctx, px, py, pw, ph, t);
    const pointReveal = clamp01((t - 1.15) / 0.65);
    if (pointReveal > 0) drawLandmarks(ctx, landmarks, photo, crop, px, py, pw, ph, pointReveal * (1 - collapse));
  }

  const contentAlpha = smoother(clamp01((t - 2.55) / 0.55));
  if (contentAlpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = contentAlpha;
  const y0 = 704;
  ctx.font = "500 13px Inter, Arial, sans-serif";
  ctx.letterSpacing = "3px";
  ctx.fillStyle = "#7f8682";
  ctx.fillText(`VS ${sex === "male" ? "MEN" : "WOMEN"}`, px, y0);

  const count = smoother(clamp01((t - 2.7) / 0.72));
  ctx.font = "300 95px Fraunces, Georgia, serif";
  ctx.letterSpacing = "-3px";
  ctx.fillStyle = "#f7f7f2";
  ctx.fillText((scores.overall * count).toFixed(1), px, y0 + 96);
  const scoreW = ctx.measureText((scores.overall * count).toFixed(1)).width;
  ctx.font = "300 31px Fraunces, Georgia, serif";
  ctx.fillStyle = "#747b77";
  ctx.fillText("/10", px + scoreW + 7, y0 + 96);
  ctx.font = "500 21px Inter, Arial, sans-serif";
  ctx.letterSpacing = "0px";
  ctx.fillStyle = "#0c876f";
  ctx.fillText(rankShort(scores.percentile), px, y0 + 131);

  const gridY = y0 + 171;
  const gap = 12;
  const cw = (pw - gap) / 2;
  const ch = 78;
  scores.regions.slice(0, 8).forEach((region, i) => {
    const row = Math.floor(i / 2);
    const col = i % 2;
    const stagger = smoother(clamp01((t - (2.9 + i * 0.055)) / 0.42));
    const x = px + col * (cw + gap);
    const y = gridY + row * (ch + 9) - (1 - stagger) * 18;
    ctx.globalAlpha = contentAlpha * stagger;
    roundRect(ctx, x, y, cw, ch, 17);
    ctx.fillStyle = "#111413";
    ctx.fill();
    ctx.strokeStyle = "#252a28";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.font = "500 11px Inter, Arial, sans-serif";
    ctx.letterSpacing = "2px";
    ctx.fillStyle = "#808783";
    ctx.fillText(region.name.toUpperCase(), x + 16, y + 21);
    ctx.font = "400 29px Fraunces, Georgia, serif";
    ctx.letterSpacing = "0px";
    ctx.fillStyle = "#f3f4ef";
    ctx.fillText((region.score * smoother(clamp01((t - 3.02) / 0.7))).toFixed(1), x + 16, y + 52);
    ctx.fillStyle = "#292e2c";
    ctx.fillRect(x + 16, y + 66, cw - 32, 3);
    ctx.fillStyle = "#0c876f";
    ctx.fillRect(x + 16, y + 66, (cw - 32) * clamp01(region.score / 10) * stagger, 3);
  });
  ctx.restore();
}

// The way back. A reel that travels without its address is an ad for a
// product nobody can find, so the address sits on every frame — screenshots,
// trims and re-uploads all carry it. Steady rather than animated, and dim
// enough to read as a signature instead of a banner; both variants keep the
// bottom 40px of the frame clear of content, so nothing ever sits under it.
function drawWatermark(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.font = "500 16px Inter, Arial, sans-serif";
  ctx.letterSpacing = "2px";
  ctx.textAlign = "left";
  const name = "truemax";
  const tld = ".app";
  const total = ctx.measureText(name).width + ctx.measureText(tld).width;
  const x = (W - total) / 2;
  const y = H - 22;
  ctx.globalAlpha = 0.62;
  ctx.fillStyle = "#f5f5f1";
  ctx.fillText(name, x, y);
  ctx.fillStyle = "#0c876f";
  ctx.fillText(tld, x + ctx.measureText(name).width, y);
  ctx.restore();
}

interface Crop { x: number; y: number; w: number; h: number }

function faceCrop(
  photo: HTMLCanvasElement,
  landmarks: NormalizedLandmark[],
  aspect: number,
  faceWidthFraction: number,
): Crop {
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
  for (const p of landmarks) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  const faceW = Math.max(1, (x1 - x0) * photo.width);
  const faceH = Math.max(1, (y1 - y0) * photo.height);
  let sw = Math.max(faceW / faceWidthFraction, (faceH / 0.76) * aspect);
  let sh = sw / aspect;
  if (sw > photo.width) { sw = photo.width; sh = sw / aspect; }
  if (sh > photo.height) { sh = photo.height; sw = sh * aspect; }
  const cx = ((x0 + x1) / 2) * photo.width;
  const cy = ((y0 + y1) / 2) * photo.height;
  return {
    x: Math.max(0, Math.min(photo.width - sw, cx - sw / 2)),
    y: Math.max(0, Math.min(photo.height - sh, cy - sh * 0.48)),
    w: sw,
    h: sh,
  };
}

function roundedImage(ctx: CanvasRenderingContext2D, photo: HTMLCanvasElement, crop: Crop, x: number, y: number, w: number, h: number, r: number): void {
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.drawImage(photo, crop.x, crop.y, crop.w, crop.h, x, y, w, h);
  const shade = ctx.createLinearGradient(0, y, 0, y + h);
  shade.addColorStop(0, "rgba(0,0,0,.03)");
  shade.addColorStop(0.72, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,.24)");
  ctx.fillStyle = shade;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

function drawScanLine(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, t: number): void {
  const local = (t % 1.15) / 1.15;
  const yy = y + h * local;
  const gradient = ctx.createLinearGradient(x, 0, x + w, 0);
  gradient.addColorStop(0, "rgba(143,243,224,0)");
  gradient.addColorStop(0.5, "rgba(143,243,224,.95)");
  gradient.addColorStop(1, "rgba(143,243,224,0)");
  ctx.save();
  ctx.strokeStyle = gradient;
  ctx.shadowColor = "rgba(143,243,224,.8)";
  ctx.shadowBlur = 24;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x, yy);
  ctx.lineTo(x + w, yy);
  ctx.stroke();
  ctx.restore();
}

function drawLandmarks(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  photo: HTMLCanvasElement,
  crop: Crop,
  x: number,
  y: number,
  w: number,
  h: number,
  progress: number,
): void {
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,.88)";
  const visible = Math.floor(landmarks.length * progress);
  for (let i = 0; i < visible; i += 2) {
    const p = landmarks[i];
    const px = x + ((p.x * photo.width - crop.x) / crop.w) * w;
    const py = y + ((p.y * photo.height - crop.y) / crop.h) * h;
    if (px < x || px > x + w || py < y || py > y + h) continue;
    ctx.beginPath();
    ctx.arc(px, py, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const smoother = (n: number) => n * n * n * (n * (n * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---------------------------------------------------------------------------
// The verdict cut.
//
// Same face, same scan, one word. Four seconds, and the whole thing is built
// around the moment the word lands: the scan runs, the frame settles, and then
// the verdict cuts in at speed with a bar underneath showing where it sits.
//
// Nothing is dressed up and nothing is softened. The word comes from
// engine/analysisMode.ts, which reads the same percentile as every other
// surface — so a reel and the app can never disagree about the same face.
// ---------------------------------------------------------------------------
// Largest size at which the verdict still fits, wrapping onto a second line
// before it shrinks.
//
// The size was hard-coded at 92px, set against "Mogger" and never rechecked.
// The ladder now reaches "Comfortably above average" — twenty-five characters,
// nearly three frame-widths at that size, which is how "Background character"
// came to run off both edges and through the label above it.
//
// Shrinking alone is the wrong fix: fitting the longest rung on one line means
// about 42px, and a verdict that small stops being the punchline of the clip.
// Two lines at a big size reads better than one line at a small one, so this
// wraps first and only then steps the size down.
//
// Stepping rather than solving, because letter-spacing and font fallback make
// the relationship between size and width not quite linear, and a measured
// answer beats a clever one.
export function fitVerdict(
  ctx: CanvasRenderingContext2D,
  word: string,
  maxWidth: number,
  start: number,
  overshoot = 1,
): { size: number; lines: string[] } {
  const previous = ctx.font;
  const spacing = ctx.letterSpacing;
  ctx.letterSpacing = "-2px";
  const words = word.split(" ");

  const wrap = (size: number): string[] | null => {
    ctx.font = `300 ${size}px Fraunces, Georgia, serif`;
    const fits = (text: string) => ctx.measureText(text).width * overshoot <= maxWidth;
    if (fits(word)) return [word];
    if (words.length < 2) return null;
    // Only ever two lines. Three lines of a one-word verdict is a paragraph.
    for (let split = 1; split < words.length; split++) {
      const top = words.slice(0, split).join(" ");
      const bottom = words.slice(split).join(" ");
      if (fits(top) && fits(bottom)) return [top, bottom];
    }
    return null;
  };

  let size = start;
  let lines = wrap(size);
  while (!lines && size > 34) {
    size -= 2;
    lines = wrap(size);
  }
  ctx.font = previous;
  ctx.letterSpacing = spacing;
  return { size, lines: lines ?? [word] };
}

function drawVerdictFrame(
  ctx: CanvasRenderingContext2D,
  photo: HTMLCanvasElement,
  landmarks: NormalizedLandmark[],
  scores: QuickExportScores,
  t: number,
): void {
  ctx.font = "600 18px Inter, Arial, sans-serif";
  ctx.letterSpacing = "5px";
  ctx.fillStyle = "#f5f5f1";
  ctx.fillText("TRUE", 48, 58);
  const trueW = ctx.measureText("TRUE").width;
  ctx.fillStyle = "#0c876f";
  ctx.fillText("MAX", 48 + trueW, 58);
  ctx.letterSpacing = "0px";

  // The photograph holds most of the frame the whole way through — it only
  // lifts enough to seat the word. A verdict over a thumbnail is a graphic; a
  // verdict over a face is a reaction.
  const settle = smoother(clamp01((t - 1.5) / 0.7));
  const px = 34;
  const py = lerp(96, 84, settle);
  const pw = W - 68;
  const ph = lerp(1120, 780, settle);
  const crop = faceCrop(photo, landmarks, pw / ph, lerp(0.74, 0.66, settle));
  roundedImage(ctx, photo, crop, px, py, pw, ph, 30);

  if (t < 2.2) {
    if (t < 1.35) drawScanLine(ctx, px, py, pw, ph, t);
    const reveal = clamp01((t - 0.8) / 0.55);
    if (reveal > 0) drawLandmarks(ctx, landmarks, photo, crop, px, py, pw, ph, reveal * (1 - settle));
  }

  const verdict = verdictForPercentile(scores.percentile);
  const bright = verdict.tone === "high" || verdict.tone === "peak";
  // A hard, fast entrance rather than a fade. The joke is the cut.
  const punch = clamp01((t - 2.25) / 0.22);
  if (punch <= 0) return;
  const eased = 1 - (1 - punch) ** 3;

  ctx.save();
  ctx.globalAlpha = eased;
  const wordY = py + ph + 108;

  ctx.font = "500 13px Inter, Arial, sans-serif";
  ctx.letterSpacing = "4px";
  ctx.fillStyle = "#747b77";
  ctx.textAlign = "center";
  // Overshoot slightly and settle back, so the word arrives with weight.
  const scale = 1 + (1 - eased) * 0.14;
  // 92px was set against "Mogger" and never rechecked. "Background character"
  // is nineteen characters and ran off both edges of a 720px frame, straight
  // through the label above it. The size is now derived from the longest word
  // the ladder can actually produce, measured at the peak of the overshoot —
  // sizing to the settled width would still clip on the frame where it lands.
  const { size, lines } = fitVerdict(ctx, verdict.word, pw, 92, scale);
  const step = size * 0.94;
  // A two-line verdict grows downward from the label, so the label sits above
  // the first line rather than above the block, and the bar clears the last.
  ctx.fillText("VERDICT", W / 2, wordY - size * 0.9);

  ctx.translate(W / 2, wordY);
  ctx.scale(scale, scale);
  ctx.font = `300 ${size}px Fraunces, Georgia, serif`;
  ctx.letterSpacing = "-2px";
  ctx.fillStyle = bright ? "#8ff3e0" : "#f7f7f2";
  lines.forEach((line, i) => ctx.fillText(line, 0, i * step));
  ctx.restore();

  // The bar is the honesty. A one-word verdict on its own is a claim; the same
  // word above a marked scale is a measurement someone can argue with.
  const barAlpha = smoother(clamp01((t - 2.75) / 0.5));
  if (barAlpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = barAlpha;
  const barY = wordY + (lines.length - 1) * step + 62;
  const barW = pw;
  ctx.fillStyle = "#222725";
  ctx.fillRect(px, barY, barW, 4);
  const fill = barW * clamp01(scores.percentile / 100) * smoother(clamp01((t - 2.85) / 0.7));
  ctx.fillStyle = "#0c876f";
  ctx.fillRect(px, barY, fill, 4);
  ctx.font = "500 15px Inter, Arial, sans-serif";
  ctx.letterSpacing = "1px";
  ctx.fillStyle = "#8b918d";
  ctx.textAlign = "center";
  ctx.fillText(`${rankShort(scores.percentile)} · MEASURED, NOT GUESSED`, W / 2, barY + 34);
  ctx.textAlign = "left";
  ctx.restore();
}
