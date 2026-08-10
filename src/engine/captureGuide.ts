import type { FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { assessQuality } from "./quality.ts";
import { estimateGaze } from "./gaze.ts";
import type { Gaze } from "./gaze.ts";

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
  // Where the eyes are pointed, for the on-face crosshair. Null when the
  // irises aren't tracked (blinks, heavy occlusion).
  gaze: Gaze | null;
  // Head angles in degrees, so the overlay can point in the direction someone
  // is actually facing rather than only naming it in the hint text.
  pose: { yaw: number; pitch: number; roll: number };
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
    gaze: boolean;
  };
}

// Face width as a fraction of the VISIBLE frame width. Exported because the
// capture guide draws its silhouette at the midpoint of this band — the target
// someone lines up against and the gate that judges them have to be the same
// number, or fitting the outline and being told "move closer" happen at once.
export const TARGET_MIN = 0.3;
export const TARGET_MAX = 0.62;

// How much of the camera frame the preview actually shows.
//
// The preview is `object-fit: cover`, so a camera whose aspect ratio differs
// from the frame's gets centre-cropped — and on a 16:9 webcam in a square frame
// that throws away nearly half the width. Landmarks arrive normalized to the
// FULL video, so measuring face width against that was measuring against pixels
// the user cannot see: a face filling 90% of the visible frame reads as 0.25 of
// the video and gets told "move closer", forever.
//
// Everything positional below is therefore divided through by these, which
// converts video-normalized coordinates into visible-frame ones. Cover crops
// symmetrically about the centre, so the centre maps to the centre and only the
// scale changes.
export interface Viewport {
  visW: number; // 0..1 — fraction of video width on screen
  visH: number;
}
const FULL_VIEW: Viewport = { visW: 1, visH: 1 };
const YAW_OK = 10;
const PITCH_OK = 10;
const ROLL_OK = 7;
const SMILE_OK = 0.35;
const DARK = 42; // mean luma, 0-255
const BRIGHT = 232;
// Sharpness. Measured on the FACE CROP, not the whole scene.
//
// This used to be the mean absolute Laplacian of the crop, gated at 9. That
// number is proportional to local CONTRAST as well as to focus, so it could not
// tell a dim room from a dirty lens. Measured over 20 portraits, degraded
// synthetically (tools sit in the scratchpad; the numbers are in CALIBRATION.md):
//
//   condition                     old metric (gate was 9)
//   in focus, well lit                  17.5
//   in focus, dim                       12.1
//   in focus, very dim                   7.6   <- BLOCKED, and nothing is wrong
//   genuinely 3px blurred                9.4   <- PASSED
//
// It ranked a perfectly focused face in a dim room BELOW a genuinely blurred
// one in a bright room. Anyone scanning in normal indoor evening light was
// told to wipe their lens and had the shutter held shut.
//
// The replacement asks a question that has no brightness term in it: blur the
// crop AGAIN, and see how much that changes it. An already-soft image barely
// changes; a sharp one changes a lot. Taking the ratio cancels contrast and
// exposure exactly — measured, `dim` and `very dim` both score 0.503, and
// `blurred` and `blurred+dim` both score 0.244.
//
//   in focus (any exposure)         0.40 – 0.54
//   1.5px blur                      0.37
//   3px blur                        0.24
//   6px blur                        0.13
//
// Two thresholds, because the old one-threshold design is what stranded people.
// Below WARN we say so; only below BLOCK do we hold the shutter. A slightly
// soft frame costs a little measurement precision — landmark positions barely
// move under blur (median shift 0.1% of face width even at 6px) — so refusing
// to take the photo at all was never proportionate to the harm.
const SHARP_WARN = 0.28;
const SHARP_BLOCK = 0.17;
// Iris offset inside its own eye opening: 0 = down the lens, 1 = at the corner.
//
// Calibrated against 216 real portraits (tools/gaze-calibrate.mjs): median
// 0.088, p90 0.235. The tail is people genuinely looking off-lens, so 0.22
// flags a real look-away without failing ordinary press-photo eye contact.
//
// Deliberately NOT a shutter block. The eyeball turns ~0.14 of this scale per
// 10° of head yaw, which is inside the yaw the pose gate already permits, so a
// tighter threshold would fire on people who are looking straight at the lens
// with their head very slightly turned. The measure catches a genuine
// look-away; it cannot resolve "screen instead of lens" at arm's length, and
// gating the shutter on a number that imprecise would just strand people.
const GAZE_OK = 0.22;

export interface FrameStats {
  luma: number;
  // 0..1. Higher is sharper. Brightness- and contrast-invariant by
  // construction: it is a ratio of the same quantity measured twice.
  sharpness: number;
}

