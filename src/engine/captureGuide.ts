import type { FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { assessQuality } from "./quality.ts";

// ---------------------------------------------------------------------------
// Live capture guidance. The scan is only as good as the photo, so instead of
// letting someone shoot a bad one and warning afterwards, coach them in real
// time and hold the shutter until the frame is actually usable.
//
// One instruction at a time, in priority order — a list of six problems is
// noise; "move closer" is an instruction.
// ---------------------------------------------------------------------------

export type CaptureStatus = "red" | "amber" | "green";

export interface FrameCheck {
  ready: boolean;
  hint: string;
  detail: string;
  // Traffic light: red when the frame is far off, amber while the user is
  // actively closing the gap, green when every check passes. Graded rather
  // than binary so movement in the right direction is visible immediately —
  // being told 'move higher' with no feedback until it snaps is frustrating.
  status: CaptureStatus;
  progress: number; // 0..1 toward fixing the current limiting problem
  // Individual gates, for the checklist UI
  gates: {
    face: boolean;
    distance: boolean;
    centered: boolean;
    level: boolean;
    straight: boolean;
    light: boolean;
    sharp: boolean;
    neutral: boolean;
  };
}

const TARGET_MIN = 0.3; // face width as a fraction of frame width
const TARGET_MAX = 0.62;
const YAW_OK = 10;
const PITCH_OK = 10;
const ROLL_OK = 7;
const SMILE_OK = 0.35;
const DARK = 42; // mean luma, 0-255
const BRIGHT = 232;
// Sharpness is measured on the FACE CROP, not the whole scene. Sampling the
// entire frame at 96px blurred everything before measuring it, so real webcam
// footage read as soft and the gate never lit. Threshold retuned for a crop.
const SHARP_MIN = 9;

export interface FrameStats {
  luma: number;
  sharpness: number;
}

// Sample the face region for exposure and focus. Deliberately cheap: a small
// downscale, then a 4-neighbour Laplacian for sharpness — enough to catch a
// dim room or a smeared lens without costing frame rate.
export function frameStats(
  video: HTMLVideoElement,
  scratch: HTMLCanvasElement,
  box?: { x: number; y: number; w: number; h: number },
): FrameStats {
  const W = 160;
  const H = 160;
  scratch.width = W;
  scratch.height = H;
  const ctx = scratch.getContext("2d", { willReadFrequently: true })!;
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;
  const sx = box ? box.x * vw : 0;
  const sy = box ? box.y * vh : 0;
  const sw = box ? Math.max(1, box.w * vw) : vw;
  const sh = box ? Math.max(1, box.h * vh) : vh;
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;

  const lum = new Float32Array(W * H);
  let sum = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    lum[p] = v;
    sum += v;
  }
  const luma = sum / (W * H);

  let lap = 0;
  let n = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      const v = Math.abs(4 * lum[p] - lum[p - 1] - lum[p + 1] - lum[p - W] - lum[p + W]);
      lap += v;
      n++;
    }
  }
  return { luma, sharpness: lap / Math.max(1, n) };
}

export function checkFrame(result: FaceLandmarkerResult | null, stats: FrameStats): FrameCheck {
  const gates = {
    face: false,
    distance: false,
    centered: false,
    level: false,
    straight: false,
    light: false,
    sharp: false,
    neutral: false,
  };

  if (!result?.faceLandmarks.length) {
    return {
      ready: false,
      hint: "Center your face in the frame",
      detail: "Looking for a face…",
      status: "red",
      progress: 0,
      gates,
    };
  }
  gates.face = true;

  const q = assessQuality(result);
  const lm = result.faceLandmarks[0];
  let minX = 1;
  let maxX = 0;
  let minY = 1;
  let maxY = 0;
  for (const p of lm) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const w = maxX - minX;
  const cxOff = (minX + maxX) / 2 - 0.5;
  const cyOff = (minY + maxY) / 2 - 0.5;

  gates.distance = w >= TARGET_MIN && w <= TARGET_MAX;
  gates.centered = Math.abs(cxOff) < 0.1 && Math.abs(cyOff) < 0.12;
  gates.level = Math.abs(q.pitchDeg) <= PITCH_OK;
  gates.straight = Math.abs(q.yawDeg) <= YAW_OK && Math.abs(q.rollDeg) <= ROLL_OK;
  gates.light = stats.luma >= DARK && stats.luma <= BRIGHT;
  gates.sharp = stats.sharpness >= SHARP_MIN;
  gates.neutral = q.smileScore <= SMILE_OK;

  // Each problem reports how far off it is, expressed as a multiple of its
  // tolerance. 0 = solved, 1 = one whole tolerance out, 2+ = badly off. That
  // is what lets the light run red → amber → green as the user moves, instead
  // of snapping at the threshold.
  interface Problem { over: number; hint: string; detail: string }
  const problems: Problem[] = [];
  const add = (over: number, hint: string, detail: string) => {
    if (over > 0) problems.push({ over, hint, detail });
  };

  add((TARGET_MIN - w) / TARGET_MIN, "Move closer", "Your face should fill most of the frame");
  add((w - TARGET_MAX) / TARGET_MAX, "Move back a little", "You're too close to the lens");
  add((Math.abs(cxOff) - 0.1) / 0.1, cxOff > 0 ? "Move left" : "Move right", "Center your face");
  add((Math.abs(cyOff) - 0.12) / 0.12, cyOff > 0 ? "Move up" : "Move down", "Center your face");
  add((DARK - stats.luma) / DARK, "Too dark", "Face a window or turn a light on");
  add((stats.luma - BRIGHT) / BRIGHT, "Too bright", "Move out of direct light");
  add((-q.pitchDeg - PITCH_OK) / PITCH_OK, "Lower the camera", "It's above your eye line, looking down");
  add((q.pitchDeg - PITCH_OK) / PITCH_OK, "Raise the camera", "It's below your eye line, looking up");
  add((Math.abs(q.yawDeg) - YAW_OK) / YAW_OK, "Face the camera directly", "Your head is turned");
  add((Math.abs(q.rollDeg) - ROLL_OK) / ROLL_OK, "Straighten your head", "It's tilted to one side");
  add((SHARP_MIN - stats.sharpness) / SHARP_MIN, "Hold still", "The image is too soft — or wipe the lens");
  add((q.smileScore - SMILE_OK) / SMILE_OK, "Relax your expression", "A smile shifts mouth and jaw measurements");

  if (!problems.length) {
    return { ready: true, hint: "Hold still", detail: "Everything checks out", status: "green", progress: 1, gates };
  }

  // Coach the worst problem; grade the light by how close it is to solved.
  problems.sort((a, b) => b.over - a.over);
  const worst = problems[0];
  const progress = Math.max(0, Math.min(1, 1 - worst.over));
  return {
    ready: false,
    hint: worst.hint,
    detail: worst.detail,
    status: progress >= 0.5 ? "amber" : "red",
    progress,
    gates,
  };
}
