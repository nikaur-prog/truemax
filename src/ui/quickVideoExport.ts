import { FaceLandmarker } from "@mediapipe/tasks-vision";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { ScoredMetric, Sex } from "../engine/types.js";
import { rankShort } from "./templates.js";
import { DEFAULT_VERDICT_TONE, loadVerdictTone, verdictForPercentile } from "../engine/analysisMode.js";
import { exportName, saveFile } from "./saveFile.js";
import { drawCtaCard } from "./ctaCard.js";
import { drawSearchLockup } from "./searchLockup.js";
import { drawSideMeasurement } from "./sideMeasureOverlay.js";
import type { SidePoints } from "../engine/sideMetrics.js";
import type { SaveOutcome } from "./saveFile.js";

// Which cut to render.
//
//   breakdown — the eight-region analysis. Explains the product.
//   verdict   — one word, held on screen. Explains nothing, travels further.
//
// Both are the same footage of the same face, scanned by the same engine and
// composited by the same code. The verdict cut is shorter because a word does
// not need five seconds, and because the thing people re-post is the reaction,
// not the table.
//   dual      — front and side together, the two view scores converging into
//               the combined number. Only rendered where both views were
//               actually captured and the side's 13 points hand-confirmed —
//               it prints exactly the figures the in-app merged header prints,
//               nothing the data cannot support.
export type QuickVariant = "breakdown" | "verdict" | "dual";

// A real 720×1280, 30fps export. The previous renderer called a 540×960,
// 10fps file “720p”; no easing curve can make ten distinct images per second
// look fluid during a resize. Thirty frames gives social apps normal motion
// cadence while 720p remains practical to encode on-device.
const W = 720;
const H = 1280;


// What the exported file is rasterised at, as a multiple of the authored size.
// 1.5 is 1080x1920. See downloadQuickVideo for why it is not 1.
const EXPORT_SCALE = 1.5;
const FPS = 30;
const DURATION: Record<QuickVariant, number> = { breakdown: 5.5, verdict: 4, dual: 7 };

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
  /**
   * The score this face used to have, when this card is the second of a pair.
   *
   * The headline number counts up on reveal. From zero, that is a nice piece of
   * motion and nothing more. From the previous score it is the entire point of
   * the video: the viewer watched the before card land on 4.5, sat through the
   * after footage, and now watches the number climb out of 4.5 rather than
   * arrive from nowhere. The delta is the shareable frame, and it only exists
   * if the two numbers are drawn in the same place doing the same thing.
   */
  from?: number;
}

/**
 * Everything the dual cut needs beyond the front view, handed in by the one
 * screen that legitimately has it: Calibrate, after both slots were captured
 * and the side's 13 points were confirmed by hand. The scores are the merged
 * report's own view figures — this module draws them, it never derives them.
 */
export interface DualViewAssets {
  sidePhoto: HTMLCanvasElement;
  sidePoints: SidePoints;
  /** Side-view constructions for the scan beat, drawn in this order. */
  sideMetrics: ScoredMetric[];
  frontScore: number;
  sideScore: number;
}

