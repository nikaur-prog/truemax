import { detectVideo, setRunningMode } from "../engine/landmarker.ts";
import { checkFrame, frameStats } from "../engine/captureGuide.ts";
import { FaceLandmarker } from "@mediapipe/tasks-vision";
import type { FrameCheck } from "../engine/captureGuide.ts";

// Live camera capture. The preview starts on the landing screen so the first
// thing someone sees is their own face already being tracked — the guidance is
// the product demo, before they have committed to anything.

export interface CameraHandle {
  stop(): void;
  capture(): HTMLCanvasElement | null;
}

interface Opts {
  video: HTMLVideoElement;
  guideCanvas: HTMLCanvasElement;
  onCheck: (c: FrameCheck) => void;
}

let stream: MediaStream | null = null;
let raf = 0;
let scratch: HTMLCanvasElement | null = null;

export function isSupported(): boolean {
  return !!navigator.mediaDevices?.getUserMedia;
}

// Has the user already granted camera access? Lets the landing screen start a
// preview silently for returning visitors instead of prompting again.
export async function permissionGranted(): Promise<boolean> {
  try {
    const status = await navigator.permissions?.query({ name: "camera" as PermissionName });
    return status?.state === "granted";
  } catch {
    return false;
  }
}

export async function startCamera(opts: Opts): Promise<CameraHandle> {
  stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user",
      width: { ideal: 1280 },
      height: { ideal: 1280 },
    },
    audio: false,
  });
  opts.video.srcObject = stream;
  opts.video.muted = true;
  opts.video.playsInline = true;
  await opts.video.play();
  await setRunningMode("VIDEO");

  scratch = scratch ?? document.createElement("canvas");
  let last = -1;

  const loop = () => {
    const v = opts.video;
    if (v.readyState >= 2 && v.currentTime !== last) {
      last = v.currentTime;
      const ts = performance.now();
      let result = null;
      try {
        result = detectVideo(v, ts);
      } catch {
        /* mode switch in flight — skip this frame */
      }
      // Measure exposure and focus on the face itself — a bright wall or a
      // busy background otherwise decides whether the shot is "sharp".
      const box = faceBox(result);
      const stats = frameStats(v, scratch!, box);
      const check = checkFrame(result, stats);
      opts.onCheck(check);
      drawGuide(opts.guideCanvas, result, check);
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return {
    stop() {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      opts.video.srcObject = null;
      const ctx = opts.guideCanvas.getContext("2d");
      ctx?.clearRect(0, 0, opts.guideCanvas.width, opts.guideCanvas.height);
    },
    capture() {
      const v = opts.video;
      if (!v.videoWidth) return null;
      const c = document.createElement("canvas");
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      const ctx = c.getContext("2d")!;
      // Un-mirror: the preview is flipped so it behaves like a mirror, but the
      // captured frame must be the true orientation or left/right metrics
      // (and any text in shot) come out reversed.
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(v, 0, 0);
      return c;
    },
  };
}

function faceBox(result: ReturnType<typeof detectVideo>) {
  const lm = result?.faceLandmarks?.[0];
  if (!lm) return undefined;
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
  for (const p of lm) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, w: Math.max(0.05, x1 - x0), h: Math.max(0.05, y1 - y0) };
}

// Live overlay: trace the face's OUTLINE — oval, brows, eyes, nose, lips —
// rather than sprinkling interior mesh points. The dense mesh reads as a blob
// stuck to the middle of the face and gives no sense that tracking is
// following you; the contours visibly move with your features.
let CONTOURS: Array<{ start: number; end: number }> | null = null;
function contours() {
  return (CONTOURS ??= [
    ...FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
    ...FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
    ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
    ...FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW,
    ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
    ...FaceLandmarker.FACE_LANDMARKS_LIPS,
  ]);
}
const NOSE_LINES: Array<[number, number]> = [
  [168, 6], [6, 197], [197, 195], [195, 5], [5, 4], [4, 1],
  [1, 98], [1, 327], [98, 2], [327, 2], [48, 98], [278, 327],
];

function drawGuide(
  canvas: HTMLCanvasElement,
  result: ReturnType<typeof detectVideo>,
  check: FrameCheck,
): void {
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const lm = result?.faceLandmarks?.[0];
  if (!lm) return;

  const colour =
    check.status === "green" ? "143,243,224" : check.status === "amber" ? "255,201,139" : "255,255,255";

  ctx.strokeStyle = `rgba(${colour},0.9)`;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = "round";
  ctx.shadowColor = `rgba(${colour},0.55)`;
  ctx.shadowBlur = 6;
  ctx.beginPath();
  for (const c of contours()) {
    const a = lm[c.start];
    const b = lm[c.end];
    ctx.moveTo(a.x * w, a.y * h);
    ctx.lineTo(b.x * w, b.y * h);
  }
  for (const [a, b] of NOSE_LINES) {
    if (!lm[a] || !lm[b]) continue;
    ctx.moveTo(lm[a].x * w, lm[a].y * h);
    ctx.lineTo(lm[b].x * w, lm[b].y * h);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Vertices on the contour only, so the tracking reads as points on features
  ctx.fillStyle = `rgba(${colour},0.95)`;
  const seen = new Set<number>();
  for (const c of contours()) {
    if (seen.has(c.start)) continue;
    seen.add(c.start);
    const p = lm[c.start];
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, 1.7, 0, Math.PI * 2);
    ctx.fill();
  }
}
