import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import type { FaceLandmarkerResult } from "@mediapipe/tasks-vision";

// One landmarker instance, switched between modes rather than loading the
// model twice: IMAGE for the actual scan (deterministic — a given photo always
// yields identical landmarks) and VIDEO for the live camera guidance loop,
// which needs temporal smoothing and per-frame timestamps.
let landmarker: FaceLandmarker | null = null;
let mode: "IMAGE" | "VIDEO" = "IMAGE";

// Detection confidence differs by mode, on purpose.
//
// The live camera is lenient: a face lit from behind — a window at someone's
// back, the most common selfie setup there is — sits right on MediaPipe's 0.5
// default and drops in and out, which reads as "the app can't see me". Being
// generous there costs nothing, because the capture gates still refuse the
// shutter until the frame is genuinely good, so a weak detection produces
// guidance rather than a bad scan.
//
// The SCAN stays strict. Relaxing it there is not free: a marginal detection
// yields marginal landmarks, and running the population set at 0.3 moved
// measured scores across the board (p25 4.5 → 4.3, top 8.1 → 7.9) because the
// detector settled on slightly different boxes. The measurement path is
// calibrated against those numbers, so it keeps the defaults.
const STRICT = {
  minFaceDetectionConfidence: 0.5,
  minFacePresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
};
const LENIENT = {
  minFaceDetectionConfidence: 0.3,
  minFacePresenceConfidence: 0.3,
  minTrackingConfidence: 0.3,
};

// The boot in flight, or the one already finished.
//
// This used to run exactly once because exactly one caller called it, at module
// load. Now that it is started on intent — a thumb landing on "Use camera", a
// file dropped on the page, a paste — it can be asked for several times in the
// same second, and each of those calls used to build a SECOND landmarker over
// the top of the first: two eleven-megabyte WASM instances, two model loads,
// and whichever finished last winning the module-level variable.
//
// Sharing the promise makes every later caller await the first boot instead.
// A failed boot clears it, so a retry after a dropped connection is a real
// retry rather than a permanently poisoned promise.
let booting: Promise<void> | null = null;

export function initLandmarker(): Promise<void> {
  if (!booting) {
    booting = boot().catch((err: unknown) => {
      booting = null;
      throw err;
    });
  }
  return booting;
}

async function boot(): Promise<void> {
  const fileset = await FilesetResolver.forVisionTasks("/wasm");
  landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: "/models/face_landmarker.task",
      delegate: "CPU",
    },
    runningMode: "IMAGE",
    numFaces: 1,
    outputFacialTransformationMatrixes: true,
    outputFaceBlendshapes: true,
    ...STRICT,
  });
  mode = "IMAGE";
}

export function isReady(): boolean {
  return landmarker !== null;
}

export async function setRunningMode(next: "IMAGE" | "VIDEO"): Promise<void> {
  if (!landmarker || mode === next) return;
  await landmarker.setOptions({ runningMode: next, ...(next === "VIDEO" ? LENIENT : STRICT) });
  mode = next;
}

export function detect(image: HTMLImageElement | HTMLCanvasElement): FaceLandmarkerResult {
  if (!landmarker) throw new Error("Landmarker not initialized");
  if (mode !== "IMAGE") throw new Error("Landmarker is in VIDEO mode");
  return landmarker.detect(image);
}

export function detectVideo(video: HTMLVideoElement, timestampMs: number): FaceLandmarkerResult | null {
  if (!landmarker || mode !== "VIDEO") return null;
  return landmarker.detectForVideo(video, timestampMs);
}
