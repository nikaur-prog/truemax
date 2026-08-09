import { detectVideo, setRunningMode } from "../engine/landmarker.ts";
import { checkFrame, frameStats } from "../engine/captureGuide.ts";
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
      const stats = frameStats(v, scratch!);
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

// Light-touch live overlay: landmark dots so the tracking is visibly working,
// tinted by whether the frame is currently acceptable.
function drawGuide(
  canvas: HTMLCanvasElement,
  result: ReturnType<typeof detectVideo>,
  check: FrameCheck,
): void {
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  if (!result?.faceLandmarks.length) return;

  const lm = result.faceLandmarks[0];
  ctx.fillStyle = check.ready ? "rgba(143,243,224,0.95)" : "rgba(255,255,255,0.5)";
  const r = Math.max(0.9, w / 260);
  // Every 3rd point: dense enough to read as a mesh, cheap enough for 30fps
  for (let i = 0; i < lm.length; i += 3) {
    const p = lm[i];
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, r, 0, Math.PI * 2);
    ctx.fill();
  }
}
