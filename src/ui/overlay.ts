import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { FaceLandmarker } from "@mediapipe/tasks-vision";

// Landmark overlay: animated reveal during the scan beat, then a calm dim
// state; region tabs re-light their own landmarks.

const DOT = "rgba(255, 255, 255, 0.92)";
const DOT_IRIS = "rgba(143, 243, 224, 0.95)";
const DOT_DIM = "rgba(255, 255, 255, 0.30)";
const DOT_HI = "#8FF3E0";
const MESH = "rgba(255, 255, 255, 0.16)";
const MESH_DIM = "rgba(255, 255, 255, 0.07)";

const REVEAL_MS = 1400;

export interface OverlayHandle {
  cancel(): void;
  done: Promise<void>;
}

export function drawLandmarksAnimated(
  canvas: HTMLCanvasElement,
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
): OverlayHandle {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const order = landmarks
    .map((_, i) => i)
    .sort((a, b) => ((a * 2654435761) % 977) - ((b * 2654435761) % 977));
  const dotR = Math.max(1.2, width / 480);

  let raf = 0;
  let start = 0;
  let resolveDone: () => void;
  const done = new Promise<void>((r) => (resolveDone = r));

  const frame = (now: number) => {
    if (!start) start = now;
    const t = Math.min(1, (now - start) / REVEAL_MS);
    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = MESH;
    ctx.globalAlpha = easeOut(t);
    strokeMesh(ctx, landmarks, width, height);
    ctx.globalAlpha = 1;

    const n = Math.floor(easeOut(t) * order.length);
    for (let i = 0; i < n; i++) {
      const idx = order[i];
      dot(ctx, landmarks[idx], width, height, idx >= 468 ? dotR * 1.6 : dotR, idx >= 468 ? DOT_IRIS : DOT);
    }

    if (t < 1) raf = requestAnimationFrame(frame);
    else resolveDone();
  };
  raf = requestAnimationFrame(frame);

  return {
    cancel() {
      cancelAnimationFrame(raf);
      resolveDone();
    },
    done,
  };
}

// Calm state, optionally with a highlighted region's landmarks.
export function drawCalm(
  canvas: HTMLCanvasElement,
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
  highlight?: number[],
): void {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const dotR = Math.max(1.1, width / 520);
  ctx.clearRect(0, 0, width, height);

  ctx.strokeStyle = MESH_DIM;
  strokeMesh(ctx, landmarks, width, height);

  const hi = new Set(highlight ?? []);
  for (let i = 0; i < landmarks.length; i++) {
    if (hi.has(i)) continue;
    dot(ctx, landmarks[i], width, height, dotR * 0.85, DOT_DIM);
  }
  for (const i of hi) {
    const lm = landmarks[i];
    if (!lm) continue;
    const r = dotR * 1.7;
    ctx.shadowColor = DOT_HI;
    ctx.shadowBlur = 6;
    dot(ctx, lm, width, height, r, DOT_HI);
    ctx.shadowBlur = 0;
  }
}

function strokeMesh(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
): void {
  ctx.lineWidth = Math.max(0.4, width / 1600);
  ctx.beginPath();
  for (const { start, end } of FaceLandmarker.FACE_LANDMARKS_TESSELATION) {
    const a = landmarks[start];
    const b = landmarks[end];
    ctx.moveTo(a.x * width, a.y * height);
    ctx.lineTo(b.x * width, b.y * height);
  }
  ctx.stroke();
}

function dot(
  ctx: CanvasRenderingContext2D,
  lm: NormalizedLandmark,
  width: number,
  height: number,
  r: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(lm.x * width, lm.y * height, r, 0, Math.PI * 2);
  ctx.fill();
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
