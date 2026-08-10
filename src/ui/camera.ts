import { detectVideo, setRunningMode } from "../engine/landmarker.ts";
import { TARGET_MAX, TARGET_MIN, checkFrame, checkSideFrame, frameStats } from "../engine/captureGuide.ts";
import { idealShape, shapeExtent, strokeOutline } from "./faceOutline.ts";
import { detectOcclusion } from "../engine/occlusion.ts";
import type { FrameCheck, Viewport } from "../engine/captureGuide.ts";
import type { Sex } from "../engine/types.ts";

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
  // "front" runs the full landmark-driven gating. "side" cannot: the face mesh
  // does not track a true profile, so it gates on exposure, focus, and the
  // detector NOT seeing a front-on face.
  mode?: "front" | "side";
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

  const side = opts.mode === "side";
  scratch = scratch ?? document.createElement("canvas");
  let last = -1;
  let frameNo = 0;
  // The glasses measure resamples a face crop and reads it back, which is far
  // too expensive per frame and does not need to be: nobody puts glasses on
  // and takes them off between frames. Sampled every 20th frame, roughly three
  // times a second, and the last verdict is held in between.
  let glasses = { advise: false, block: false };

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
      const lm = result?.faceLandmarks?.[0];
      if (!side && lm && ++frameNo % 20 === 0) {
        try {
          const o = detectOcclusion(v, lm, v.videoWidth, v.videoHeight);
          if (o) glasses = { advise: o.glasses, block: o.glassesStrong && !glassesOverride };
        } catch {
          /* a frame mid-resize can fail the readback; keep the last verdict */
        }
      }
      const check = side
        ? checkSideFrame(result, stats)
        : checkFrame(result, stats, viewport(v, opts.guideCanvas), glasses);
      opts.onCheck(check);
      drawGuide(opts.guideCanvas, v, check, side);
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


// The preview is `object-fit: cover`, so a 4:3 camera inside a 3:4 frame is
// centre-cropped. Mapping normalized landmarks straight to canvas pixels
// assumes the two aspect ratios match; when they don't, the whole overlay
// drifts off the face. Reproduce the cover crop instead.
interface Mapper {
  (nx: number, ny: number): { x: number; y: number };
  dw: number;
  dh: number;
}

// How much of the video survives the cover crop. The gates are written against
// what the user can see, so they need this rather than the raw frame.
function viewport(video: HTMLVideoElement, canvas: HTMLCanvasElement): Viewport {
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  const P = coverMap(video, w, h);
  return {
    visW: Math.min(1, w / (P.dw || 1)),
    visH: Math.min(1, h / (P.dh || 1)),
  };
}

function coverMap(video: HTMLVideoElement, w: number, h: number): Mapper {
  const vw = video.videoWidth || w;
  const vh = video.videoHeight || h;
  const s = Math.max(w / vw, h / vh);
  const dw = vw * s;
  const dh = vh * s;
  const ox = (w - dw) / 2;
  const oy = (h - dh) / 2;
  const f = ((nx: number, ny: number) => ({ x: ox + nx * dw, y: oy + ny * dh })) as Mapper;
  f.dw = dw;
  f.dh = dh;
  return f;
}

// Neither guide reads the landmark result any more. The front one draws a fixed
// target and the side one has no landmarks to draw; everything derived from the
// detection now arrives inside `check`.
function drawGuide(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  check: FrameCheck,
  side = false,
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
  const P = coverMap(video, w, h);
  if (DEBUG) drawDebug(ctx, P, video, w, h, dpr);

  if (side) {
    drawProfileGuide(ctx, w, h, check);
    return;
  }

  drawFrontGuide(ctx, w, h, check);
}

