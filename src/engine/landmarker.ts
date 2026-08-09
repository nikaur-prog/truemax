import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import type { FaceLandmarkerResult } from "@mediapipe/tasks-vision";

// IMAGE mode (not VIDEO) so a given photo always produces identical
// landmarks — the determinism requirement starts here.
let landmarker: FaceLandmarker | null = null;

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
  });
}

export function isReady(): boolean {
  return landmarker !== null;
}

export function detect(image: HTMLImageElement | HTMLCanvasElement): FaceLandmarkerResult {
  if (!landmarker) throw new Error("Landmarker not initialized");
  return landmarker.detect(image);
}