// Returns how the file left the device, so the button can say what happened —
// "Saved" after a share sheet is a lie if the person cancelled it.
export async function downloadQuickVideo(
  photo: HTMLCanvasElement,
  landmarks: NormalizedLandmark[],
  sex: Sex,
  scores: QuickExportScores,
  onProgress?: (progress: number) => void,
  variant: QuickVariant = "breakdown",
  dual?: DualViewAssets,
): Promise<SaveOutcome> {
  // Both cuts end on the shared card: a beat and a half of "truemax.app"
  // after the analysis, which is the whole growth loop of a video built to be
  // posted. Short on purpose — the platform counts a rewatch from a loop, and
  // a long endcard is where a loop dies.
  const CTA_TAIL = 1.6;
  const body = DURATION[variant];
  const frameCount = Math.round(FPS * (body + CTA_TAIL));
  const { Output, BufferTarget, Mp4OutputFormat, CanvasSource, QUALITY_HIGH, getFirstEncodableVideoCodec } =
    await import("mediabunny");

  // Rendered at 1080x1920 through the scale the preview hook already used.
  //
  // The composition is authored in 720x1280 and drawn through a transform, so
  // this is a raster change and not a layout one. It matters more here than
  // anywhere: the platform re-encodes whatever it is handed, and the content of
  // this cut is a hairline mesh and small type — the first things a compression
  // pass destroys when they arrive already soft.
  const canvas = document.createElement("canvas");
  const format = new Mp4OutputFormat({ fastStart: "in-memory" });
  // 1080p first; 720p when the encoder refuses. Mobile browsers report codec
  // support per RESOLUTION, and "Couldn't render" on a phone was this refusal
  // surfacing as a dead button. The composition is authored at 720x1280, so
  // the fallback is a pure raster change: same layout, softer pixels, a video
  // in the camera roll instead of an error.
  let scale = EXPORT_SCALE;
  let codec = null as Awaited<ReturnType<typeof getFirstEncodableVideoCodec>>;
  for (const tryScale of [EXPORT_SCALE, 1]) {
    canvas.width = Math.round(W * tryScale);
    canvas.height = Math.round(H * tryScale);
    codec = await getFirstEncodableVideoCodec(
      format.getSupportedVideoCodecs().filter((candidate) => candidate === "avc"),
      { width: canvas.width, height: canvas.height, quality: QUALITY_HIGH },
    );
    if (codec) {
      scale = tryScale;
      break;
    }
  }
  if (!codec) throw new Error("This browser cannot encode an H.264 MP4.");

  const target = new BufferTarget();
  const output = new Output({ format, target });
  const source = new CanvasSource(canvas, {
    codec,
    // Raised with the resolution. 6 Mbps across 2.25x the pixels would be a
    // sharper image described in fewer bits per pixel than before, which is a
    // way to make a bigger file that looks worse. Scaled back down with the
    // 720p fallback for the same bits-per-pixel reason in reverse.
    bitrate: scale >= EXPORT_SCALE ? 12_000_000 : 6_000_000,
    keyFrameInterval: 2,
  });
  output.addVideoTrack(source, { frameRate: FPS, maximumPacketCount: frameCount + 4 });
  output.setMetadataTags({ title: "TrueMax face analysis", artist: "TrueMax" });
  await output.start();

  for (let frame = 0; frame < frameCount; frame++) {
    const t = frame / FPS;
    if (t >= body) {
      const g = canvas.getContext("2d")!;
      g.setTransform(1, 0, 0, 1, 0, 0);
      drawCtaCard(g, canvas.width, canvas.height, t - body, 0.5);
    } else {
      drawFrame(canvas, photo, landmarks, sex, scores, t, variant, scale, dual);
    }
    await source.add(t, 1 / FPS, { keyFrame: frame % (FPS * 2) === 0 });
    if (frame % 6 === 0) onProgress?.(frame / frameCount);
  }
  await output.finalize();
  if (!target.buffer) throw new Error("The MP4 encoder returned no file.");
  const outcome = await saveFile(
    new Blob([target.buffer], { type: format.mimeType }),
    exportName("reel", "mp4", variant),
    "reel",
  );
  onProgress?.(1);
  return outcome;
}

/**
 * The CTA outro on its own: the endcard every export already closes on,
 * rendered as a standalone clip for the operator who wants to drop it into an
 * edit of their own. Two full animation periods plus a settle — long enough
 * to cut on, short enough to loop. Silent on purpose: it lands in edits that
 * already carry a soundtrack.
 */
