import { SIDE_POINTS } from "../engine/sideMetrics.js";
import type { SidePointId, SidePoints } from "../engine/sideMetrics.js";
import { sidePlacementDeadline, sidePlacementTimeoutMs } from "../engine/sidePlacementRequest.js";

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

export interface CloudSidePlacementOptions {
  /** Pixels from the same upright, unmirrored snapshot, not a display overlay. */
  seed?: SidePoints;
  faceDir?: 1 | -1;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Invalid or geometrically collapsed seeds must not steer the crop pass. */
export function cloudSideSeedFractions(points: SidePoints, width: number, height: number, faceDir?: 1 | -1): SidePoints | null {
  if (!validDimension(width) || !validDimension(height)) return null;
  const fractions = {} as SidePoints;
  for (const { id } of SIDE_POINTS) {
    const point = points?.[id];
    if (!point || !fraction(point.x / width) || !fraction(point.y / height)) return null;
    fractions[id] = { x: point.x / width, y: point.y / height };
  }
  const noseEarSpread = fractions.pronasale.x - fractions.tragion.x;
  if (Math.abs(noseEarSpread) < 0.05) return null;
  if (faceDir !== undefined && Math.sign(noseEarSpread) !== faceDir) return null;
  return fractions;
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
  if (!value || typeof value !== "object" || !validDimension(width) || !validDimension(height)) return null;
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
  options: CloudSidePlacementOptions | number = {},
): Promise<CloudSidePlacement | null> {
  const config = typeof options === "number" ? { timeoutMs: options } : options;
  const width = canvas.width;
  const height = canvas.height;
  if (!accessToken || !validDimension(width) || !validDimension(height) || config.signal?.aborted) return null;
  // Snapshot coordinates before the first await. toBlob snapshots these pixels
  // when invoked; later retakes cannot rescale the response into a new frame.
  const seed = config.seed ? cloudSideSeedFractions(config.seed, width, height, config.faceDir) : null;
  if (config.seed && !seed) return null;
  const timeoutMs = sidePlacementTimeoutMs(config.timeoutMs);
  const startedAt = Date.now();
  const deadline = sidePlacementDeadline(timeoutMs, config.signal);
  let resolveCancelled!: (value: null) => void;
  const cancelled = new Promise<null>((resolve) => { resolveCancelled = resolve; });
  const cancel = () => resolveCancelled(null);
  deadline.signal.addEventListener("abort", cancel, { once: true });
  try {
    return await Promise.race([cancelled, (async () => {
      try {
        const photo = await jpegForPlacement(canvas);
        if (deadline.signal.aborted || !photo || photo.size > MAX_UPLOAD_BYTES) return null;
        const remaining = timeoutMs - (Date.now() - startedAt);
        if (remaining <= 0) return null;
        const body = new FormData();
        body.append("photo", photo, "side-profile.jpg");
        body.append("width", String(width));
        body.append("height", String(height));
        body.append("timeoutMs", String(remaining));
        if (seed) body.append("seed", JSON.stringify(seed));
        const response = await fetch("/api/side-landmarks", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
          body,
          signal: deadline.signal,
        });
        if (deadline.signal.aborted || !response.ok) return null;
        const value = await response.json();
        if (deadline.signal.aborted) return null;
        return parseCloudSidePlacement(value, width, height);
      } catch {
        return null;
      }
    })()]);
  } finally {
    deadline.signal.removeEventListener("abort", cancel);
    deadline.dispose();
  }
}

function jpegForPlacement(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
}

function fraction(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validDimension(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= 20_000;
}
