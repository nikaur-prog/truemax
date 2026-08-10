import { detectVideo, setRunningMode } from "../engine/landmarker.ts";
import { checkFrame, frameStats } from "../engine/captureGuide.ts";
import { FaceLandmarker } from "@mediapipe/tasks-vision";
import { buildGeometry } from "../engine/geometry.ts";
import { detectSex, extractShape } from "../engine/shape.ts";
import type { FrameCheck } from "../engine/captureGuide.ts";
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
  onCheck: (c: FrameCheck) => void;
  // Fires when the running vote on which reference population fits the face
  // settles, or flips. Lets the framing silhouette match the person in front
  // of the camera without asking them to classify themselves first.
  onSex?: (sex: Sex) => void;
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
  const sexVotes: Sex[] = [];
  let sexShown: Sex | null = null;
  let frameNo = 0;

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
      drawGuide(opts.guideCanvas, v, result, check);
      if (opts.onSex && ++frameNo % 12 === 0) voteSex(result, v, check);
    }
    raf = requestAnimationFrame(loop);
  };

  // Shape-based sex detection on a badly framed face is a coin flip, so only
  // vote on frames that already pass distance and pose, and only act on a
  // clear margin. A silhouette that flickers between male and female while
  // someone is still getting into position would read as the app guessing.
  const voteSex = (
    result: ReturnType<typeof detectVideo>,
    v: HTMLVideoElement,
    check: FrameCheck,
  ) => {
    const lm = result?.faceLandmarks?.[0];
    if (!lm || !check.gates.distance || !check.gates.straight) return;
    let guess: ReturnType<typeof detectSex> = null;
    try {
      guess = detectSex(extractShape(buildGeometry(lm, v.videoWidth, v.videoHeight)));
    } catch {
      return;
    }
    if (!guess || guess.confidence < 0.03) return;
    sexVotes.push(guess.sex);
    if (sexVotes.length > 9) sexVotes.shift();
    if (sexVotes.length < 5) return;
    const male = sexVotes.filter((s) => s === "male").length;
    const winner: Sex = male * 2 > sexVotes.length ? "male" : "female";
    if (male !== 0 && male !== sexVotes.length) return; // not unanimous — wait
    if (winner !== sexShown) {
      sexShown = winner;
      opts.onSex?.(winner);
    }
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

function drawGuide(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
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
  const P = coverMap(video, w, h);
  drawTarget(ctx, P, check);
  const lm = result?.faceLandmarks?.[0];
  if (!lm) return;

  const colour =
    check.status === "green" ? "143,243,224" : check.status === "amber" ? "255,201,139" : "255,255,255";
  const pulse = trackMotion(lm);

  drawCloud(ctx, P, lm, check);
  drawOutline(ctx, P, lm, check, pulse);
  drawCross(ctx, P, lm, check, colour);
}

// Three elements, and no more: the outline proves it found your face, the dots
// prove it is still tracking, the cross tells you how to move. Feature contours
// on the eyes, brows and lips were the fourth thing — they sat a little wide of
// the real eye opening (MediaPipe's eye ring follows the orbit, not the lid),
// so they read as broken tracking even while the measurements underneath were
// correct. An overlay that looks wrong costs more than it adds.

// ---------------------------------------------------------------------------
// The mesh, rendered with depth.
//
// Every landmark carries a z, and ignoring it is what made the old overlay read
// as a flat blob stuck to the middle of the face. Sizing and fading each point
// by its depth turns the same data into something that visibly wraps around a
// head — the nose comes forward, the jaw sides fall away, and turning your head
// makes the whole cloud rotate. Same trick Face ID's setup animation uses.
// ---------------------------------------------------------------------------

const CLOUD_STEP = 4; // every Nth landmark — denser than this is soup, not tracking

function drawCloud(
  ctx: CanvasRenderingContext2D,
  P: Mapper,
  lm: Array<{ x: number; y: number; z?: number }>,
  check: FrameCheck,
): void {
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const p of lm) {
    const z = p.z ?? 0;
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
  }
  const span = zMax - zMin || 1e-6;
  const tint = check.ready ? "143,243,224" : "100,210,255";

  for (let i = 0; i < lm.length; i += CLOUD_STEP) {
    const p = lm[i];
    // 1 = nearest the lens, 0 = furthest. MediaPipe's z grows away from camera.
    const near = 1 - ((p.z ?? 0) - zMin) / span;
    const s = P(p.x, p.y);
    ctx.fillStyle = `rgba(${tint},${(0.28 + near * 0.5).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 0.85 + near * 1.15, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Motion detector for the pulse. Compares the face's position and size against
// the previous frame; any real movement re-triggers the ring, which then decays.
// It exists so the overlay feels alive while someone is adjusting, and settles
// once they hold still — the same signal the shutter is waiting for.
let lastCentre: { x: number; y: number; s: number } | null = null;
let pulse = 0;

function trackMotion(lm: Array<{ x: number; y: number }>): number {
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
  for (const p of lm) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  const now = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, s: x1 - x0 };
  if (lastCentre) {
    const moved =
      Math.hypot(now.x - lastCentre.x, now.y - lastCentre.y) + Math.abs(now.s - lastCentre.s);
    pulse = Math.max(pulse * 0.9, Math.min(1, moved * 45));
  }
  lastCentre = now;
  return pulse;
}

function drawOutline(
  ctx: CanvasRenderingContext2D,
  P: Mapper,
  lm: Array<{ x: number; y: number }>,
  check: FrameCheck,
  pulseAmt: number,
): void {
  const oval = FaceLandmarker.FACE_LANDMARKS_FACE_OVAL;
  const tint = check.ready ? "143,243,224" : "255,255,255";

  // Pulse ring: the outline traced again, wider and fading, while moving
  if (pulseAmt > 0.02) {
    ctx.save();
    ctx.strokeStyle = `rgba(100,210,255,${(pulseAmt * 0.22).toFixed(3)})`;
    ctx.lineWidth = 2 + pulseAmt * 5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (const c of oval) {
      const a = P(lm[c.start].x, lm[c.start].y);
      const b = P(lm[c.end].x, lm[c.end].y);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.strokeStyle = `rgba(${tint},0.8)`;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(100,210,255,0.5)";
  ctx.shadowBlur = 6;
  ctx.beginPath();
  for (const c of oval) {
    const a = P(lm[c.start].x, lm[c.start].y);
    const b = P(lm[c.end].x, lm[c.end].y);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Adaptive crosshair.
//
// Two crosses: a fixed target at the centre of the frame with the centring
// tolerance drawn around it, and a live cross locked to the face that carries
// the head's own tilt. Lining one up with the other IS the framing instruction,
// which beats reading "move left" and guessing how far.
//
// The ring at the middle of the live cross is the gaze readout: the pip inside
// it drifts toward whatever the eyes are actually pointed at. Nearly everyone
// looks at their own image rather than the lens, which quietly tilts the eye
// measurements, and no amount of head-position coaching catches it.
// ---------------------------------------------------------------------------

function drawTarget(ctx: CanvasRenderingContext2D, P: Mapper, check: FrameCheck): void {
  // Just four ticks at dead centre. The dashed tolerance box that used to be
  // here was accurate and still wrong: a rectangle floating over someone's
  // chest is one more thing to decode when the traffic light already answers
  // "am I there yet" in a glance.
  const c = P(0.5, 0.5);
  ctx.save();
  ctx.strokeStyle = check.gates.centered ? "rgba(143,243,224,0.5)" : "rgba(255,255,255,0.26)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
    ctx.moveTo(c.x + dx * 8, c.y + dy * 8);
    ctx.lineTo(c.x + dx * 15, c.y + dy * 15);
  }
  ctx.stroke();
  ctx.restore();
}

function drawCross(
  ctx: CanvasRenderingContext2D,
  P: Mapper,
  lm: Array<{ x: number; y: number; z?: number }>,
  check: FrameCheck,
  colour: string,
): void {
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
  for (const p of lm) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  const faceW = (x1 - x0) * P.dw;
  const faceH = (y1 - y0) * P.dh;

  // The cross is built from the head's own axes IN 3D and then flattened, so
  // it foreshortens on its own: turn away and the horizontal arm shortens and
  // swings, exactly as a band drawn around a real head would. Deriving it from
  // the eye axis in 2D instead would give a cross that only ever rotates, and
  // would read as a sticker rather than something wrapped around you.
  // Everything below works in screen pixels, including z. Normalized landmark
  // coordinates are anisotropic — x and y span different pixel counts — so a
  // unit vector computed in that space would skew the axes.
  const px3 = (i: number): V3 => {
    const s = P(lm[i].x, lm[i].y);
    return { x: s.x, y: s.y, z: (lm[i].z ?? 0) * P.dw };
  };
  const eyeR = mid3(px3(33), px3(133));
  const eyeL = mid3(px3(362), px3(263));
  const centre = mid3(eyeR, eyeL);
  const lateral = unit3(sub3(eyeL, eyeR));
  const vertical = unit3(sub3(px3(152), px3(9)));

  const c = { x: centre.x, y: centre.y };
  const ring = 15;
  const armX = Math.max(ring + 12, faceW * 0.72);
  const armY = Math.max(ring + 12, faceH * 0.5);

  // Step along the axis in 3D, then drop z. That orthographic flatten is what
  // makes the arm shorten as the head turns away from the lens.
  const along = (axis: V3, dist: number) => ({
    x: centre.x + axis.x * dist,
    y: centre.y + axis.y * dist,
  });

  ctx.save();
  ctx.strokeStyle = `rgba(${colour},0.9)`;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.shadowColor = `rgba(${colour},0.5)`;
  ctx.shadowBlur = 5;
  for (const [axis, arm] of [[lateral, armX], [vertical, armY]] as const) {
    for (const sign of [-1, 1] as const) {
      const inner = along(axis, sign * (ring + 6));
      const outer = along(axis, sign * arm);
      ctx.beginPath();
      ctx.moveTo(inner.x, inner.y);
      ctx.lineTo(outer.x, outer.y);
      ctx.stroke();
      // End cap, perpendicular in screen space — a tick, not an arrowhead,
      // so it never reads as a direction to move in
      const dx = outer.x - inner.x;
      const dy = outer.y - inner.y;
      const len = Math.hypot(dx, dy) || 1;
      ctx.beginPath();
      ctx.moveTo(outer.x - (dy / len) * 5, outer.y + (dx / len) * 5);
      ctx.lineTo(outer.x + (dy / len) * 5, outer.y - (dx / len) * 5);
      ctx.stroke();
    }
  }
  ctx.restore();

  // Gaze ring, drawn unrotated: it reports where the eyes point in the frame,
  // which has nothing to do with how the head is tilted.
  const gazeOk = check.gates.gaze;
  ctx.save();
  ctx.strokeStyle = gazeOk ? "rgba(100,210,255,0.9)" : "rgba(255,201,139,0.95)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(c.x, c.y, ring, 0, Math.PI * 2);
  ctx.stroke();

  const g = check.gaze;
  if (g) {
    // Clamped just outside the ring: past a point the direction is the message,
    // not the magnitude, and a pip flying off the face reads as a glitch.
    const m = Math.hypot(g.x, g.y) || 1e-6;
    const k = Math.min(1.9, m * 2.4) * ring;
    const px = c.x + (g.x / m) * k;
    const py = c.y + (g.y / m) * k;
    ctx.strokeStyle = gazeOk ? "rgba(100,210,255,0.45)" : "rgba(255,201,139,0.55)";
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(px, py);
    ctx.stroke();
    ctx.fillStyle = gazeOk ? "rgba(100,210,255,0.95)" : "rgba(255,201,139,0.95)";
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

interface V3 { x: number; y: number; z: number }
const mid3 = (a: V3, b: V3): V3 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
const sub3 = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
function unit3(v: V3): V3 {
  const n = Math.hypot(v.x, v.y, v.z) || 1e-6;
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}
