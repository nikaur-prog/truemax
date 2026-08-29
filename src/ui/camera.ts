import { detectVideo, initLandmarker, setRunningMode } from "../engine/landmarker.js";
import { checkFrame, checkSideFrame, frameStats } from "../engine/captureGuide.js";
import { detectOcclusion } from "../engine/occlusion.js";
import type { FrameCheck, Viewport } from "../engine/captureGuide.js";

// Live camera capture. The preview starts on the landing screen so the first
// thing someone sees is their own face already being tracked — the guidance is
// the product demo, before they have committed to anything.

export interface CameraHandle {
  stop(): void;
  capture(): HTMLCanvasElement | null;
  /**
   * Switch to another camera: a phone flips between the front and back faces,
   * a desktop cycles through whatever cameras are plugged in. Resolves false
   * when there was nothing to switch to (the preview keeps the camera it had).
   */
  swap(): Promise<boolean>;
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

// Which way the active camera faces, and (on a desktop cycling real devices)
// which device holds the preview. Module-level like `stream`: one camera at a
// time is a standing assumption of this file.
let facing: "user" | "environment" = "user";
let deviceId: string | null = null;

/** How many cameras this machine has. Meaningful after permission is granted. */
export async function cameraCount(): Promise<number> {
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    return devs.filter((d) => d.kind === "videoinput").length;
  } catch {
    return 0;
  }
}

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
  facing = "user";
  deviceId = null;
  let live = true;

  const constraints = (): MediaStreamConstraints => ({
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: facing }),
      width: { ideal: 1280 },
      height: { ideal: 1280 },
    },
    audio: false,
  });

  // The preview mirrors like a mirror ONLY for a camera pointed at its own
  // user. The back camera shows the world, and a mirrored world — someone
  // else's face, text on a wall — reads as wrong immediately. capture() below
  // makes the matching call, so the saved frame is always true orientation.
  const applyMirror = () => {
    const rear = facing === "environment";
    opts.video.classList.toggle("unmirrored", rear);
    opts.guideCanvas.classList.toggle("unmirrored", rear);
  };

  async function attach(): Promise<void> {
    // Stop the old tracks BEFORE asking for new ones: many phones refuse to
    // hold two cameras open, and the refusal arrives as a cryptic NotReadable.
    stream?.getTracks().forEach((t) => t.stop());
    stream = await navigator.mediaDevices.getUserMedia(constraints());
    opts.video.srcObject = stream;
    opts.video.muted = true;
    opts.video.playsInline = true;
    await opts.video.play();
    const track = stream.getVideoTracks()[0];
    // Believe the track over the request — a phone with no back camera hands
    // back the front one whatever was asked for.
    const f = track?.getSettings?.().facingMode;
    if (f === "environment" || f === "user") facing = f;
    applyMirror();
    track?.addEventListener("ended", onTrackDown);
  }

  // ---- stream recovery ------------------------------------------------------
  // Backgrounding the tab, taking a phone call, or the OS reclaiming the
  // camera kills the video track, and a dead track does not come back on its
  // own: returning to the tab used to show a black rectangle wearing live-
  // camera chrome. Two signals cover it — the track's own "ended" event, and
  // the tab becoming visible again holding a track that is no longer live.
  let reacquiring = false;
  async function reacquire(): Promise<void> {
    if (!live || reacquiring) return;
    reacquiring = true;
    try {
      await attach();
    } catch {
      // Permission revoked or the camera is genuinely busy. The guidance
      // already shows its "looking for a face" state over a black frame; the
      // next visibility change tries again.
    }
    reacquiring = false;
  }
  function onTrackDown(): void {
    // Recover into a visible tab immediately; a hidden one would just lose
    // the fresh track the same way, so it reacquires on return instead.
    if (document.visibilityState === "visible") void reacquire();
  }
  const onVisible = () => {
    if (document.visibilityState !== "visible") return;
    const track = stream?.getVideoTracks()[0];
    if (!track || track.readyState !== "live" || track.muted) void reacquire();
  };
  document.addEventListener("visibilitychange", onVisible);

  try {
    await attach();
  } catch (err) {
    document.removeEventListener("visibilitychange", onVisible);
    throw err;
  }

  // The preview goes up without waiting for the landmarker.
  //
  // setRunningMode is a no-op while there is no landmarker to set options on,
  // so calling it before the engine has loaded used to leave the detector
  // parked in IMAGE mode for good: detectVideo returns null in that state, the
  // loop ran, and the guidance never once found a face. Now that the engine
  // loads on intent rather than on page load, that is not a rare race — it is
  // what happens every time somebody's first action is to open the camera.
  //
  // So the mode switch waits for the boot instead, and the loop below starts
  // immediately. Until the switch lands detectVideo returns null and the
  // guidance shows its "looking for a face" state, which is true.
  void initLandmarker()
    .then(() => {
      if (live) return setRunningMode("VIDEO");
      return undefined;
    })
    .catch(() => {
      /* the scan path reports the failure; the preview keeps running */
    });

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
      drawGuide(opts.guideCanvas, v);
    }
    raf = requestAnimationFrame(loop);
  };

  raf = requestAnimationFrame(loop);

  return {
    stop() {
      live = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisible);
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      opts.video.srcObject = null;
      opts.video.classList.remove("unmirrored");
      opts.guideCanvas.classList.remove("unmirrored");
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
      // (and any text in shot) come out reversed. The back camera's preview is
      // never mirrored, so its frame is already true.
      if (facing !== "environment") {
        ctx.translate(c.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(v, 0, 0);
      return c;
    },
    async swap() {
      const wasFacing = facing;
      const wasDevice = deviceId;
      try {
        const coarse = matchMedia("(pointer: coarse)").matches;
        if (coarse) {
          // Front/back flip. facingMode is a preference, not a demand, so a
          // phone with one camera resolves it without an error — attach()
          // reads the real facing off the track and reports honestly.
          deviceId = null;
          facing = facing === "user" ? "environment" : "user";
        } else {
          const devs = (await navigator.mediaDevices.enumerateDevices()).filter(
            (d) => d.kind === "videoinput",
          );
          if (devs.length < 2) return false;
          const cur = stream?.getVideoTracks()[0]?.getSettings?.().deviceId;
          const i = devs.findIndex((d) => d.deviceId === cur);
          deviceId = devs[(Math.max(0, i) + 1) % devs.length].deviceId;
        }
        await attach();
        return coarse ? facing !== wasFacing : true;
      } catch {
        // The other camera would not open. Go back to the one that did.
        facing = wasFacing;
        deviceId = wasDevice;
        try {
          await attach();
        } catch {
          /* the recovery path picks this up on the next visibility change */
        }
        return false;
      }
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

// Keep the live image unobstructed. The status copy, readiness lamp and audio
// cues provide the useful guidance; generic front/profile silhouettes and a
// direction arrow made the camera feel busier without improving measurement.
function drawGuide(canvas: HTMLCanvasElement, video: HTMLVideoElement): void {
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
