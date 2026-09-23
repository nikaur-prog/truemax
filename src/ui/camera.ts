import { detectVideo, initLandmarker, setRunningMode } from "../engine/landmarker.js";
import { checkFrame, checkSideFrame, frameStats } from "../engine/captureGuide.js";
import { detectOcclusion } from "../engine/occlusion.js";
import type { FrameCheck } from "../engine/captureGuide.js";
import { faceBounds, fitFrontPreview, settleFrontPreview, stableFrontPreviewTarget } from "../engine/frontFraming.js";
import type { PreviewFit, SourceFrame } from "../engine/frontFraming.js";
import { createPreviewCadence, createPreviewLoop } from "./previewLoop.js";
import type { PreviewLoop } from "./previewLoop.js";
import { isAppForeground, subscribeNativeActivity } from "../engine/nativeBridge.js";

// Live camera capture. The preview starts on the landing screen so the first
// thing someone sees is their own face already being tracked — the guidance is
// the product demo, before they have committed to anything.

export interface CameraHandle {
  stop(): void;
  capture(): HTMLCanvasElement | null;
  /** Hold the displayed framing during a countdown without freezing source checks. */
  setFramingLocked?(locked: boolean): void;
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
  /** Cancels startup, recovery and the live preview without retaining a frame. */
  signal?: AbortSignal;
  // "front" runs the full landmark-driven gating. "side" cannot: the face mesh
  // does not track a true profile, so it gates on exposure, focus, and the
  // detector NOT seeing a front-on face.
  mode?: "front" | "side";
  onCheck: (c: FrameCheck) => void;
  /**
   * The preview is unrecoverably gone — a swap that could not open either
   * camera, having already released the working one. Distinct from a swap
   * that merely declined (swap() resolves false and the old preview lives).
   * The capture screen closes itself rather than showing controls over a
   * dead frame.
   */
  onLost?: () => void;
  /** Invalidate a countdown while camera frames are unavailable. */
  onPause?: () => void;
}

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

interface CameraEngine {
  initLandmarker(): Promise<void>;
  setRunningMode(mode: "IMAGE" | "VIDEO"): Promise<void>;
  detectVideo?: typeof detectVideo;
}

