import { SIDE_POINTS } from "../engine/sideMetrics.js";
import type { SidePointId, SidePoints } from "../engine/sideMetrics.js";

const CHOICE_KEY = "truemax:side-cloud-placement:v1";
const MAX_UPLOAD_BYTES = 2_000_000;

export type SidePlacementChoice = "cloud" | "device";

export interface CloudSidePlacement {
  points: SidePoints;
  faceDir: 1 | -1;
  confidence: number;
  confidenceByPoint: Record<SidePointId, number>;
  seedVersion?: string;
}

export function readSidePlacementChoice(): SidePlacementChoice | null {
  try {
    const value = localStorage.getItem(CHOICE_KEY);
    return value === "cloud" || value === "device" ? value : null;
  } catch {
    return null;
  }
}

export function storeSidePlacementChoice(choice: SidePlacementChoice): void {
  try {
    localStorage.setItem(CHOICE_KEY, choice);
  } catch {
    // A blocked storage API means the question will be asked again next time.
  }
}

export function clearSidePlacementChoice(): void {
  try {
    localStorage.removeItem(CHOICE_KEY);
  } catch {
    // Nothing was persisted, so there is nothing to clear.
  }
}

/**
 * Convert the endpoint's fractional coordinates into this canvas' pixel space.
 * Strict validation makes a partial cloud response a fallback, never a partly
 * cloud and partly guessed placement.
 */
export function parseCloudSidePlacement(
  value: unknown,
  width: number,
  height: number,
): CloudSidePlacement | null {
  if (!value || typeof value !== "object" || !(width > 0) || !(height > 0)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.faceDir !== 1 && raw.faceDir !== -1) return null;
  if (!raw.points || typeof raw.points !== "object") return null;
  if (!raw.confidence || typeof raw.confidence !== "object") return null;

  const fractions = raw.points as Record<string, unknown>;
  const rawConfidence = raw.confidence as Record<string, unknown>;
  const points = {} as SidePoints;
  const confidenceByPoint = {} as Record<SidePointId, number>;
  let totalConfidence = 0;

  for (const { id } of SIDE_POINTS) {
    const point = fractions[id];
    if (!point || typeof point !== "object") return null;
    const p = point as Record<string, unknown>;
    if (!fraction(p.x) || !fraction(p.y)) return null;
    points[id] = { x: p.x * width, y: p.y * height };

    const confidence = rawConfidence[id];
    if (!fraction(confidence)) return null;
    confidenceByPoint[id] = confidence;
    totalConfidence += confidence;
  }

  const seedVersion = typeof raw.version === "string" && raw.version.length <= 80
    ? raw.version
    : undefined;
  return {
    points,
    faceDir: raw.faceDir,
    confidence: totalConfidence / SIDE_POINTS.length,
    confidenceByPoint,
    seedVersion,
  };
}

export async function requestCloudSidePlacement(
  canvas: HTMLCanvasElement,
  accessToken: string,
  timeoutMs = 5_000,
): Promise<CloudSidePlacement | null> {
  const photo = await jpegForPlacement(canvas);
  if (!photo || photo.size > MAX_UPLOAD_BYTES) return null;

  const body = new FormData();
  body.append("photo", photo, "side-profile.jpg");
  body.append("width", String(canvas.width));
  body.append("height", String(canvas.height));
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("/api/side-landmarks", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body,
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const value = await response.json().catch(() => null);
    return parseCloudSidePlacement(value, canvas.width, canvas.height);
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

function jpegForPlacement(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
}

function fraction(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}
