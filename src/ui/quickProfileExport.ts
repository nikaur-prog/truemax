import type { ScoredMetric, Sex } from "../engine/types.js";
import type { SidePointId, SidePoints } from "../engine/sideMetrics.js";
import { rankShort } from "./templates.js";
import { drawSideMeasurement } from "./sideMeasureOverlay.js";
import { drawCtaCard } from "./ctaCard.js";
import { exportName, saveFile } from "./saveFile.js";
import type { SaveOutcome } from "./saveFile.js";

const W = 720;
const H = 1280;
const SCALE = 1.5;
const FPS = 30;
const BODY_SECONDS = 6.4;
const CTA_SECONDS = 1.6;

export interface QuickProfileScores {
  overall: number;
  percentile: number;
  potential: number;
  regions: Array<{ name: string; score: number }>;
}

export interface QuickProfileAssets {
  photo: HTMLCanvasElement;
  points: SidePoints;
  metrics: ScoredMetric[];
  sex: Sex;
  scores: QuickProfileScores;
}

const PROFILE_SCORECARD_ORDER = ["jaw", "chin", "nose", "lips"] as const;

/** Keep every profile export comparable, even when input regions are sorted by score. */
export function profileScorecardRegions(
  regions: QuickProfileScores["regions"],
): QuickProfileScores["regions"] {
  const available = regions.filter((region) => Number.isFinite(region.score));
  const picked: QuickProfileScores["regions"] = [];
  for (const wanted of PROFILE_SCORECARD_ORDER) {
    const match = available.find((region) => region.name.trim().toLowerCase() === wanted);
    if (match) picked.push(match);
  }
  for (const region of available) {
    if (picked.includes(region)) continue;
    picked.push(region);
    if (picked.length === 4) break;
  }
  return picked.slice(0, 4);
}