// Engine boot is injectable so camera ownership can be exercised with real
// delayed media promises, without downloading an inference runtime in tests.
export async function startCamera(
  opts: Opts,
  engine: CameraEngine = { initLandmarker, setRunningMode },
): Promise<CameraHandle> {
  const cancelled = () => new DOMException("Camera request was cancelled", "AbortError");
  if (opts.signal?.aborted) throw cancelled();
  // A late callback from a closed camera must never stop or mutate its successor.
  let stream: MediaStream | null = null;
  let facing: "user" | "environment" = "user";
  let deviceId: string | null = null;
  let live = true;
  let attachAttempt = 0;
  let attaching = 0;
  let pauseVersion = 0;
  const foregroundWaiters = new Set<() => void>();
  let previewLoop: PreviewLoop | null = null;
  let frontFit: PreviewFit | null = null;
  let frontTarget: PreviewFit | null = null;
  let frontSource: SourceFrame | null = null;
  let frontViewport: SourceFrame | null = null;
  let framingLocked = false;
  let frontFitAt = 0;
  let frontFitSize = "";
  let lastFaceAt = 0;
  const originalVideoStyle = opts.video.getAttribute?.("style") ?? null;
  const reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const restoreVideoStyle = () => {
    if (originalVideoStyle === null) opts.video.removeAttribute?.("style");
    else opts.video.setAttribute?.("style", originalVideoStyle);
    frontFit = null;
    frontTarget = null;
    frontSource = null;
    frontViewport = null;
    framingLocked = false;
    frontFitSize = "";
    frontFitAt = 0;
    lastFaceAt = 0;
  };
  const cadence = createPreviewCadence();
  let lastFrameAt = performance.now();
  // Recovery gets time to resume, but only a changed source clock can make
  // old pixels fresh enough to capture.
  let watchdogGraceAt = lastFrameAt;

  const constraints = (): MediaStreamConstraints => ({
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: facing }),
      // Prefer source detail, but do not ask the front camera for a square
      // mode. Native aspect is independent of the phone's or window's shape.
      // These are preferences, never requirements; unsupported constraints
      // may be ignored and the browser still chooses an available camera.
      width: { ideal: 1920 },
      ...(opts.mode === "side"
        ? { height: { ideal: 1920 } }
        : { resizeMode: { ideal: "none" } }),
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

  const releaseStream = () => {
    const ownedPreview = stream !== null && opts.video.srcObject === stream;
    stream?.getTracks().forEach((track) => {
      track.removeEventListener("ended", onTrackDown);
      track.stop();
    });
    stream = null;
    if (ownedPreview) {
      opts.video.srcObject = null;
      restoreVideoStyle();
    }
    return ownedPreview;
  };

  const waitForForeground = (): Promise<void> => {
    if (!live) return Promise.reject(cancelled());
    if (isAppForeground()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const wake = () => {
        if (live && !isAppForeground()) return;
        foregroundWaiters.delete(wake);
        if (live) resolve(); else reject(cancelled());
      };
      foregroundWaiters.add(wake);
    });
  };

  async function attach(): Promise<void> {
    attaching++;
    try {
      while (live) {
        // Native App activity may change while the document still says visible.
        // Keep one attachment owner across pause/resume, including startup.
        if (!isAppForeground()) await waitForForeground();
        if (!live) throw cancelled();
        opts.onPause?.();
        if (!live) throw cancelled();
        const attempt = ++attachAttempt;
        const startedBeforePause = pauseVersion;
        // Stop the old tracks BEFORE asking for new ones: many phones refuse to
        // hold two cameras open, and the refusal arrives as a cryptic NotReadable.
        releaseStream();
        let nextStream: MediaStream;
        try {
          nextStream = await navigator.mediaDevices.getUserMedia(constraints());
        } catch (error) {
          if (live && attempt === attachAttempt && pauseVersion !== startedBeforePause) continue;
          throw error;
        }
        // getUserMedia cannot be aborted. A cancel, a newer swap, or a recovery
        // can therefore win while this permission/device request is in flight.
        // Never let the late result resurrect a preview its owner already closed.
        if (!live || attempt !== attachAttempt) {
          nextStream.getTracks().forEach((t) => t.stop());
          throw new Error("Camera request was superseded");
        }
        if (!isAppForeground()) {
          nextStream.getTracks().forEach((t) => t.stop());
          continue;
        }
        stream = nextStream;
        restoreVideoStyle();
        opts.video.srcObject = nextStream;
        opts.video.muted = true;
        opts.video.playsInline = true;
        try {
          await opts.video.play();
        } catch (error) {
          nextStream.getTracks().forEach((t) => t.stop());
          if (stream === nextStream) stream = null;
          if (opts.video.srcObject === nextStream) opts.video.srcObject = null;
          if (live && attempt === attachAttempt && pauseVersion !== startedBeforePause) continue;
          throw error;
        }
        if (!live || attempt !== attachAttempt) {
          nextStream.getTracks().forEach((t) => t.stop());
          if (stream === nextStream) stream = null;
          if (opts.video.srcObject === nextStream) opts.video.srcObject = null;
          throw new Error("Camera request was superseded");
        }
        if (!isAppForeground()) {
          releaseStream();
          continue;
        }
        if (reacquireTimer !== null) clearTimeout(reacquireTimer);
        reacquireTimer = null;
        const track = stream.getVideoTracks()[0];
        // Believe the track over the request — a phone with no back camera hands
        // back the front one whatever was asked for.
        const f = track?.getSettings?.().facingMode;
        if (f === "environment" || f === "user") facing = f;
        applyMirror();
        track?.addEventListener("ended", onTrackDown);
        return;
      }
      throw cancelled();
    } finally {
      attaching--;
    }
  }

  // ---- stream recovery ------------------------------------------------------
  // Backgrounding the tab, taking a phone call, or the OS reclaiming the
  // camera kills the video track, and a dead track does not come back on its
  // own: returning to the tab used to show a black rectangle wearing live-
  // camera chrome. Two signals cover it — the track's own "ended" event, and
  // the tab becoming visible again holding a track that is no longer live.
  let reacquiring = false;
  let reacquireTimer: number | null = null;
  let reacquireRetries = 0;
  let lostReported = false;
  const reportLost = () => {
    if (!live || lostReported) return;
    lostReported = true;
    opts.onLost?.();
  };
  const scheduleReacquire = () => {
    if (!live || !isAppForeground() || reacquireTimer !== null) return;
    if (reacquireRetries >= 3) {
      reportLost();
      return;
    }
    const delay = [250, 750, 1500][reacquireRetries++] ?? 1500;
    reacquireTimer = window.setTimeout(() => {
      reacquireTimer = null;
      void reacquire();
    }, delay);
  };
  async function reacquire(): Promise<void> {
    if (!live || !isAppForeground() || reacquiring) return;
    reacquiring = true;
    try {
      await attach();
      reacquireRetries = 0;
      lostReported = false;
    } catch {
      // Permission revoked or the camera is genuinely busy. The guidance
      // already shows its "looking for a face" state over a black frame.
      // Retry transient camera-busy failures while visible; a later visibility
      // change remains the recovery path after the bounded retries are spent.
      const track = stream?.getVideoTracks()[0];
      if (!track || track.readyState !== "live" || track.muted) scheduleReacquire();
    }
    reacquiring = false;
  }
  function onTrackDown(): void {
    if (!live) return;
    opts.onPause?.();
    // Recover into a visible tab immediately; a hidden one would just lose
    // the fresh track the same way, so it reacquires on return instead.
    if (isAppForeground()) {
      reacquireRetries = 0;
      void reacquire();
    }
  }
  const onVisible = () => {
    if (!live) return;
    if (!isAppForeground()) {
      pauseVersion++;
      previewLoop?.pause();
      if (reacquireTimer !== null) clearTimeout(reacquireTimer);
      reacquireTimer = null;
      opts.onPause?.();
      return;
    }
    watchdogGraceAt = performance.now();
    cadence.reset();
    previewLoop?.resume();
    for (const wake of foregroundWaiters) wake();
    if (attaching) return;
    const track = stream?.getVideoTracks()[0];
    if (!track || track.readyState !== "live" || track.muted) {
      reacquireRetries = 0;
      void reacquire();
    }
  };
  const unsubscribeNative = subscribeNativeActivity(onVisible);

  let rejectStartup: ((error: Error) => void) | null = null;
  const startupCancelled = new Promise<never>((_resolve, reject) => { rejectStartup = reject; });
  const onAbort = () => {
    stop(false);
    rejectStartup?.(cancelled());
  };
  function stop(notifyPause = true): void {
    const wasLive = live;
    live = false;
    attachAttempt++;
    for (const wake of foregroundWaiters) wake();
    previewLoop?.pause();
    if (notifyPause && wasLive) opts.onPause?.();
    if (reacquireTimer !== null) clearTimeout(reacquireTimer);
    reacquireTimer = null;
    document.removeEventListener("visibilitychange", onVisible);
    unsubscribeNative();
    opts.signal?.removeEventListener("abort", onAbort);
    if (releaseStream()) {
      opts.video.classList.remove("unmirrored");
      opts.guideCanvas.classList.remove("unmirrored");
      const ctx = opts.guideCanvas.getContext("2d");
      ctx?.clearRect(0, 0, opts.guideCanvas.width, opts.guideCanvas.height);
    }
  }
  document.addEventListener("visibilitychange", onVisible);
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    // Permission cannot itself be aborted. Reject promptly, while attach's
    // existing generation checks stop a late stream before it touches video.
    await Promise.race([attach(), startupCancelled]);
  } catch (err) {
    stop(false);
    throw err;
  } finally {
    rejectStartup = null;
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
  void engine.initLandmarker()
    .then(() => {
      if (live) return engine.setRunningMode("VIDEO");
      return undefined;
    })
    .catch(() => {
      /* the scan path reports the failure; the preview keeps running */
    });

  const side = opts.mode === "side";
  const scratch = document.createElement("canvas");
  let last = -1;
  let analyzedTime = -1;
  let glassesCheckedAt = -Infinity;
  // The glasses measure resamples a face crop and reads it back, which is far
  // too expensive per frame and does not need to be: nobody puts glasses on
  // and takes them off between frames. Use time, not the frame count, so a
  // slower guidance cadence does not make the warning take seconds to appear.
  let glasses = { advise: false, block: false };

  // ---- the stall watchdog ---------------------------------------------------
  // The `ended` event and the visibility check cover a track that DIES. They do
  // not cover one that simply stops delivering frames while still reporting
  // readyState "live" — an iOS camera interrupted by another app, a driver
  // hiccup, a backgrounded PWA that came back without a visibility event. The
  // preview freezes on its last frame, the guidance loop stops being called,
  // and the shutter goes dead with no error anywhere. Reported from a phone as
  // the camera "just getting stuck".
  //
  // So the frame clock itself is the signal: if currentTime has not advanced
  // for STALL_MS while the page is visible and the camera is supposed to be
  // running, the stream is gone whatever it claims, and it is reacquired.
  const STALL_MS = 2600;
  const STALE_FRAME_MS = 500;
  let staleReported = false;
  let activeLoopClockAt: number | null = null;
  const observeFrame = (observedAt: number) => {
    const v = opts.video;
    if (v.readyState >= 2 && Number.isFinite(v.currentTime) && v.currentTime !== last) {
      last = v.currentTime;
      lastFrameAt = observedAt;
      staleReported = false;
    }
  };

  const previewFrame = (now: number) => {
    if (!live) return;
    if (!isAppForeground()) {
      previewLoop?.pause();
      opts.onPause?.();
      return;
    }
    const v = opts.video;
    observeFrame(activeLoopClockAt ?? performance.now());
    if (v.readyState >= 2 && v.currentTime !== analyzedTime && cadence.due(now)) {
      analyzedTime = v.currentTime;
      const ts = performance.now();
      let result = null;
      try {
        result = (engine.detectVideo ?? detectVideo)(v, ts);
      } catch {
        /* mode switch in flight — skip this frame */
      }
      // Measure exposure and focus on the face itself — a bright wall or a
      // busy background otherwise decides whether the shot is "sharp".
      const box = faceBox(result);
      const stats = frameStats(v, scratch, box);
      const lm = result?.faceLandmarks?.[0];
      if (!side && lm && now - glassesCheckedAt >= 500) {
        glassesCheckedAt = now;
        try {
          const o = detectOcclusion(v, lm, v.videoWidth, v.videoHeight);
          if (o) glasses = { advise: o.glasses, block: o.glassesStrong && !glassesOverride };
        } catch {
          /* a frame mid-resize can fail the readback; keep the last verdict */
        }
      }
      const source = { width: v.videoWidth, height: v.videoHeight };
      if (!side) {
        const size = { width: opts.guideCanvas.clientWidth || opts.guideCanvas.width, height: opts.guideCanvas.clientHeight || opts.guideCanvas.height };
        const sizeKey = `${source.width}:${source.height}:${size.width}:${size.height}`;
        if (frontFitSize !== sizeKey) {
          // Start from a full source view and ease toward the face. Even the
          // first detector result must not snap the preview into a close-up.
          frontFit = fitFrontPreview(source, size, null);
          frontTarget = frontFit;
          frontFitAt = now;
          frontFitSize = sizeKey;
        }
        frontSource = source;
        frontViewport = size;
        const bounds = lm ? faceBounds(lm) : null;
        if (bounds) lastFaceAt = now;
        // Brief tracking loss does not zoom out and back on every blink.
        // Reduced-motion keeps the initial source view stationary.
        if (bounds || !frontFit || now - lastFaceAt > 1200) {
          const target = fitFrontPreview(source, size, bounds);
          frontTarget = stableFrontPreviewTarget(frontTarget, target, source);
        }
      }
      const check = side
        ? checkSideFrame(result, stats)
        : checkFrame(result, stats, source, glasses);
      opts.onCheck(check);
      if (!live) return;
      if (side) drawGuide(opts.guideCanvas, v);
      cadence.measured(ts, performance.now());
    }
    // Smooth at display cadence, not at the detector's ten reads per second.
    // Video and its debug mapping always use the identical interpolated fit.
    if (!side && frontTarget && frontSource && frontViewport) {
      if (!framingLocked) frontFit = settleFrontPreview(frontFit, frontTarget, now - frontFitAt, reducedMotion);
      frontFitAt = now;
      if (frontFit) {
        applyFrontFit(v, frontSource, frontViewport, frontFit, facing === "environment");
        drawGuide(opts.guideCanvas, v, frontFit);
      }
    }
    if (!staleReported && now - lastFrameAt > STALE_FRAME_MS) {
      staleReported = true;
      opts.onPause?.();
    }
    if (
      live &&
      !reacquiring &&
      isAppForeground() &&
      now - Math.max(lastFrameAt, watchdogGraceAt) > STALL_MS
    ) {
      // Reset the clock before the attempt so a slow reacquire does not
      // retrigger itself every frame.
      watchdogGraceAt = now;
      void reacquire();
    }
  };

  const loop = (now: number) => {
    activeLoopClockAt = performance.now();
    try {
      previewFrame(now);
    } finally {
      // This allowance belongs only to this synchronous preview callback.
      // Later shutter attempts must observe the source clock again.
      activeLoopClockAt = null;
    }
  };

  previewLoop = createPreviewLoop(loop);
  if (isAppForeground()) previewLoop.resume();

  return {
    stop,
    capture() {
      if (!live || !isAppForeground() || !stream || opts.video.srcObject !== stream) return null;
      const v = opts.video;
      const track = stream.getVideoTracks()[0];
      if (v.readyState < 2 || !v.videoWidth || !v.videoHeight || !Number.isFinite(v.currentTime) || !track || track.readyState !== "live" || track.muted) return null;
      // HTML keeps currentTime's official playback position stable while a
      // script runs. An onCheck shutter after slow synchronous inference must
      // judge the source observation at this task's entry, not count detector
      // CPU time as a frozen camera. A subsequent task gets no such allowance:
      // it checks the current source clock, and unchanged clocks never refresh.
      const capturedAt = activeLoopClockAt ?? performance.now();
      observeFrame(capturedAt);
      if (capturedAt - lastFrameAt > STALE_FRAME_MS) return null;
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
    setFramingLocked(locked) { framingLocked = locked; },
    async swap() {
      if (!live || !isAppForeground() || attaching) return false;
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
        if (live) {
          try {
            await attach();
          } catch {
            // Restoring a camera can fail for one scheduling tick after the OS
            // releases the attempted replacement. Retry while the preview is
            // visible so a failed swap cannot leave a dead rectangle waiting
            // for an unrelated tab switch.
            reacquireRetries = 0;
            scheduleReacquire();
          }
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
export interface Mapper {
  (nx: number, ny: number): { x: number; y: number };
  dw: number;
  dh: number;
}

export function frontPreviewMap(source: SourceFrame, fit: PreviewFit): Mapper {
  const dw = source.width * fit.scale;
  const dh = source.height * fit.scale;
  const f = ((nx: number, ny: number) => ({ x: fit.x + nx * dw, y: fit.y + ny * dh })) as Mapper;
  f.dw = dw;
  f.dh = dh;
  return f;
}

export function applyFrontFit(video: HTMLVideoElement, source: SourceFrame, viewport: SourceFrame, fit: PreviewFit, unmirrored: boolean): void {
  // The source-aspect rectangle is transformed once on the compositor. No
  // canvas copies, source resampling, hardware zoom or per-frame layout sizes.
  const style = video.style;
  if (!style) return;
  const width = `${source.width}px`;
  const height = `${source.height}px`;
  if (style.width !== width || style.height !== height) {
    style.width = width;
    style.height = height;
    style.inset = "auto";
    style.left = "0";
    style.top = "0";
    style.objectFit = "fill";
    style.transformOrigin = "0 0";
  }
  // Mirror about the viewport, not the moved video's own origin. The guide
  // canvas mirrors about this same viewport through its existing CSS class.
  const x = unmirrored ? fit.x : viewport.width - fit.x;
  style.transform = `matrix(${unmirrored ? fit.scale : -fit.scale}, 0, 0, ${fit.scale}, ${x}, ${fit.y})`;
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
function drawGuide(canvas: HTMLCanvasElement, video: HTMLVideoElement, frontFit: PreviewFit | null = null): void {
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.round(w * dpr);
  const height = Math.round(h * dpr);
  const resized = canvas.width !== width || canvas.height !== height;
  if (resized) {
    canvas.width = width;
    canvas.height = height;
  }
  // The normal guide is intentionally empty. Resizing clears it; repeating
  // a full high-DPI canvas clear on every camera frame only spends GPU work.
  if (!DEBUG) return;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const P = frontFit ? frontPreviewMap({ width: video.videoWidth, height: video.videoHeight }, frontFit) : coverMap(video, w, h);
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