// Which reference population's average face the front silhouette is drawn from.
//
// Set by the user's own choice, not by a vote. The camera used to classify the
// face from its shape and morph the guide to match; that classifier scores
// 58.8% on held-out faces against a 54.1% base rate (see sexPref.ts), so what
// it produced in practice was a silhouette that changed its mind about you
// while you were still lining up.
let guideSex: Sex = "male";
export function setGuideSex(sex: Sex): void {
  guideSex = sex;
}

// Someone the glasses measure is wrong about has no way to comply with "take
// your glasses off", so they can say so and the block lifts for the session.
let glassesOverride = false;
export function overrideGlasses(): void {
  glassesOverride = true;
}
export function resetGlassesOverride(): void {
  glassesOverride = false;
}

// ONE element now: the silhouette you fit your face into.
//
// What was here before was a dot cloud plus an adaptive crosshair, and both are
// gone. The crosshair anchored to the eye midpoint, which sits around a third of
// the way down a face, so its horizontal arm read as a level that was set far
// too high — people lined their face up to it and ended up framed high in the
// shot. The dots proved the tracker was alive but told you nothing about where
// to move.
//
// The side view already worked this way and was the easier of the two to shoot,
// which is backwards: the front view is the one that carries most of the score.
// A silhouette states the target directly — get inside the outline — and the
// hint line handles the rest in words. Two views, one idea.
//
// Two things were removed earlier for a reason that still holds, and the
// temptation to add them back is constant. Feature contours on the eyes, brows
// and lips went first: MediaPipe's eye ring follows the orbital rim, not the
// lid, so locked to a live face it sat visibly wide of the eye and read as
// broken tracking even while the measurements underneath were correct. The face
// outline went second: FACE_OVAL is an anatomical boundary, not the silhouette
// you see, and its lower arc follows the jaw's underside, so on anyone shot from
// slightly above it projected onto the neck.
//
// Neither objection applies to what is drawn now, and the difference is the
// point: this outline is not locked to the face. It is a fixed target sitting in
// the frame, so it cannot look like tracking that has come loose. It is also the
// same shape the gate is written against — the landmark bounding box — so fitting
// it and passing the distance check are the same act.

// ---------------------------------------------------------------------------
// Front guide: the average face of the reference population you will be scored
// against, drawn at the size and position the capture gates actually want.
//
// Sized against the canvas, because the distance gate is now written in visible
// terms too. Both were previously in video units, which under `object-fit:
// cover` means units the user cannot see: on a 16:9 webcam in a square frame
// roughly half the width is cropped away, so a face satisfying "0.46 of the
// video" is wider than the whole preview.
// ---------------------------------------------------------------------------

// Midpoint of the distance gate's accepted band, so there is room on both sides.
const GUIDE_FACE_FRAC = (TARGET_MIN + TARGET_MAX) / 2;

function drawFrontGuide(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  check: FrameCheck,
): void {
  const shape = idealShape(guideSex);
  if (!shape) return;
  const ext = shapeExtent(shape);
  // Width sets the scale, but a tall narrow frame can still cut the chin off,
  // so take whichever of the two constraints binds first.
  const scale = Math.min(
    (GUIDE_FACE_FRAC * w) / (ext.w || 1),
    (0.78 * h) / (ext.h || 1),
  );
  // Cover crops symmetrically, so the visible centre and the video centre are
  // the same point — verified in the render harness rather than assumed.
  const c = { x: w / 2, y: h / 2 };

  const tint =
    check.status === "green" ? "143,243,224" : check.status === "amber" ? "255,201,139" : "255,255,255";
  strokeOutline(ctx, shape, {
    cx: c.x,
    cy: c.y,
    scale,
    stroke: `rgba(${tint},${check.ready ? 0.9 : 0.62})`,
    lineWidth: check.ready ? 2 : 1.5,
    dash: check.ready ? undefined : [9, 7],
    // The interior features are there to make the outline legible as a face to
    // line up with rather than an arbitrary blob. Kept faint so they never
    // compete with the person's own face behind them.
    features: 0.32,
  });

  drawHeadingArrow(ctx, c.x, c.y - scale * ext.h * 0.08, check);
}

