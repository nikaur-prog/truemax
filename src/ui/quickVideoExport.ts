import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { Sex } from "../engine/types.ts";
import { rankShort } from "./templates.ts";

// 720p is the deliberate client-side export size. It is native 9:16, uploads
// cleanly to TikTok/Reels, and renders roughly four times fewer pixels than
// 1080p. The first 1080p browser trial took longer than the entire clip to
// encode on an ordinary laptop, which is not a shippable download button.
const W = 540;
const H = 960;
const DESIGN_W = 720;
const DESIGN_H = 1280;
// Ten frames per second keeps the in-browser H.264 render under the length of
// a normal upload interaction even on software-only encoders. All movement is
// slow easing and count-up motion, so it remains visually smooth at this rate.
const FPS = 10;
const DURATION = 5;
const FRAME_COUNT = FPS * DURATION;

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
): Promise<void> {
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
    bitrate: 2_000_000,
    keyFrameInterval: 2,
  });
  output.addVideoTrack(source, { frameRate: FPS, maximumPacketCount: FRAME_COUNT + 4 });
  output.setMetadataTags({ title: "TrueMax face analysis", artist: "TrueMax" });
  await output.start();

  for (let frame = 0; frame < FRAME_COUNT; frame++) {
    const t = frame / FPS;
    drawFrame(canvas, photo, landmarks, sex, scores, t);
    await source.add(t, 1 / FPS, { keyFrame: frame % (FPS * 2) === 0 });
    if (frame % 5 === 0) onProgress?.(frame / FRAME_COUNT);
  }
  await output.finalize();
  if (!target.buffer) throw new Error("The MP4 encoder returned no file.");
  const url = URL.createObjectURL(new Blob([target.buffer], { type: format.mimeType }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `truemax-tiktok-${Date.now()}.mp4`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  onProgress?.(1);
}

function drawFrame(
  canvas: HTMLCanvasElement,
  photo: HTMLCanvasElement,
  landmarks: NormalizedLandmark[],
  sex: Sex,
  scores: QuickExportScores,
  t: number,
): void {
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(W / DESIGN_W, 0, 0, H / DESIGN_H, 0, 0);
  ctx.fillStyle = "#f5f3ee";
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

  ctx.font = "600 18px Inter, Arial, sans-serif";
  ctx.letterSpacing = "5px";
  ctx.fillStyle = "#171816";
  ctx.fillText("TRUE", 48, 58);
  const trueW = ctx.measureText("TRUE").width;
  ctx.fillStyle = "#0c876f";
  ctx.fillText("MAX", 48 + trueW, 58);
  ctx.font = "500 12px Inter, Arial, sans-serif";
  ctx.letterSpacing = "3px";
  ctx.fillStyle = "#989b99";
  ctx.textAlign = "right";
  ctx.fillText("FRONT ANALYSIS", DESIGN_W - 48, 57);
  ctx.textAlign = "left";

  const photoEnd = 2.75;
  const collapse = ease(clamp01((t - 2.0) / 0.75));
  const px = 48;
  const py = 88;
  const pw = DESIGN_W - 96;
  const ph = lerp(835, 454, collapse);
  roundedImage(ctx, photo, px, py, pw, ph, 38);

  if (t < photoEnd) {
    if (t < 1.75) drawScanLine(ctx, px, py, pw, ph, t);
    const pointReveal = clamp01((t - 1.15) / 0.65);
    if (pointReveal > 0) drawLandmarks(ctx, landmarks, photo, px, py, pw, ph, pointReveal);
  }

  const contentAlpha = ease(clamp01((t - 2.25) / 0.45));
  if (contentAlpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = contentAlpha;
  const y0 = py + ph + 37;
  ctx.font = "500 13px Inter, Arial, sans-serif";
  ctx.letterSpacing = "3px";
  ctx.fillStyle = "#929694";
  ctx.fillText(`VS ${sex === "male" ? "MEN" : "WOMEN"}`, px, y0);

  const count = ease(clamp01((t - 2.45) / 0.7));
  ctx.font = "300 95px Fraunces, Georgia, serif";
  ctx.letterSpacing = "-3px";
  ctx.fillStyle = "#171816";
  ctx.fillText((scores.overall * count).toFixed(1), px, y0 + 96);
  const scoreW = ctx.measureText((scores.overall * count).toFixed(1)).width;
  ctx.font = "300 31px Fraunces, Georgia, serif";
  ctx.fillStyle = "#8f9491";
  ctx.fillText("/10", px + scoreW + 7, y0 + 96);
  ctx.font = "500 21px Inter, Arial, sans-serif";
  ctx.letterSpacing = "0px";
  ctx.fillStyle = "#0c876f";
  ctx.fillText(rankShort(scores.percentile), px, y0 + 131);

  const gridY = y0 + 163;
  const gap = 15;
  const cw = (pw - gap) / 2;
  const ch = 95;
  scores.regions.slice(0, 8).forEach((region, i) => {
    const row = Math.floor(i / 2);
    const col = i % 2;
    const stagger = ease(clamp01((t - (2.7 + i * 0.065)) / 0.36));
    const x = px + col * (cw + gap);
    const y = gridY + row * (ch + 12) - (1 - stagger) * 23;
    ctx.globalAlpha = contentAlpha * stagger;
    roundRect(ctx, x, y, cw, ch, 17);
    ctx.fillStyle = "rgba(255,255,255,.88)";
    ctx.fill();
    ctx.strokeStyle = "#dddcd5";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = "500 11px Inter, Arial, sans-serif";
    ctx.letterSpacing = "2px";
    ctx.fillStyle = "#929694";
    ctx.fillText(region.name.toUpperCase(), x + 17, y + 23);
    ctx.font = "400 33px Fraunces, Georgia, serif";
    ctx.letterSpacing = "0px";
    ctx.fillStyle = "#171816";
    ctx.fillText((region.score * ease(clamp01((t - 2.95) / 0.65))).toFixed(1), x + 17, y + 61);
    ctx.fillStyle = "#e5e3dc";
    ctx.fillRect(x + 17, y + 77, cw - 34, 4);
    ctx.fillStyle = "#0c876f";
    ctx.fillRect(x + 17, y + 77, (cw - 34) * clamp01(region.score / 10) * stagger, 4);
  });
  ctx.restore();
}

function roundedImage(ctx: CanvasRenderingContext2D, photo: HTMLCanvasElement, x: number, y: number, w: number, h: number, r: number): void {
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  const scale = Math.max(w / photo.width, h / photo.height);
  const dw = photo.width * scale;
  const dh = photo.height * scale;
  ctx.drawImage(photo, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
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
  x: number,
  y: number,
  w: number,
  h: number,
  progress: number,
): void {
  const scale = Math.max(w / photo.width, h / photo.height);
  const dw = photo.width * scale;
  const dh = photo.height * scale;
  const ox = x + (w - dw) / 2;
  const oy = y + (h - dh) / 2;
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,.88)";
  const visible = Math.floor(landmarks.length * progress);
  for (let i = 0; i < visible; i += 2) {
    const p = landmarks[i];
    const px = ox + p.x * dw;
    const py = oy + p.y * dh;
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
const ease = (n: number) => 1 - Math.pow(1 - n, 3);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