// Sample the face region for exposure and focus. Deliberately cheap: a small
// downscale, then two passes of mean neighbour difference — enough to catch a
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

  // Mean absolute neighbour difference, before and after a 3x3 box blur. The
  // fraction that blurring destroys IS the focus measure: a sharp image loses
  // a lot of neighbour difference, an already-soft one has little left to lose.
  const d0 = meanNeighbourDiff(lum, W, H);
  const d1 = meanNeighbourDiff(boxBlur3(lum, W, H), W, H);
  const sharpness = d0 <= 1e-6 ? 0 : Math.max(0, (d0 - d1) / d0);
  return { luma, sharpness };
}

function meanNeighbourDiff(lum: Float32Array, W: number, H: number): number {
  let s = 0;
  let n = 0;
  for (let y = 1; y < H; y++) {
    for (let x = 1; x < W; x++) {
      const p = y * W + x;
      s += Math.abs(lum[p] - lum[p - 1]) + Math.abs(lum[p] - lum[p - W]);
      n += 2;
    }
  }
  return s / Math.max(1, n);
}

// Separable 3-tap box blur, edges clamped.
function boxBlur3(lum: Float32Array, W: number, H: number): Float32Array {
  const t = new Float32Array(W * H);
  const o = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      t[p] = (lum[p - (x > 0 ? 1 : 0)] + lum[p] + lum[p + (x < W - 1 ? 1 : 0)]) / 3;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      o[p] = (t[p - (y > 0 ? W : 0)] + t[p] + t[p + (y < H - 1 ? W : 0)]) / 3;
    }
  }
  return o;
}

// ---------------------------------------------------------------------------
// Side-profile capture.
//
// The front gates cannot be reused, because the thing they all depend on is
// absent: MediaPipe's face mesh needs a roughly frontal face and simply does
// not track a true profile. That absence is not a failure to work around — it
// is the most reliable signal available here, so it is used directly.
//
// If the frontal detector CAN see a face and it is anywhere near square on,
// the person is not in profile yet. If it loses the face, or holds it at a
// steep yaw, they have turned far enough. So "no detection" is the pass
// condition, which is the inverse of every other gate in this file.
//
// What cannot be checked without landmarks is framing — distance, centring,
// tilt. Rather than guess at those from pixels, the copy states them and the
// verification step afterwards is where accuracy is actually enforced: every
// point gets dragged onto its spot by hand regardless.
// ---------------------------------------------------------------------------

// Below this yaw the detector is still seeing a broadly front-on face.
const PROFILE_YAW = 42;
// Consecutive frames with no detection before that counts as "turned away".
//
// Losing the face used to pass the gate on its own and on the first frame, and
// that is what made the side view easier to shoot than the front — which is
// backwards, because the front carries most of the score. It also passed for
// every reason a detector loses a face: a hand over the lens, someone leaving
// frame, walking out of the light. Requiring the loss to persist, and to have
// been preceded by a face that was already turning, means the only way to pass
// is the one we actually want.
const LOST_FRAMES = 6;

// Recent detection history, so "the face went away" can be told apart from
// "there was never a face". Reset whenever a side capture starts.
let lostRun = 0;
let sawTurning = false;

export function resetSideTracking(): void {
  lostRun = 0;
  sawTurning = false;
}

export function checkSideFrame(
  result: FaceLandmarkerResult | null,
  stats: FrameStats,
): FrameCheck {
  const gates = {
    face: false,
    distance: true,
    centered: true,
    level: true,
    straight: true,
    light: stats.luma >= DARK && stats.luma <= BRIGHT,
    sharp: stats.sharpness >= SHARP_WARN,
    neutral: true,
    gaze: true,
  };
  const pose = { yaw: 0, pitch: 0, roll: 0 };

  const lm = result?.faceLandmarks?.[0];
  let turned = false;
  if (lm) {
    lostRun = 0;
    const q = assessQuality(result);
    pose.yaw = q.yawDeg;
    pose.pitch = q.pitchDeg;
    pose.roll = q.rollDeg;
    turned = Math.abs(q.yawDeg) >= PROFILE_YAW;
    // Half of the profile yaw is already a decisive turn, and it is the last
    // thing the detector reliably reports before it drops the face. Seeing it
    // is what licenses treating a later loss as "they kept turning".
    if (Math.abs(q.yawDeg) >= PROFILE_YAW * 0.5) sawTurning = true;
  } else {
    lostRun++;
    turned = sawTurning && lostRun >= LOST_FRAMES;
  }
  gates.face = !!lm || sawTurning;
  gates.straight = turned;

  const problems: Array<{ over: number; hint: string; detail: string }> = [];
  const add = (over: number, hint: string, detail: string) => {
    if (over > 0) problems.push({ over, hint, detail });
  };
  if (lm && !turned) {
    add(
      (PROFILE_YAW - Math.abs(pose.yaw)) / PROFILE_YAW,
      "Keep turning",
      "All the way to a full profile — one ear to the lens, nose in silhouette",
    );
  }
  if (!lm && !turned) {
    // No face, and no turn on record to explain it. Almost always someone who
    // has not started yet, or has stepped out of frame.
    add(1, "Face the camera first", "Start front-on, then turn until you are fully side-on");
  }
  add((DARK - stats.luma) / DARK, "Too dark", "Face a window or turn a light on");
  add((stats.luma - BRIGHT) / BRIGHT, "Too bright", "Move out of direct light");
  add(
    (SHARP_BLOCK - stats.sharpness) / SHARP_BLOCK,
    "Can't focus",
    "Give the lens a wipe — the image is too smeared to measure",
  );

  if (!problems.length) {
    return {
      ready: true,
      hint: "Hold still",
      detail: "Full profile — chin, nose and brow all in silhouette",
      status: "green",
      progress: 1,
      gaze: null,
      pose,
      gates,
    };
  }
  problems.sort((a, b) => b.over - a.over);
  const worst = problems[0];
  const progress = Math.max(0, Math.min(1, 1 - worst.over));
  return {
    ready: false,
    hint: worst.hint,
    detail: worst.detail,
    status: progress >= 0.5 ? "amber" : "red",
    progress,
    gaze: null,
    pose,
    gates,
  };
}