export async function downloadCtaOutro(onProgress?: (progress: number) => void): Promise<SaveOutcome> {
  const SECONDS = 4.4;
  const frameCount = Math.round(FPS * SECONDS);
  const { Output, BufferTarget, Mp4OutputFormat, CanvasSource, QUALITY_HIGH, getFirstEncodableVideoCodec } =
    await import("mediabunny");

  const canvas = document.createElement("canvas");
  const format = new Mp4OutputFormat({ fastStart: "in-memory" });
  // Same 1080p-then-720p ladder as downloadQuickVideo, for the same phones.
  let scale = EXPORT_SCALE;
  let codec = null as Awaited<ReturnType<typeof getFirstEncodableVideoCodec>>;
  for (const tryScale of [EXPORT_SCALE, 1]) {
    canvas.width = Math.round(W * tryScale);
    canvas.height = Math.round(H * tryScale);
    codec = await getFirstEncodableVideoCodec(
      format.getSupportedVideoCodecs().filter((candidate) => candidate === "avc"),
      { width: canvas.width, height: canvas.height, quality: QUALITY_HIGH },
    );
    if (codec) {
      scale = tryScale;
      break;
    }
  }
  if (!codec) throw new Error("This browser cannot encode an H.264 MP4.");

  const target = new BufferTarget();
  const output = new Output({ format, target });
  const source = new CanvasSource(canvas, {
    codec,
    bitrate: scale >= EXPORT_SCALE ? 12_000_000 : 6_000_000,
    keyFrameInterval: 2,
  });
  output.addVideoTrack(source, { frameRate: FPS, maximumPacketCount: frameCount + 4 });
  output.setMetadataTags({ title: "TrueMax outro", artist: "TrueMax" });
  await output.start();

  const g = canvas.getContext("2d")!;
  for (let frame = 0; frame < frameCount; frame++) {
    const t = frame / FPS;
    g.setTransform(1, 0, 0, 1, 0, 0);
    drawCtaCard(g, canvas.width, canvas.height, t, 0.5);
    await source.add(t, 1 / FPS, { keyFrame: frame % (FPS * 2) === 0 });
    if (frame % 6 === 0) onProgress?.(frame / frameCount);
  }
  await output.finalize();
  if (!target.buffer) throw new Error("The MP4 encoder returned no file.");
  const outcome = await saveFile(
    new Blob([target.buffer], { type: format.mimeType }),
    exportName("reel", "mp4", "cta-outro"),
    "reel",
  );
  onProgress?.(1);
  return outcome;
}

// Development-only render hook used by the visual regression preview. It
// exercises the exact production compositor without invoking WebCodecs or a
// download, and is tree-shaken from the production quick page call path.
// `scale` renders the same composition at a larger pixel size — the producer
// asks for 1.5 so the analysis segment is drawn natively at 1080x1920 instead
// of being upscaled from 720p. Text and hairlines are the whole content of
// this segment, and upscaling them is exactly what a platform re-encode then
// turns to mush.
export function renderQuickVideoFrame(
  canvas: HTMLCanvasElement,
  photo: HTMLCanvasElement,
  landmarks: NormalizedLandmark[],
  sex: Sex,
  scores: QuickExportScores,
  t: number,
  variant: QuickVariant = "breakdown",
  scale = 1,
  dual?: DualViewAssets,
): void {
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  drawFrame(canvas, photo, landmarks, sex, scores, t, variant, scale, dual);
}