interface Crop { x: number; y: number; w: number; h: number }

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smoother = (value: number) => {
  const n = clamp01(value);
  return n * n * n * (n * (n * 6 - 15) + 10);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function profileCrop(photo: HTMLCanvasElement, points: SidePoints, aspect: number): Crop {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const point of Object.values(points)) {
    x0 = Math.min(x0, point.x);
    x1 = Math.max(x1, point.x);
    y0 = Math.min(y0, point.y);
    y1 = Math.max(y1, point.y);
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: photo.width, h: photo.height };
  const bw = Math.max(1, x1 - x0);
  const bh = Math.max(1, y1 - y0);
  let sh = bh / 0.58;
  let sw = sh * aspect;
  if (sw < bw * 1.65) {
    sw = bw * 1.65;
    sh = sw / aspect;
  }
  if (sw > photo.width) {
    sw = photo.width;
    sh = sw / aspect;
  }
  if (sh > photo.height) {
    sh = photo.height;
    sw = sh * aspect;
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return {
    x: Math.max(0, Math.min(photo.width - sw, cx - sw / 2)),
    y: Math.max(0, Math.min(photo.height - sh, cy - sh * 0.48)),
    w: sw,
    h: sh,
  };
}

function roundedImage(
  ctx: CanvasRenderingContext2D,
  photo: HTMLCanvasElement,
  crop: Crop,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.clip();
  ctx.drawImage(photo, crop.x, crop.y, crop.w, crop.h, x, y, w, h);
  ctx.restore();
  ctx.strokeStyle = "rgba(143,243,224,.22)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.stroke();
}

const PROFILE_EDGES: Array<[SidePointId, SidePointId]> = [
  ["trichion", "glabella"], ["glabella", "nasion"], ["nasion", "pronasale"],
  ["pronasale", "subnasale"], ["subnasale", "labialeSuperius"],
  ["labialeSuperius", "labialeInferius"], ["labialeInferius", "pogonion"],
  ["pogonion", "menton"], ["menton", "cervicale"], ["menton", "gonion"],
  ["gonion", "condylion"], ["condylion", "tragion"], ["tragion", "subnasale"],
  ["pronasale", "pogonion"], ["nasion", "pogonion"],
];

function project(point: { x: number; y: number }, crop: Crop, x: number, y: number, w: number, h: number) {
  return { x: x + ((point.x - crop.x) / crop.w) * w, y: y + ((point.y - crop.y) / crop.h) * h };
}

function drawProfileNetwork(
  ctx: CanvasRenderingContext2D,
  points: SidePoints,
  crop: Crop,
  x: number,
  y: number,
  w: number,
  h: number,
  reveal: number,
  alpha: number,
): void {
  const count = Math.ceil(PROFILE_EDGES.length * clamp01(reveal));
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = `rgba(143,243,224,${0.48 * alpha})`;
  for (let index = 0; index < count; index += 1) {
    const edge = PROFILE_EDGES[index];
    const a = project(points[edge[0]], crop, x, y, w, h);
    const b = project(points[edge[1]], crop, x, y, w, h);
    const local = index === count - 1 ? (reveal * PROFILE_EDGES.length) % 1 || 1 : 1;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(lerp(a.x, b.x, local), lerp(a.y, b.y, local));
    ctx.stroke();
  }
  const pointCount = Math.ceil(Object.values(points).length * clamp01(reveal));
  for (const point of Object.values(points).slice(0, pointCount)) {
    const p = project(point, crop, x, y, w, h);
    ctx.fillStyle = `rgba(201,255,242,${0.92 * alpha})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Draw the reviewed 13-point profile as a connected, creator-facing scan. */
export function drawQuickProfileLandmarks(
  canvas: HTMLCanvasElement,
  points: SidePoints,
  width: number,
  height: number,
): void {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  drawProfileNetwork(ctx, points, { x: 0, y: 0, w: width, h: height }, 0, 0, width, height, 1, 1);
}

let overlayScratch: HTMLCanvasElement | null = null;

export function renderQuickProfileFrame(canvas: HTMLCanvasElement, assets: QuickProfileAssets, t: number, scale = 1): void {
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#050606";
  ctx.fillRect(0, 0, W, H);

  ctx.font = "600 18px Inter, Arial, sans-serif";
  ctx.letterSpacing = "5px";
  ctx.fillStyle = "#f5f5f1";
  ctx.fillText("TRUE", 42, 56);
  const trueWidth = ctx.measureText("TRUE").width;
  ctx.fillStyle = "#0c876f";
  ctx.fillText("MAX", 42 + trueWidth, 56);
  ctx.font = "500 12px Inter, Arial, sans-serif";
  ctx.letterSpacing = "3px";
  ctx.fillStyle = "#747a77";
  ctx.textAlign = "right";
  ctx.fillText("PROFILE ANALYSIS", W - 42, 56);
  ctx.textAlign = "left";

  const collapse = smoother((t - 2.45) / 0.75);
  const px = lerp(22, 30, collapse);
  const py = lerp(82, 76, collapse);
  const pw = lerp(W - 44, W - 60, collapse);
  const ph = lerp(1118, 520, collapse);
  const crop = profileCrop(assets.photo, assets.points, pw / ph);
  roundedImage(ctx, assets.photo, crop, px, py, pw, ph, lerp(34, 24, collapse));

  if (t < 3.25) {
    const sweep = clamp01(t / 1.35);
    if (sweep < 1) {
      const sy = py + ph * smoother(sweep);
      const glow = ctx.createLinearGradient(px, sy, px + pw, sy);
      glow.addColorStop(0, "rgba(143,243,224,0)");
      glow.addColorStop(.5, "rgba(143,243,224,.9)");
      glow.addColorStop(1, "rgba(143,243,224,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(px, sy - 1, pw, 2);
    }
    const networkReveal = smoother((t - 0.55) / 1.25);
    const networkAlpha = 1 - smoother((t - 2.45) / 0.65);
    if (networkReveal > 0 && networkAlpha > 0) {
      drawProfileNetwork(ctx, assets.points, crop, px, py, pw, ph, networkReveal, networkAlpha);
    }
    if (assets.metrics.length && t >= 1.35) {
      const eligible = assets.metrics.filter((metric) => !metric.implausible).slice(0, 5);
      const index = Math.min(eligible.length - 1, Math.floor((t - 1.35) / 0.38));
      const metric = eligible[index];
      if (metric) {
        const local = smoother(((t - 1.35) % 0.38) / 0.28);
        const scratch = overlayScratch ?? (overlayScratch = document.createElement("canvas"));
        drawSideMeasurement(scratch, assets.points, assets.photo.width, assets.photo.height, metric, local, { labels: false });
        ctx.save();
        ctx.globalAlpha = networkAlpha * 0.9;
        ctx.beginPath();
        ctx.roundRect(px, py, pw, ph, lerp(34, 24, collapse));
        ctx.clip();
        ctx.drawImage(scratch, crop.x, crop.y, crop.w, crop.h, px, py, pw, ph);
        ctx.restore();
      }
    }
  }

  const reveal = smoother((t - 2.75) / 0.6);
  if (reveal <= 0) return;
  ctx.save();
  ctx.globalAlpha = reveal;
  ctx.font = "500 12px Inter, Arial, sans-serif";
  ctx.letterSpacing = "3px";
  ctx.fillStyle = "#747a77";
  ctx.fillText(`PROFILE · VS ${assets.sex === "male" ? "MEN" : "WOMEN"}`, 34, 642);
  ctx.font = "300 96px Fraunces, Georgia, serif";
  ctx.letterSpacing = "-3px";
  ctx.fillStyle = "#f7f7f2";
  const count = smoother((t - 2.85) / 0.8);
  ctx.fillText((assets.scores.overall * count).toFixed(1), 32, 742);
  ctx.font = "600 19px Inter, Arial, sans-serif";
  ctx.letterSpacing = "0px";
  ctx.fillStyle = "#8ff3e0";
  ctx.fillText(rankShort(assets.scores.percentile), 36, 776);

  const rows = profileScorecardRegions(assets.scores.regions);
  rows.forEach((row, index) => {
    const rowReveal = smoother((t - 3.35 - index * 0.16) / 0.48);
    if (rowReveal <= 0) return;
    const y = 842 + index * 82;
    ctx.globalAlpha = reveal * rowReveal;
    ctx.font = "500 15px Inter, Arial, sans-serif";
    ctx.letterSpacing = "2px";
    ctx.fillStyle = "#a1a7a3";
    ctx.fillText(row.name.toUpperCase(), 36, y);
    ctx.textAlign = "right";
    ctx.font = "400 30px Fraunces, Georgia, serif";
    ctx.letterSpacing = "0px";
    ctx.fillStyle = "#f7f7f2";
    ctx.fillText(row.score.toFixed(1), W - 36, y + 4);
    ctx.textAlign = "left";
    ctx.fillStyle = "#222725";
    ctx.fillRect(36, y + 22, W - 72, 4);
    ctx.fillStyle = "#0c876f";
    ctx.fillRect(36, y + 22, (W - 72) * clamp01(row.score / 10) * rowReveal, 4);
  });
  ctx.restore();

  ctx.save();
  ctx.font = "500 11px Inter, Arial, sans-serif";
  ctx.letterSpacing = "3px";
  ctx.fillStyle = "#59615d";
  ctx.textAlign = "center";
  ctx.fillText("13 LANDMARKS CHECKED · TRUEMAX.APP", W / 2, H - 34);
  ctx.restore();
}

export async function downloadQuickProfileVideo(
  assets: QuickProfileAssets,
  onProgress?: (progress: number) => void,
): Promise<SaveOutcome> {
  const { Output, BufferTarget, Mp4OutputFormat, CanvasSource, QUALITY_HIGH, getFirstEncodableVideoCodec } =
    await import("mediabunny");
  const canvas = document.createElement("canvas");
  const format = new Mp4OutputFormat({ fastStart: "in-memory" });
  let scale = SCALE;
  let codec = null as Awaited<ReturnType<typeof getFirstEncodableVideoCodec>>;
  for (const candidate of [SCALE, 1]) {
    canvas.width = Math.round(W * candidate);
    canvas.height = Math.round(H * candidate);
    codec = await getFirstEncodableVideoCodec(
      format.getSupportedVideoCodecs().filter((value) => value === "avc"),
      { width: canvas.width, height: canvas.height, quality: QUALITY_HIGH },
    );
    if (codec) {
      scale = candidate;
      break;
    }
  }
  if (!codec) throw new Error("This browser cannot encode an H.264 MP4.");
  const target = new BufferTarget();
  const output = new Output({ format, target });
  const source = new CanvasSource(canvas, {
    codec,
    bitrate: scale >= SCALE ? 12_000_000 : 6_000_000,
    keyFrameInterval: 2,
  });
  const frames = Math.round((BODY_SECONDS + CTA_SECONDS) * FPS);
  output.addVideoTrack(source, { frameRate: FPS, maximumPacketCount: frames + 4 });
  output.setMetadataTags({ title: "TrueMax profile analysis", artist: "TrueMax" });
  await output.start();
  for (let frame = 0; frame < frames; frame += 1) {
    const t = frame / FPS;
    if (t < BODY_SECONDS) renderQuickProfileFrame(canvas, assets, t, scale);
    else {
      canvas.width = Math.round(W * scale);
      canvas.height = Math.round(H * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      drawCtaCard(ctx, canvas.width, canvas.height, t - BODY_SECONDS, 0.5);
    }
    await source.add(t, 1 / FPS, { keyFrame: frame % (FPS * 2) === 0 });
    if (frame % 6 === 0) onProgress?.(frame / frames);
  }
  await output.finalize();
  if (!target.buffer) throw new Error("The MP4 encoder returned no file.");
  onProgress?.(1);
  return saveFile(
    new Blob([target.buffer], { type: format.mimeType }),
    exportName("reel", "mp4", "profile-analysis"),
    "reel",
  );
}

export function renderProfileScoreCard(canvas: HTMLCanvasElement, assets: QuickProfileAssets, caption?: string): void {
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#050606";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const glow = ctx.createRadialGradient(540, 430, 60, 540, 430, 700);
  glow.addColorStop(0, "rgba(12,135,111,.18)");
  glow.addColorStop(1, "rgba(5,6,6,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1080, 1050);
  const crop = profileCrop(assets.photo, assets.points, 760 / 650);
  roundedImage(ctx, assets.photo, crop, 160, 150, 760, 650, 56);
  if (caption) {
    ctx.font = "500 24px Inter, Arial, sans-serif";
    ctx.letterSpacing = "6px";
    ctx.textAlign = "center";
    ctx.fillStyle = "#9aa09d";
    ctx.fillText(caption.toUpperCase(), 540, 105);
  }
  ctx.textAlign = "left";
  ctx.font = "500 24px Inter, Arial, sans-serif";
  ctx.letterSpacing = "5px";
  ctx.fillStyle = "#7f8682";
  ctx.fillText("PROFILE SCORE", 96, 900);
  ctx.font = "300 132px Fraunces, Georgia, serif";
  ctx.letterSpacing = "-4px";
  ctx.fillStyle = "#f7f7f2";
  ctx.fillText(assets.scores.overall.toFixed(1), 92, 1028);
  ctx.font = "600 34px Inter, Arial, sans-serif";
  ctx.letterSpacing = "0px";
  ctx.fillStyle = "#8ff3e0";
  ctx.fillText(rankShort(assets.scores.percentile), 98, 1080);
  const rows = profileScorecardRegions(assets.scores.regions);
  rows.forEach((row, index) => {
    const col = index % 2;
    const rowIndex = Math.floor(index / 2);
    const x = 94 + col * 492;
    const y = 1180 + rowIndex * 260;
    ctx.strokeStyle = "#27302c";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, 450, 220, 30);
    ctx.stroke();
    ctx.font = "500 21px Inter, Arial, sans-serif";
    ctx.letterSpacing = "3px";
    ctx.fillStyle = "#8e9591";
    ctx.fillText(row.name.toUpperCase(), x + 30, y + 52);
    ctx.font = "300 64px Fraunces, Georgia, serif";
    ctx.letterSpacing = "-1px";
    ctx.fillStyle = "#f7f7f2";
    ctx.fillText(row.score.toFixed(1), x + 30, y + 128);
    ctx.fillStyle = "#222725";
    ctx.fillRect(x + 30, y + 166, 390, 7);
    ctx.fillStyle = "#0c876f";
    ctx.fillRect(x + 30, y + 166, 390 * clamp01(row.score / 10), 7);
  });
  ctx.textAlign = "center";
  ctx.font = "500 30px Inter, Arial, sans-serif";
  ctx.letterSpacing = "5px";
  ctx.fillStyle = "#f7f7f2";
  ctx.fillText("truemax", 510, 1810);
  ctx.fillStyle = "#0c876f";
  ctx.fillText(".app", 640, 1810);
  ctx.font = "500 14px Inter, Arial, sans-serif";
  ctx.letterSpacing = "3px";
  ctx.fillStyle = "#59615d";
  ctx.fillText("13 PROFILE LANDMARKS CHECKED", 540, 1852);
}
