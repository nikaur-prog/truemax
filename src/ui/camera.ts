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
  if (DEBUG) drawDebug(ctx, P, video, w, h, dpr);
  const lm = result?.faceLandmarks?.[0];
  if (!lm) return;

  const colour =
    check.status === "green" ? "143,243,224" : check.status === "amber" ? "255,201,139" : "255,255,255";

  drawCloud(ctx, P, lm, check);
  drawCross(ctx, P, lm, check, colour);
}

// TWO elements now: the dots prove it is tracking, the cross tells you how to
// move. Two things have been removed for the same reason, and it is worth
// writing down because the temptation to add them back is constant.
//
// Feature contours on the eyes, brows and lips went first: MediaPipe's eye ring
// follows the orbital rim, not the lid, so it sat visibly wide of the eye and
// read as broken tracking even while the measurements underneath were correct.
//
// The face outline went second, for a subtler version of the same problem. The
// FACE_OVAL ring is an anatomical boundary, not the silhouette you see — its
// lower arc follows the jaw's underside, so on anyone photographed from
// slightly above it projects well below the visible chin. Verified on a
// pixel-perfect render where the mesh was provably aligned: the oval still
// finished about 15% of face height below the chin, onto the neck. Nothing was
// wrong, and it looked wrong, which for the one screen that has to establish
// "this thing can actually see me" is the same as being wrong.
//
// An overlay that looks broken costs more than it adds. If a third element is
// ever proposed, it has to survive that test first.

// ---------------------------------------------------------------------------
// The mesh, rendered with depth.
//
// Every landmark carries a z, and ignoring it is what made the old overlay read
// as a flat blob stuck to the middle of the face. Sizing and fading each point
// by its depth turns the same data into something that visibly wraps around a
// head — the nose comes forward, the jaw sides fall away, and turning your head
// makes the whole cloud rotate. Same trick Face ID's setup animation uses.
// ---------------------------------------------------------------------------

// Every Nth landmark. Was 4, which put ~120 dots on a face — enough that the
// cloud stopped reading as "tracking" and started reading as "static". At 8 it
// is ~60, sparse enough that you can see individual points hold onto features.
const CLOUD_STEP = 8;

// The face-oval ring, as a lookup. Built once from the same connection list the
// outline used to be drawn from.
const BOUNDARY: Set<number> = new Set(
  FaceLandmarker.FACE_LANDMARKS_FACE_OVAL.flatMap((c) => [c.start, c.end]),
);

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
    // Skip the boundary ring. Those landmarks sit on the anatomical edge of the
    // face, which from the front lands on the neck and in front of the ears —
    // they are the dots that read as "it has lost my face" even when tracking
    // is perfect. Everything inside the boundary sits on a feature.
    if (BOUNDARY.has(i)) continue;
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
  const a = P(0, 0);
  const b = P(1, 1);
  ctx.save();
  ctx.strokeStyle = "rgba(255,64,129,0.95)";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  ctx.setLineDash([]);
  // Crosshair at the exact centre of where the script thinks the frame is
  const c = P(0.5, 0.5);
  ctx.beginPath();
  ctx.moveTo(c.x - 20, c.y); ctx.lineTo(c.x + 20, c.y);
  ctx.moveTo(c.x, c.y - 20); ctx.lineTo(c.x, c.y + 20);
  ctx.stroke();
  // Text is mirrored by the CSS flip on the canvas, so un-flip it locally
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.fillStyle = "rgba(255,64,129,0.95)";
  ctx.font = "600 11px ui-monospace, monospace";
  ctx.textAlign = "left";
  const lines = [
    `video ${video.videoWidth}x${video.videoHeight}`,
    `box   ${Math.round(w)}x${Math.round(h)}  dpr ${dpr}`,
    `draw  ${P.dw.toFixed(1)}x${P.dh.toFixed(1)}`,
    `off   ${(P(0, 0).x).toFixed(1)}, ${(P(0, 0).y).toFixed(1)}`,
  ];
  lines.forEach((t, i) => ctx.fillText(t, 10, 18 + i * 14));
  ctx.restore();
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
  // Shorter arms and a wider gap than the first version. The old cross ran
  // almost the full width of the face with a tick on each end, which read as a
  // rifle scope; this is closer to the hairline reticle a camera app draws.
  const ring = 13;
  const armX = Math.max(ring + 14, faceW * 0.5);
  const armY = Math.max(ring + 14, faceH * 0.34);

  // Step along the axis in 3D, then drop z. That orthographic flatten is what
  // makes the arm shorten as the head turns away from the lens.
  const along = (axis: V3, dist: number) => ({
    x: centre.x + axis.x * dist,
    y: centre.y + axis.y * dist,
  });

  ctx.save();
  ctx.strokeStyle = `rgba(${colour},0.72)`;
  ctx.lineWidth = 1;
  ctx.lineCap = "round";
  for (const [axis, arm] of [[lateral, armX], [vertical, armY]] as const) {
    for (const sign of [-1, 1] as const) {
      const inner = along(axis, sign * (ring + 9));
      const outer = along(axis, sign * arm);
      ctx.beginPath();
      ctx.moveTo(inner.x, inner.y);
      ctx.lineTo(outer.x, outer.y);
      ctx.stroke();
    }
  }
  ctx.restore();

  // Gaze, reduced to the ring alone. It used to also draw a radial line and a
  // filled pip that tracked the eyes — three moving elements stacked on the
  // bridge of the nose. The ring changing colour carries the same one bit of
  // information ("your eyes are off the lens") without the machinery, and the
  // hint line says it in words at the same moment.
  ctx.save();
  ctx.strokeStyle = check.gates.gaze ? `rgba(${colour},0.5)` : "rgba(255,201,139,0.95)";
  ctx.lineWidth = check.gates.gaze ? 1 : 1.4;
  ctx.beginPath();
  ctx.arc(c.x, c.y, ring, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

interface V3 { x: number; y: number; z: number }
const mid3 = (a: V3, b: V3): V3 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
const sub3 = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
function unit3(v: V3): V3 {
  const n = Math.hypot(v.x, v.y, v.z) || 1e-6;
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}