// ---------------------------------------------------------------------------
// Heading arrow.
//
// The one part of the old crosshair worth keeping. Which way you are turned is a
// direction, so it is drawn as one: the arrow grows out of the centre along the
// head's heading and lengthens with how far off-axis you are. Face the lens
// squarely and it vanishes, which makes its absence the target.
// ---------------------------------------------------------------------------

function drawHeadingArrow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  check: FrameCheck,
): void {
  const { yaw, pitch } = check.pose;
  const off = Math.hypot(yaw, pitch);
  if (off <= TURN_DEADZONE) return;
  // Short at the edge of the deadzone, full length at roughly twice the pose
  // gate. Past that it stops growing: the message is the direction, not the
  // magnitude.
  const t = Math.min(1, (off - TURN_DEADZONE) / 16);
  const base = 13;
  const len = base + 6 + t * 26;
  const ux = yaw / off;
  const uy = pitch / off;
  const tipX = cx + ux * len;
  const tipY = cy + uy * len;
  ctx.save();
  ctx.strokeStyle = `rgba(255,201,139,${(0.55 + t * 0.4).toFixed(2)})`;
  ctx.lineWidth = 1.4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(cx + ux * (base - 4), cy + uy * (base - 4));
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  // Chevron head, built from the perpendicular so it always points outward
  const hx = -uy;
  const hy = ux;
  const back = 7;
  const wide = 4.5;
  ctx.beginPath();
  ctx.moveTo(tipX - ux * back + hx * wide, tipY - uy * back + hy * wide);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(tipX - ux * back - hx * wide, tipY - uy * back - hy * wide);
  ctx.stroke();
  ctx.restore();
}

// Below this the arrow does not draw at all. Set just inside the pose gate so
// "no arrow" and "straight enough to shoot" mean the same thing.
const TURN_DEADZONE = 4;

// ---------------------------------------------------------------------------
// Profile guide.
//
// There is nothing to track here — the face mesh does not follow a true
// profile, which is the whole reason the thirteen points are placed by hand
// afterwards. So this draws a target rather than a measurement: a facing
// silhouette to line up against, and three rules marking where the brow, the
// nose base and the chin should sit.
//
// It is deliberately loose. A silhouette drawn tightly enough to be a real
// template would be wrong for most faces, and the accuracy that matters is
// enforced at the verification step regardless. This only has to get someone
// close enough that the auto-placement has a chance.
// ---------------------------------------------------------------------------

function drawProfileGuide(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  check: FrameCheck,
): void {
  const tint = check.ready ? "143,243,224" : check.status === "amber" ? "255,201,139" : "255,255,255";
  // A head box sized to how a profile should fill the frame, shifted back from
  // centre so there is room in front of the face for nose and chin projection —
  // which is exactly what the side view exists to measure.
  const bh = h * 0.62;
  const bw = bh * 0.78;
  const cx = w * 0.54;
  const cy = h * 0.5;
  const left = cx - bw * 0.5;
  const top = cy - bh * 0.5;

  ctx.save();
  ctx.strokeStyle = `rgba(${tint},0.5)`;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([7, 6]);

  // Facing silhouette, drawn as a single open curve: crown, brow, nose, lips,
  // chin, jaw. Bezier control points are proportions of the box, so it scales.
  const X = (f: number) => left + bw * f;
  const Y = (f: number) => top + bh * f;
  ctx.beginPath();
  ctx.moveTo(X(0.16), Y(0.30));
  ctx.bezierCurveTo(X(0.22), Y(0.02), X(0.78), Y(0.0), X(0.82), Y(0.30)); // crown
  ctx.bezierCurveTo(X(0.86), Y(0.40), X(0.80), Y(0.40), X(0.80), Y(0.44)); // brow
  ctx.bezierCurveTo(X(0.94), Y(0.55), X(0.94), Y(0.57), X(0.78), Y(0.60)); // nose
  ctx.bezierCurveTo(X(0.86), Y(0.68), X(0.84), Y(0.72), X(0.76), Y(0.74)); // lips
  ctx.bezierCurveTo(X(0.82), Y(0.82), X(0.74), Y(0.92), X(0.58), Y(0.93)); // chin
  ctx.bezierCurveTo(X(0.36), Y(0.94), X(0.18), Y(0.80), X(0.16), Y(0.58)); // jaw
  ctx.stroke();
  ctx.setLineDash([]);

  // Height rules: brow, nose base, chin.
  ctx.strokeStyle = `rgba(${tint},0.22)`;
  ctx.lineWidth = 1;
  for (const f of [0.34, 0.6, 0.93]) {
    ctx.beginPath();
    ctx.moveTo(left - bw * 0.18, Y(f));
    ctx.lineTo(left + bw * 1.18, Y(f));
    ctx.stroke();
  }
  ctx.restore();
}

