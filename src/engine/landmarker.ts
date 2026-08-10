import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import type { FaceLandmarkerResult } from "@mediapipe/tasks-vision";

// One landmarker instance, switched between modes rather than loading the
// model twice: IMAGE for the actual scan (deterministic — a given photo always
// yields identical landmarks) and VIDEO for the live camera guidance loop,
// which needs temporal smoothing and per-frame timestamps.
let landmarker: FaceLandmarker | null = null;
let mode: "IMAGE" | "VIDEO" = "IMAGE";

export async function initLandmarker(): Promise<void> {
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
    // Below MediaPipe's 0.5 defaults. A face lit from behind — a window at
    // someone's back is the single most common selfie setup — sits right on
    // the default threshold and drops in and out, which reads as "the app
    // can't see me". Detecting a marginal face costs nothing here: the
    // capture gates still refuse to fire the shutter until the frame is
    // actually good, so a weak detection produces guidance, not a bad scan.
    minFaceDetectionConfidence: 0.3,
    minFacePresenceConfidence: 0.3,
    minTrackingConfidence: 0.3,
  });
  mode = "IMAGE";
}

export function isReady(): boolean {
  return landmarker !== null;
}

export async function setRunningMode(next: "IMAGE" | "VIDEO"): Promise<void> {
  if (!landmarker || mode === next) return;
  await landmarker.setOptions({ runningMode: next });
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