function drawFrame(
  canvas: HTMLCanvasElement,
  photo: HTMLCanvasElement,
  landmarks: NormalizedLandmark[],
  sex: Sex,
  scores: QuickExportScores,
  t: number,
  variant: QuickVariant = "breakdown",
  scale = 1,
  dual?: DualViewAssets,
): void {
  const ctx = canvas.getContext("2d")!;
  // Everything below is authored in 720x1280 coordinates; the transform is the
  // only thing that knows about scale, so there is one layout rather than two.
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#050606";
  ctx.fillRect(0, 0, W, H);
  if (variant === "verdict") {
    drawVerdictFrame(ctx, photo, landmarks, sex, scores, t);
    drawWatermark(ctx);
    return;
  }
  if (variant === "dual" && dual) {
    drawDualFrame(ctx, photo, landmarks, scores, t, dual);
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
    // The mesh draws down the face, then fades as the frame collapses into the
    // analysis portrait. Two separate arguments: multiplying them together made
    // it retreat back up the face instead.
    if (pointReveal > 0) drawLandmarks(ctx, landmarks, photo, crop, px, py, pw, ph, pointReveal, 1 - collapse);
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
  // From the old score when there is one, from zero otherwise. A rise is drawn
  // in the accent green so the direction of travel is legible in the half
  // second somebody spends on the frame — a number climbing and a number
  // arriving look identical at 30fps otherwise.
  const from = scores.from ?? 0;
  const shown = from + (scores.overall - from) * count;
  const rising = scores.from !== undefined && scores.overall > scores.from;
  ctx.font = "300 95px Fraunces, Georgia, serif";
  ctx.letterSpacing = "-3px";
  ctx.fillStyle = rising ? "#3fbf9a" : "#f7f7f2";
  ctx.fillText(shown.toFixed(1), px, y0 + 96);
  const scoreW = ctx.measureText(shown.toFixed(1)).width;
  ctx.font = "300 31px Fraunces, Georgia, serif";
  ctx.fillStyle = "#747b77";
  ctx.fillText("/10", px + scoreW + 7, y0 + 96);
  ctx.font = "500 21px Inter, Arial, sans-serif";
  ctx.letterSpacing = "0px";
  ctx.fillStyle = "#0c876f";
  const delta = scores.from === undefined ? "" : ` · ${scores.overall >= scores.from ? "+" : ""}${(scores.overall - scores.from).toFixed(1)}`;
  ctx.fillText(rankShort(scores.percentile) + delta, px, y0 + 131);

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
// trims and re-uploads all carry it. Drawn as the shared search lockup
// rather than a flat wordmark: a persistent little search bar is an
// instruction, not a signature. Both variants keep the bottom of the frame
// clear of content, so nothing ever sits under it.
function drawWatermark(ctx: CanvasRenderingContext2D): void {
  drawSearchLockup(ctx, { cx: W / 2, cy: H - 34, h: 34, alpha: 0.88 });
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

// The sweep. Faster than it was: at 1.15s a pass it reads as a progress bar
// crawling down a face, and the whole beat is over in 1.35s — so the viewer saw
// roughly one lap and never got the sense of something being scanned. At 0.72
// the same beat carries nearly two full passes and the motion registers.
const SCAN_PERIOD = 0.72;

function drawScanLine(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, t: number): void {
  const local = (t % SCAN_PERIOD) / SCAN_PERIOD;
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

// The scan: a MESH, not a scatter of dots.
//
// This drew every other landmark as a 2.6px white dot, which is 234 unconnected
// specks on a face. It reads as confetti, and — the part that actually costs
// something — it is the ONE frame in the export that is supposed to say "this
// is measuring you". The interactive product has drawn a proper tesselated mesh
// since the beginning (see overlay.ts strokeMesh); the exported video, which is
// the version thousands of people see, was the odd one out with the cheap
// version of the same idea.
//
// Same tesselation the app uses, so the two cannot look like different
// products. The dots stay, smaller and dimmer, sitting on the vertices — a mesh
// with no points reads as a net thrown over a face, and the points are what
// make it read as measurement.
//
// Revealed BY POSITION rather than by index. Walking the landmark array in
// order fills in whatever arbitrary sequence MediaPipe happens to store its
// points in, which looks like a loading bar; revealing top-to-bottom makes the
// mesh assemble down the face and lets it follow the scan line that is drawing
// it.
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
  // How opaque the whole mesh is. SEPARATE from progress, which is how far down
  // the face it has been drawn. Folding the two together — which the old
  // scatter did, since fewer dots read as fainter — makes the mesh RETREAT back
  // up the face as the frame settles instead of fading off it.
  alpha = 1,
): void {
  if (!landmarks.length || alpha <= 0) return;
  const project = (p: NormalizedLandmark) => ({
    x: x + ((p.x * photo.width - crop.x) / crop.w) * w,
    y: y + ((p.y * photo.height - crop.y) / crop.h) * h,
  });

  // The reveal front, swept across the FACE rather than across the photograph.
  //
  // A front running 0 to 1 in normalised image space spends most of its travel
  // above the forehead and below the chin, because a portrait is mostly not
  // face. Measured against the landmarks' own extent, the whole of the reveal
  // is spent on the thing being revealed.
  let top = 1;
  let bottom = 0;
  for (const p of landmarks) {
    if (p.y < top) top = p.y;
    if (p.y > bottom) bottom = p.y;
  }
  const span = Math.max(1e-6, bottom - top);
  // A little past the chin at full progress, so the last row is not left
  // permanently half drawn.
  const front = top + span * progress * 1.06;
  const lit = (p: NormalizedLandmark) => p.y <= front;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Weight and alpha COPIED from overlay.ts, which draws this same tesselation
  // over real faces in the live product every day. Inventing new numbers here
  // would mean tuning a 2,600-triangle mesh against a synthetic fixture, and a
  // fixture's landmarks are not anatomical — the tesselation indices connect
  // points that are neighbours on a face and strangers on anything else, so it
  // renders as a hairball no matter what the settings are. Borrowing the values
  // that are already proven is the only honest calibration available here.
  //
  // Tinted rather than white: this is the scanning state, and the accent is
  // what the rest of the product uses to mean "the machine is working".
  ctx.strokeStyle = "rgba(143,243,224,0.20)";
  ctx.lineWidth = Math.max(0.35, w / 1600);
  ctx.beginPath();
  for (const { start, end } of FaceLandmarker.FACE_LANDMARKS_TESSELATION) {
    const a = landmarks[start];
    const b = landmarks[end];
    // Both ends have to have been reached, or edges race ahead of the front and
    // the mesh grows tendrils down the face before the points arrive.
    if (!a || !b || !lit(a) || !lit(b)) continue;
    const pa = project(a);
    const pb = project(b);
    if (pa.x < x || pa.x > x + w || pb.x < x || pb.x > x + w) continue;
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
  }
  ctx.stroke();

  // The vertices, on top. Every other one — all 468 at this size is noise, and
  // the mesh already carries the structure.
  ctx.fillStyle = "rgba(255,255,255,0.62)";
  const r = Math.max(0.8, w / 520);
  for (let i = 0; i < landmarks.length; i += 2) {
    const p = landmarks[i];
    if (!p || !lit(p)) continue;
    const q = project(p);
    if (q.x < x || q.x > x + w || q.y < y || q.y > y + h) continue;
    ctx.beginPath();
    ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
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

// The constellation: the measurement graph drawn as a star map.
//
// NOT the dot-confetti the mesh replaced — that was 234 arbitrary specks with
// no structure. This is ~40 points the measuring actually uses (pupils, canthi,
// brows, nasal base, lip corners, gonions, the midline chain), joined by the
// segments the product genuinely measures between them: the bizygomatic width,
// the intercanthal line, the mandible run, the midline. A sparse, deliberate
// graph over a face reads as "these exact points matter", which is a different
// sentence from the tesselation's "everything is being captured" — so the
// breakdown cut keeps the mesh (it explains the product) and the verdict cut
// gets the constellation (it delivers a judgement).
//
// Points ignite in list order with a brief flare; a line lights only once both
// of its stars exist. Pure function of progress — no clock, no randomness.
const CONSTELLATION_POINTS = [
  10, 168, 1, 2, 13, 17, 152, // the midline chain, forehead to chin
  33, 133, 362, 263, // eye corners
  468, 473, // pupils
  70, 105, 107, 336, 334, 300, // brows
  98, 327, // nasal base
  61, 291, 0, // lip corners and cupid's bow
  234, 454, // bizygomatic
  172, 136, 149, 148, 377, 378, 365, 397, // mandible run
  50, 280, // cheek mass
  199, // under-chin
];
const CONSTELLATION_LINES: Array<[number, number]> = [
  [10, 168], [168, 1], [1, 2], [2, 13], [13, 17], [17, 152], // midline
  [33, 133], [362, 263], [133, 362], // eyes and the intercanthal bridge
  [70, 105], [105, 107], [336, 334], [334, 300], // brows
  [234, 454], // bizygomatic width
  [98, 327], // nasal base
  [61, 0], [0, 291], // lips
  [234, 172], [172, 136], [136, 149], [149, 148], [148, 152], // left mandible
  [454, 397], [397, 365], [365, 378], [378, 377], [377, 152], // right mandible
  [50, 234], [280, 454], // cheeks out to the arch
  [468, 133], [473, 362], // pupils to inner canthi
];

function drawConstellation(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  photo: HTMLCanvasElement,
  crop: Crop,
  x: number,
  y: number,
  w: number,
  h: number,
  progress: number,
  alpha = 1,
): void {
  if (!landmarks.length || alpha <= 0 || progress <= 0) return;
  const project = (p: NormalizedLandmark) => ({
    x: x + ((p.x * photo.width - crop.x) / crop.w) * w,
    y: y + ((p.y * photo.height - crop.y) / crop.h) * h,
  });
  // How far through its own ignition each star is: staggered down the list,
  // each taking a fixed slice of the reveal to flare and settle.
  const n = CONSTELLATION_POINTS.length;
  const lit = (i: number) => clamp01((progress * (n + 6) - i) / 6);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";

  // Lines first, under the stars. A line exists at the strength of its
  // dimmer endpoint, so the graph assembles joint by joint.
  ctx.strokeStyle = "rgba(143,243,224,0.55)";
  ctx.lineWidth = Math.max(0.8, w / 780);
  for (const [a, b] of CONSTELLATION_LINES) {
    const ia = CONSTELLATION_POINTS.indexOf(a);
    const ib = CONSTELLATION_POINTS.indexOf(b);
    const la = landmarks[a];
    const lb = landmarks[b];
    if (!la || !lb) continue;
    const strength = Math.min(lit(ia), lit(ib));
    if (strength <= 0) continue;
    const pa = project(la);
    const pb = project(lb);
    ctx.globalAlpha = alpha * 0.9 * strength;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    // Drawn tip-out from the first star rather than popping whole.
    ctx.lineTo(pa.x + (pb.x - pa.x) * strength, pa.y + (pb.y - pa.y) * strength);
    ctx.stroke();
  }

  // The stars: a flare that overshoots and settles, so each point ARRIVES
  // rather than fades in. Refined iris points may be absent on some models;
  // any missing index is simply skipped.
  for (let i = 0; i < n; i++) {
    const p = landmarks[CONSTELLATION_POINTS[i]];
    if (!p) continue;
    const s = lit(i);
    if (s <= 0) continue;
    const { x: sx, y: sy } = project(p);
    const flare = s < 1 ? 1 + (1 - s) * 1.8 : 1;
    const r = Math.max(1.6, w / 320) * flare;
    ctx.globalAlpha = alpha * s;
    ctx.fillStyle = "rgba(143,243,224,0.28)";
    ctx.beginPath();
    ctx.arc(sx, sy, r * 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#c9fff2";
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// The Dual-View cut: both photographs, both scans, one number.
//
// Front and side are shown side by side, scanned together — constellation on
// the front, the real side constructions on the profile — and then each view's
// own score appears under its pane and the two visibly combine into the merged
// figure. That combination is the honest content of this cut: the numbers are
// the merged report's own view scores and overall, produced by mergeReports
// and already printed by the in-app header. This renderer draws them; it
// derives nothing.
//
// Only reachable from Calibrate, because that is the one flow where both
// views were genuinely captured and the side's 13 points were confirmed by a
// person rather than trusted from the seeder.
// ---------------------------------------------------------------------------

// Reused across frames: drawSideMeasurement repaints it from scratch anyway,
// and allocating a photo-sized canvas thirty times a second is pure GC load.
let dualScratch: HTMLCanvasElement | null = null;

// Where the profile sits in its photograph, from the 13 confirmed points —
// the side has no landmarker mesh, but the points ARE the face's extent.
// Same containment discipline as faceCrop: fit the aspect, clamp to the photo.
function sideCrop(photo: HTMLCanvasElement, points: SidePoints, aspect: number): Crop {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of Object.values(points)) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: photo.width, h: photo.height };
  const bw = Math.max(1, x1 - x0);
  const bh = Math.max(1, y1 - y0);
  // The points span roughly trichion to menton — most of the head — so the
  // crop needs modest air: ~62% of its height is points, and never so tight
  // sideways that the nose meets the edge.
  let sh = bh / 0.62;
  let sw = sh * aspect;
  if (sw < bw * 1.45) { sw = bw * 1.45; sh = sw / aspect; }
  if (sw > photo.width) { sw = photo.width; sh = sw / aspect; }
  if (sh > photo.height) { sh = photo.height; sw = sh * aspect; }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return {
    x: Math.max(0, Math.min(photo.width - sw, cx - sw / 2)),
    y: Math.max(0, Math.min(photo.height - sh, cy - sh * 0.5)),
    w: sw,
    h: sh,
  };
}

function drawDualFrame(
  ctx: CanvasRenderingContext2D,
  photo: HTMLCanvasElement,
  landmarks: NormalizedLandmark[],
  scores: QuickExportScores,
  t: number,
  dual: DualViewAssets,
): void {
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
  ctx.fillText("DUAL-VIEW ANALYSIS", W - 48, 57);
  ctx.textAlign = "left";
  ctx.letterSpacing = "0px";

  // The two panes, settling in together.
  const entrance = smoother(clamp01(t / 0.45));
  const margin = 24;
  const gap = 16;
  const paneW = (W - margin * 2 - gap) / 2;
  const paneH = 620;
  const py = 92 + (1 - entrance) * 14;
  const fx = margin;
  const sx = margin + paneW + gap;
  const aspect = paneW / paneH;

  const fCrop = faceCrop(photo, landmarks, aspect, 0.8);
  const sCrop = sideCrop(dual.sidePhoto, dual.sidePoints, aspect);

  ctx.save();
  ctx.globalAlpha = entrance;
  roundedImage(ctx, photo, fCrop, fx, py, paneW, paneH, 26);
  roundedImage(ctx, dual.sidePhoto, sCrop, sx, py, paneW, paneH, 26);

  // The scan. One sweep over both panes at once — it is one measurement of
  // one person, and two independent lines would read as two products.
  if (t < 1.5) {
    drawScanLine(ctx, fx, py, paneW, paneH, t);
    drawScanLine(ctx, sx, py, paneW, paneH, t);
  }

  // The constructions, fading off together once the numbers take over.
  const overlayAlpha = 1 - smoother(clamp01((t - 2.9) / 0.5));
  if (overlayAlpha > 0) {
    const reveal = clamp01((t - 0.55) / 1.5);
    if (reveal > 0) drawConstellation(ctx, landmarks, photo, fCrop, fx, py, paneW, paneH, reveal, overlayAlpha);

    // The side's real constructions, in sequence, exactly as the measure pass
    // draws them — rendered at photo resolution and carried through the same
    // crop as the photograph so they land on the anatomy.
    if (dual.sideMetrics.length && t >= 0.55) {
      const scr = dualScratch ?? (dualScratch = document.createElement("canvas"));
      const n = dual.sideMetrics.length;
      const slice = (2.9 - 0.55) / n;
      const idx = Math.min(n - 1, Math.floor((t - 0.55) / slice));
      const local = clamp01((t - 0.55 - idx * slice) / (slice * 0.7));
      drawSideMeasurement(scr, dual.sidePoints, dual.sidePhoto.width, dual.sidePhoto.height, dual.sideMetrics[idx], local, { labels: false });
      ctx.save();
      ctx.globalAlpha = entrance * overlayAlpha;
      roundRect(ctx, sx, py, paneW, paneH, 26);
      ctx.clip();
      ctx.drawImage(scr, sCrop.x, sCrop.y, sCrop.w, sCrop.h, sx, py, paneW, paneH);
      ctx.restore();
    }
  }
  ctx.restore();

  // View labels, on from the start so the frame is legible paused anywhere.
  ctx.font = "500 13px Inter, Arial, sans-serif";
  ctx.letterSpacing = "3px";
  ctx.fillStyle = "#7f8682";
  ctx.textAlign = "center";
  ctx.fillText("FRONT", fx + paneW / 2, py + paneH + 34);
  ctx.fillText("SIDE", sx + paneW / 2, py + paneH + 34);

  // Each view's own score, counting up under its pane.
  const viewCount = smoother(clamp01((t - 3.1) / 0.8));
  const scoreY = py + paneH + 106;
  if (viewCount > 0) {
    ctx.globalAlpha = Math.min(1, viewCount * 2);
    ctx.font = "300 58px Fraunces, Georgia, serif";
    ctx.letterSpacing = "-1px";
    ctx.fillStyle = "#f7f7f2";
    ctx.fillText((dual.frontScore * viewCount).toFixed(1), fx + paneW / 2, scoreY);
    ctx.fillText((dual.sideScore * viewCount).toFixed(1), sx + paneW / 2, scoreY);
    ctx.globalAlpha = 1;
  }

  // The combination: two threads leave the view scores and meet where the
  // merged number lands. This is the sentence of the whole cut — two views,
  // one figure — so it is drawn rather than implied.
  const mergeY = 1020;
  const join = smoother(clamp01((t - 3.95) / 0.55));
  if (join > 0) {
    ctx.save();
    ctx.strokeStyle = "rgba(143,243,224,0.7)";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    for (const startX of [fx + paneW / 2, sx + paneW / 2]) {
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) {
        const u = (i / 24) * join;
        // A quadratic bend toward the middle, sampled so it can be drawn
        // part-way through. The threads stop clear ABOVE the label — meeting
        // on top of it made the word illegible at exactly the moment it
        // mattered.
        const qx = lerp(startX, W / 2, u * u);
        const qy = lerp(scoreY + 22, mergeY - 152, u);
        if (i === 0) ctx.moveTo(qx, qy);
        else ctx.lineTo(qx, qy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  const mergeCount = smoother(clamp01((t - 4.35) / 0.85));
  if (mergeCount > 0) {
    ctx.globalAlpha = Math.min(1, mergeCount * 2);
    ctx.font = "500 13px Inter, Arial, sans-serif";
    ctx.letterSpacing = "4px";
    ctx.fillStyle = "#747b77";
    ctx.fillText("COMBINED", W / 2, mergeY - 118);
    ctx.font = "300 108px Fraunces, Georgia, serif";
    ctx.letterSpacing = "-3px";
    ctx.fillStyle = "#8ff3e0";
    const shown = (scores.overall * mergeCount).toFixed(1);
    ctx.fillText(shown, W / 2, mergeY);
    ctx.font = "500 19px Inter, Arial, sans-serif";
    ctx.letterSpacing = "0px";
    ctx.fillStyle = "#0c876f";
    ctx.fillText(rankShort(scores.percentile), W / 2, mergeY + 40);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = "left";

  // The scale under the claim, same honesty as the verdict cut.
  const barAlpha = smoother(clamp01((t - 5.3) / 0.5));
  if (barAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = barAlpha;
    const barY = mergeY + 88;
    ctx.fillStyle = "#222725";
    ctx.fillRect(margin, barY, W - margin * 2, 4);
    ctx.fillStyle = "#0c876f";
    ctx.fillRect(margin, barY, (W - margin * 2) * clamp01(scores.percentile / 100) * smoother(clamp01((t - 5.4) / 0.7)), 4);
    ctx.restore();
  }
}

function drawVerdictFrame(
  ctx: CanvasRenderingContext2D,
  photo: HTMLCanvasElement,
  landmarks: NormalizedLandmark[],
  sex: Sex,
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
    // The constellation rather than the mesh — see drawConstellation for why
    // the two cuts scan differently on purpose.
    const reveal = clamp01((t - 0.7) / 0.9);
    if (reveal > 0) drawConstellation(ctx, landmarks, photo, crop, px, py, pw, ph, reveal, 1 - settle);
  }

  // Sex and tone both threaded in rather than defaulted.
  //
  // This was verdictForPercentile(scores.percentile) — no sex, so every woman
  // measured got the men's word on the one frame this cut exists to deliver,
  // and no tone, so the file said "Mogger" while the page behind it said
  // "Great-looking". Both were available at the call site the whole time.
  const verdict = verdictForPercentile(scores.percentile, sex, loadVerdictTone() ?? DEFAULT_VERDICT_TONE);
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