// Alignment diagnostic, off unless the page is loaded with ?debug=1.
//
// The overlay is drawn by reproducing the browser's own `object-fit: cover`
// crop in script. If the two ever disagree — a camera reporting a pixel aspect
// ratio other than 1:1 would do it, and so would a stylesheet setting
// object-position — the mesh lands off the face with no way to tell from the
// outside which half is wrong. This draws the rectangle the script BELIEVES the
// video occupies. If that box does not sit exactly on the visible video, the
// mapping is at fault; if it does, the landmarks are.
const DEBUG =
  typeof location !== "undefined" && new URLSearchParams(location.search).get("debug") === "1";

function drawDebug(
  ctx: CanvasRenderingContext2D,
  P: Mapper,
  video: HTMLVideoElement,
  w: number,
  h: number,
  dpr: number,
): void {
  ctx.save();
  ctx.strokeStyle = "rgba(255,64,129,0.85)";
  ctx.lineWidth = 1;

  // Gridlines at quarter positions of the VIDEO's own coordinate space, not the
  // canvas's. A rectangle at the video bounds was the first attempt and drew
  // nothing useful: under `object-fit: cover` those bounds are off-screen by
  // design — that is what cover means. These lines stay in frame, so they can
  // be compared against what is actually visible behind them.
  ctx.setLineDash([5, 4]);
  for (const f of [0.25, 0.5, 0.75]) {
    const v = P(f, 0.5);
    const hh = P(0.5, f);
    ctx.beginPath();
    ctx.moveTo(v.x, 0); ctx.lineTo(v.x, h);
    ctx.moveTo(0, hh.y); ctx.lineTo(w, hh.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // The centre, drawn heavier. If this cross does not sit on the middle of the
  // visible image, the mapping is at fault and the landmarks are not.
  const c = P(0.5, 0.5);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(c.x - 26, c.y); ctx.lineTo(c.x + 26, c.y);
  ctx.moveTo(c.x, c.y - 26); ctx.lineTo(c.x, c.y + 26);
  ctx.stroke();

  // Text is mirrored by the CSS flip on the canvas, so un-flip it locally, and
  // sit it low-left where the guidance card cannot cover it.
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.fillStyle = "rgba(255,64,129,0.95)";
  ctx.font = "600 11px ui-monospace, monospace";
  ctx.textAlign = "left";
  const lines = [
    `video ${video.videoWidth}x${video.videoHeight}`,
    `box   ${Math.round(w)}x${Math.round(h)} dpr ${dpr}`,
    `draw  ${P.dw.toFixed(1)}x${P.dh.toFixed(1)}`,
    `off   ${P(0, 0).x.toFixed(1)}, ${P(0, 0).y.toFixed(1)}`,
  ];
  lines.forEach((t, i) => ctx.fillText(t, 10, h - 80 + i * 14));
  ctx.restore();
  ctx.restore();
}
