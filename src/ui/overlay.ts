import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { FaceLandmarker } from "@mediapipe/tasks-vision";

// Progressive landmark reveal: mesh tessellation fades in as faint lines,
// dots pop in in randomized-but-seeded order, a scan line sweeps down.
// This is the "analyzing" theatre foundation; timing tuned to ~1.8s total.

const DOT_COLOR = "rgba(255, 255, 255, 0.92)";
const DOT_COLOR_IRIS = "rgba(140, 255, 190, 0.95)";
const MESH_COLOR = "rgba(255, 255, 255, 0.16)";
const SCAN_COLOR = "rgba(140, 255, 190, 0.85)";

const REVEAL_MS = 1400;
const SCAN_MS = 1800;

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

  // Deterministic pseudo-shuffle of dot reveal order (seeded, no Math.random)
  const order = landmarks.map((_, i) => i).sort((a, b) => ((a * 2654435761) % 977) - ((b * 2654435761) % 977));

  const tess = FaceLandmarker.FACE_LANDMARKS_TESSELATION;
  const dotRadius = Math.max(1.2, width / 480);

  let raf = 0;
  let start = 0;
  let resolveDone: () => void;
  const done = new Promise<void>((r) => (resolveDone = r));

  const frame = (now: number) => {
    if (!start) start = now;
    const t = now - start;
    ctx.clearRect(0, 0, width, height);

    const revealFrac = Math.min(1, t / REVEAL_MS);

    // Mesh lines fade in behind the dots
    ctx.strokeStyle = MESH_COLOR;
    ctx.globalAlpha = easeOut(revealFrac);
    ctx.lineWidth = Math.max(0.4, width / 1600);
    ctx.beginPath();
    for (const { start: s, end: e } of tess) {
      const a = landmarks[s];
      const b = landmarks[e];
      ctx.moveTo(a.x * width, a.y * height);
      ctx.lineTo(b.x * width, b.y * height);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Dots pop in progressively
    const visibleCount = Math.floor(easeOut(revealFrac) * order.length);
    for (let i = 0; i < visibleCount; i++) {
      const idx = order[i];
      const lm = landmarks[idx];
      ctx.fillStyle = idx >= 468 ? DOT_COLOR_IRIS : DOT_COLOR;
      ctx.beginPath();
      ctx.arc(lm.x * width, lm.y * height, idx >= 468 ? dotRadius * 1.6 : dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Scan line sweeps down over the face bounding box
    if (t < SCAN_MS) {
      const ys = landmarks.map((l) => l.y * height);
      const minY = Math.min(...ys) - 10;
      const maxY = Math.max(...ys) + 10;
      const scanY = minY + (maxY - minY) * easeInOut(Math.min(1, t / SCAN_MS));
      const grad = ctx.createLinearGradient(0, scanY - 24, 0, scanY + 2);
      grad.addColorStop(0, "rgba(140, 255, 190, 0)");
      grad.addColorStop(1, SCAN_COLOR);
      ctx.fillStyle = grad;
      ctx.fillRect(0, scanY - 24, width, 26);
      raf = requestAnimationFrame(frame);
    } else if (revealFrac < 1) {
      raf = requestAnimationFrame(frame);
    } else {
      drawStatic(ctx, landmarks, width, height, dotRadius);
      resolveDone();
    }
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

function drawStatic(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
  dotRadius: number,
): void {
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = MESH_COLOR;
  ctx.lineWidth = Math.max(0.4, width / 1600);
  ctx.beginPath();
  for (const { start, end } of FaceLandmarker.FACE_LANDMARKS_TESSELATION) {
    const a = landmarks[start];
    const b = landmarks[end];
    ctx.moveTo(a.x * width, a.y * height);
    ctx.lineTo(b.x * width, b.y * height);
  }
  ctx.stroke();
  for (let i = 0; i < landmarks.length; i++) {
    const lm = landmarks[i];
    ctx.fillStyle = i >= 468 ? DOT_COLOR_IRIS : DOT_COLOR;
    ctx.beginPath();
    ctx.arc(lm.x * width, lm.y * height, i >= 468 ? dotRadius * 1.6 : dotRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
