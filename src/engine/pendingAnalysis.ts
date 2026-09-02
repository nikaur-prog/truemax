import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { QualityCheck } from "./quality.js";
import type { SidePoints } from "./sideMetrics.js";
import type { SideFeedbackIntent, SideSeedMethod } from "./sideFeedbackPayload.js";
import { sideFeedbackIntentIssues } from "./sideFeedbackPayload.js";
import type { Sex } from "./types.js";
import { isScanId } from "./scanSession.js";

// OAuth and confirmation emails necessarily navigate away from the current
// page. Preserve a reduced copy of the completed capture on this device so the
// person does not lose two carefully framed photographs while making the
// account that reveals the result. These browser copies are accepted for only
// thirty minutes and removed as soon as analysis resumes (or on the next app
// open after expiry). Nothing is uploaded unless the person separately opted
// in to side-landmark feedback; in that case only the side copy is submitted.
const KEY = "truemax:pending-analysis:v2";
const LEGACY_KEY = "truemax:pending-analysis:v1";
const CLAIM_SESSION_KEY = "truemax:pending-analysis-claim:v2";
const CLAIM_QUERY_KEY = "scan_claim";
const MAX_AGE_MS = 30 * 60 * 1000;
const MAX_STORED_CHARS = 4_500_000;
const PHOTO_LONG_EDGE = 720;

export interface PendingAnalysis {
  version: 2;
  scanId: string;
  claimToken: string;
  claimedByUserId?: string;
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
    seedVersion?: string;
    feedback?: SideFeedbackIntent;
  };
}

export interface PendingAnalysisInput {
  scanId: string;
  sex: Sex;
  front: Omit<PendingAnalysis["front"], "photo"> & { canvas: HTMLCanvasElement };
  side: Omit<PendingAnalysis["side"], "photo" | "width" | "height"> & { canvas?: HTMLCanvasElement };
}

export function savePendingAnalysis(input: PendingAnalysisInput): boolean {
  try {
    if (!isScanId(input.scanId)) return false;
    const frontPhoto = reducedJpeg(input.front.canvas);
    if (!frontPhoto) return false;
    const sidePhoto = input.side.canvas ? reducedJpeg(input.side.canvas) : null;
    const claimToken = crypto.randomUUID();
    const value: PendingAnalysis = {
      version: 2,
      scanId: input.scanId,
      claimToken,
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
        seedVersion: input.side.seedVersion,
        feedback: input.side.feedback,
      },
    };
    const serialized = JSON.stringify(value);
    if (serialized.length > MAX_STORED_CHARS) return false;
    localStorage.setItem(KEY, serialized);
    sessionStorage.setItem(CLAIM_SESSION_KEY, claimToken);
    return true;
  } catch {
    return false;
  }
}

// Claim the anonymous scan for exactly one authenticated identity. A claim
// token must come from the tab that captured it or from the OAuth/email return
// URL. A random later account opening the same browser therefore cannot resume
// whatever happened to be left in the global pending slot.
export function claimPendingAnalysis(userId: string): PendingAnalysis | null {
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

    if (value.claimedByUserId) {
      return value.claimedByUserId === userId ? value : null;
    }

    const token = claimTokenFromBrowser();
    if (!token || token !== value.claimToken) return null;
    value.claimedByUserId = userId;
    localStorage.setItem(KEY, JSON.stringify(value));
    removeClaimFromUrl();
    return value;
  } catch {
    clearPendingAnalysis();
    return null;
  }
}

// Cleanup without exposing the payload. Called on app startup before an
// identity is known; returning the scan in that state would recreate the leak
// the claim boundary exists to prevent.
export function clearExpiredPendingAnalysis(): void {
  try {
    // Version 1 had no owner or claim token. It must be quarantined rather than
    // silently assigned to whichever account happens to sign in next.
    localStorage.removeItem(LEGACY_KEY);
    const raw = localStorage.getItem(KEY);
    if (!raw || raw.length > MAX_STORED_CHARS) {
      if (raw) clearPendingAnalysis();
      return;
    }
    const value = JSON.parse(raw) as Partial<PendingAnalysis>;
    if (!valid(value) || Date.now() - value.createdAt > MAX_AGE_MS) clearPendingAnalysis();
  } catch {
    clearPendingAnalysis();
  }
}

// Carry the one-time token across OAuth, confirmation-email, and magic-link
// navigation. Password login stays in the same tab and reads sessionStorage;
// redirect flows receive the same token in their approved return URL.
export function pendingAnalysisRedirect(base: string): string {
  try {
    const token = sessionStorage.getItem(CLAIM_SESSION_KEY);
    if (!token) return base;
    const url = new URL(base);
    url.searchParams.set(CLAIM_QUERY_KEY, token);
    return url.toString();
  } catch {
    return base;
  }
}

export function clearPendingAnalysis(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(LEGACY_KEY);
    sessionStorage.removeItem(CLAIM_SESSION_KEY);
    removeClaimFromUrl();
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
  return value.version === 2
    && isScanId(value.scanId)
    && uuid(value.claimToken)
    && (value.claimedByUserId === undefined || uuid(value.claimedByUserId))
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
      && side.seedVersion === side.feedback.seedVersion
      && sideFeedbackIntentIssues(side.feedback, side.width, side.height).length === 0
    ));
}

function claimTokenFromBrowser(): string | null {
  try {
    const query = typeof location === "undefined"
      ? null
      : new URLSearchParams(location.search).get(CLAIM_QUERY_KEY);
    return query || sessionStorage.getItem(CLAIM_SESSION_KEY);
  } catch {
    return null;
  }
}

function removeClaimFromUrl(): void {
  try {
    if (typeof location === "undefined" || typeof history === "undefined") return;
    const url = new URL(location.href);
    if (!url.searchParams.has(CLAIM_QUERY_KEY)) return;
    url.searchParams.delete(CLAIM_QUERY_KEY);
    history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // The claim is already bound in storage; URL cleanup is privacy polish and
    // never a reason to discard a valid result.
  }
}

function uuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function finiteSize(width: unknown, height: unknown): width is number {
  return typeof width === "number" && Number.isFinite(width) && width > 0 && width <= 4096
    && typeof height === "number" && Number.isFinite(height) && height > 0 && height <= 4096;
}

function jpeg(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:image/jpeg;base64,");
}