export function checkFrame(
  result: FaceLandmarkerResult | null,
  stats: FrameStats,
  view: Viewport = FULL_VIEW,
  // Last verdict from the glasses measure, which runs on its own slower clock
  // because it costs a canvas readback. "advise" only says so; "block" holds
  // the shutter, and the UI must offer a way past it — see occlusion.ts.
  glasses: { advise: boolean; block: boolean } = { advise: false, block: false },
): FrameCheck {
  const gates = {
    face: false,
    distance: false,
    centered: false,
    level: false,
    straight: false,
    light: false,
    sharp: false,
    neutral: false,
    gaze: false,
  };

  if (!result?.faceLandmarks.length) {
    return {
      ready: false,
      hint: "Center your face in the frame",
      detail: "Looking for a face…",
      status: "red",
      progress: 0,
      gaze: null,
      pose: { yaw: 0, pitch: 0, roll: 0 },
      gates,
    };
  }
  gates.face = true;

  const q = assessQuality(result);
  const pose = { yaw: q.yawDeg, pitch: q.pitchDeg, roll: q.rollDeg };
  const lm = result.faceLandmarks[0];
  const gaze = estimateGaze(lm);
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
  // Converted out of video-normalized space and into visible-frame space, so
  // every number below means what someone looking at the preview would say it
  // means.
  const w = (maxX - minX) / view.visW;
  const cxOff = ((minX + maxX) / 2 - 0.5) / view.visW;
  const cyOff = ((minY + maxY) / 2 - 0.5) / view.visH;

  gates.distance = w >= TARGET_MIN && w <= TARGET_MAX;
  gates.centered = Math.abs(cxOff) < 0.1 && Math.abs(cyOff) < 0.12;
  gates.level = Math.abs(q.pitchDeg) <= PITCH_OK;
  gates.straight = Math.abs(q.yawDeg) <= YAW_OK && Math.abs(q.rollDeg) <= ROLL_OK;
  gates.light = stats.luma >= DARK && stats.luma <= BRIGHT;
  gates.sharp = stats.sharpness >= SHARP_WARN;
  gates.neutral = q.smileScore <= SMILE_OK;
  // A blink loses the irises for a frame or two. Holding the last verdict
  // instead of failing keeps the light from flickering on every blink.
  gates.gaze = gaze ? gaze.offset <= GAZE_OK : true;

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
  // Only genuine smear holds the shutter. Merely-soft is handled below, after
  // the blocking problems, so a dim room never strands anyone.
  add(
    (SHARP_BLOCK - stats.sharpness) / SHARP_BLOCK,
    "Can't focus on your face",
    "Give the lens a wipe — the image is too smeared to measure",
  );
  add((q.smileScore - SMILE_OK) / SMILE_OK, "Relax your expression", "A smile shifts mouth and jaw measurements");
  // A blocking problem like any other, so it sorts against the rest by how far
  // off it is rather than jumping the queue: someone in glasses who is also
  // badly framed should be told about the framing first, because they have to
  // fix that anyway.
  if (glasses.block) {
    add(1.05, "Take your glasses off", "Frames sit across the eye and brow measurements");
  }

  if (!problems.length) {
    // Framing is correct, so the shutter opens either way. Two things can still
    // be worth saying while there is a chance to fix them — neither blocks,
    // because neither is bad enough to justify refusing to take the photo.
    const advisory = glasses.advise
      ? {
          hint: "Glasses off, if you have them on",
          detail: "Frames sit right across the eye and brow measurements",
        }
      : !gates.sharp
        ? { hint: "A bit soft", detail: "More light on your face will sharpen it — you can still shoot" }
        : !gates.gaze
          ? { hint: "Look at the lens", detail: "Framing is good — your eyes are off to one side" }
          : null;
    return advisory
      ? { ready: true, ...advisory, status: "amber", progress: 1, gaze, pose, gates }
      : { ready: true, hint: "Hold still", detail: "Everything checks out", status: "green", progress: 1, gaze, pose, gates };
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
    gaze,
    pose,
    gates,
  };
}
