import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { QualityCheck } from "./quality.js";
import type { SidePoints } from "./sideMetrics.js";
import type { SideFeedbackIntent, SideSeedMethod } from "./sideFeedbackPayload.js";
import { sideFeedbackIntentIssues } from "./sideFeedbackPayload.js";
import type { Sex } from "./types.js";

// OAuth and confirmation emails necessarily navigate away from the current
// page. Preserve a reduced copy of the completed capture on this device so the
// person does not lose two carefully framed photographs while making the
// account that reveals the result. These browser copies are accepted for only
// thirty minutes and removed as soon as analysis resumes (or on the next app
// open after expiry). Nothing is uploaded unless the person separately opted
// in to side-landmark feedback; in that case only the side copy is submitted.
const KEY = "truemax:pending-analysis:v1";
const MAX_AGE_MS = 30 * 60 * 1000;
const MAX_STORED_CHARS = 4_500_000;
const PHOTO_LONG_EDGE = 720;

export interface PendingAnalysis {
  version: 1;
  createdAt: number;
  sex: Sex;
  front: {
    landmarks: NormalizedLandmark[];
    width: number;
    height: number;
    quality: QualityCheck;
    autoNote: string;
    photo: string;
  };
  side: {
    points: SidePoints;
    faceDir: number;
    width: number;
    height: number;
    photo?: string;
    automaticPoints?: SidePoints;
    seedMethod?: SideSeedMethod;
    feedback?: SideFeedbackIntent;
  };
}

export interface PendingAnalysisInput {
  sex: Sex;
  front: Omit<PendingAnalysis["front"], "photo"> & { canvas: HTMLCanvasElement };
  side: Omit<PendingAnalysis["side"], "photo" | "width" | "height"> & { canvas?: HTMLCanvasElement };
}

export function savePendingAnalysis(input: PendingAnalysisInput): boolean {
  try {
    const frontPhoto = reducedJpeg(input.front.canvas);
    if (!frontPhoto) return false;
    const sidePhoto = input.side.canvas ? reducedJpeg(input.side.canvas) : null;
    const value: PendingAnalysis = {
      version: 1,
      createdAt: Date.now(),
      sex: input.sex,
      front: {
        landmarks: input.front.landmarks,
        width: input.front.width,
        height: input.front.height,
        quality: input.front.quality,
        autoNote: input.front.autoNote,
        photo: frontPhoto,
      },
      side: {
        points: input.side.points,
        faceDir: input.side.faceDir,
        width: input.side.canvas?.width ?? 1,
        height: input.side.canvas?.height ?? 1,
        photo: sidePhoto ?? undefined,
        automaticPoints: input.side.automaticPoints,
        seedMethod: input.side.seedMethod,
        feedback: input.side.feedback,
      },
    };
    const serialized = JSON.stringify(value);
    if (serialized.length > MAX_STORED_CHARS) return false;
    localStorage.setItem(KEY, serialized);
    return true;
  } catch {
    return false;
  }
}

export function readPendingAnalysis(): PendingAnalysis | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    if (raw.length > MAX_STORED_CHARS) {
      clearPendingAnalysis();
      return null;
    }
    const value = JSON.parse(raw) as Partial<PendingAnalysis>;
    if (!valid(value) || Date.now() - value.createdAt > MAX_AGE_MS) {
      clearPendingAnalysis();
      return null;
    }
    return value;
  } catch {
    clearPendingAnalysis();
    return null;
  }
}

export function clearPendingAnalysis(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Storage can disappear between calls in private browsing. Cleanup is
    // best-effort and must never block a result.
  }
}

export function drawStoredPhoto(
  canvas: HTMLCanvasElement,
  dataUrl: string,
  width: number,
  height: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")?.drawImage(image, 0, 0, width, height);
      resolve(true);
    };
    image.onerror = () => resolve(false);
    image.src = dataUrl;
  });
}

function reducedJpeg(source: HTMLCanvasElement): string | null {
  try {
    const scale = Math.min(1, PHOTO_LONG_EDGE / Math.max(source.width, source.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.78);
  } catch {
    return null;
  }
}

function valid(value: Partial<PendingAnalysis>): value is PendingAnalysis {
  const front = value.front;
  const side = value.side;
  return value.version === 1
    && typeof value.createdAt === "number"
    && (value.sex === "male" || value.sex === "female")
    && !!front
    && Array.isArray(front.landmarks)
    && front.landmarks.length >= 468
    && finiteSize(front.width, front.height)
    && typeof front.autoNote === "string"
    && jpeg(front.photo)
    && !!front.quality
    && !!side
    && (side.faceDir === 1 || side.faceDir === -1)
    && finiteSize(side.width, side.height)
    && !!side.points
    && (!side.photo || jpeg(side.photo))
    && (!side.feedback || (
      !!side.photo
      && !!side.automaticPoints
      && side.seedMethod === side.feedback.seedMethod
      && sideFeedbackIntentIssues(side.feedback, side.width, side.height).length === 0
    ));
}

function finiteSize(width: unknown, height: unknown): width is number {
  return typeof width === "number" && Number.isFinite(width) && width > 0 && width <= 4096
    && typeof height === "number" && Number.isFinite(height) && height > 0 && height <= 4096;
}

function jpeg(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:image/jpeg;base64,");
}
