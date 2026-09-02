import { currentAccessToken } from "./auth.js";
import type { SidePoints } from "./sideMetrics.js";
import { SIDE_FEEDBACK_CONSENT_VERSION } from "./sideFeedbackPayload.js";
import type { SideFeedbackIntent, SideFeedbackMetadata } from "./sideFeedbackPayload.js";

export interface SideFeedbackSubmitResult {
  ok: boolean;
  submissionId?: string;
  message?: string;
  /**
   * The server accepted the request and declined to store it, because this
   * account has hit its daily ceiling.
   *
   * Distinct from every other failure on purpose. A rate limit means "your
   * correction was fine, we already have enough from you today"; a network
   * failure means "we lost it, try again". Both used to print the same
   * "could not be sent" line, so somebody correcting a run of profiles saw
   * what looked like a broken upload and had no way to tell that the first
   * few had in fact landed.
   */
  rateLimited?: boolean;
}

export interface SharedSideFeedback {
  submissionId: string;
  scanId: string;
  createdAt: string;
  expiresAt: string;
  consentVersion: typeof SIDE_FEEDBACK_CONSENT_VERSION;
}

export interface SideFeedbackListResult {
  ok: boolean;
  submissions: SharedSideFeedback[];
  message?: string;
}

export interface SideFeedbackRevokeResult {
  ok: boolean;
  cleanupPending?: boolean;
  alreadyRemoved?: boolean;
  message?: string;
}

export async function listSideCorrectionFeedback(
  expectedUserId: string,
): Promise<SideFeedbackListResult> {
  const token = await currentAccessToken(expectedUserId);
  if (!token) {
    return { ok: false, submissions: [], message: "Sign in again to view shared feedback." };
  }

  try {
    const response = await fetch("/api/side-correction-feedback", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const result = await response.json().catch(() => ({})) as {
      submissions?: unknown;
      error?: string;
    };
    if (!response.ok) {
      return { ok: false, submissions: [], message: result.error || "Shared feedback could not be loaded." };
    }
    if (!Array.isArray(result.submissions) || !result.submissions.every(isSharedSideFeedback)) {
      return { ok: false, submissions: [], message: "Shared feedback could not be loaded." };
    }
    return { ok: true, submissions: result.submissions };
  } catch {
    return { ok: false, submissions: [], message: "Shared feedback could not be loaded." };
  }
}

export async function revokeSideCorrectionFeedback(
  expectedUserId: string,
  feedback: Pick<SharedSideFeedback, "submissionId" | "scanId">,
): Promise<SideFeedbackRevokeResult> {
  const token = await currentAccessToken(expectedUserId);
  if (!token) return { ok: false, message: "Sign in again before revoking feedback." };

  try {
    const response = await fetch("/api/side-correction-feedback", {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        submissionId: feedback.submissionId,
        scanId: feedback.scanId,
      }),
    });
    const result = await response.json().catch(() => ({})) as {
      revoked?: boolean;
      cleanupPending?: boolean;
      alreadyRemoved?: boolean;
      error?: string;
    };
    if (!response.ok || result.revoked !== true) {
      return { ok: false, message: result.error || "Feedback could not be revoked." };
    }
    return {
      ok: true,
      cleanupPending: result.cleanupPending === true,
      alreadyRemoved: result.alreadyRemoved === true,
    };
  } catch {
    return { ok: false, message: "Feedback could not be revoked. Try again." };
  }
}

export async function submitSideCorrectionFeedback(
  photo: HTMLCanvasElement,
  correctedPoints: SidePoints,
  faceDir: number,
  intent: SideFeedbackIntent,
): Promise<SideFeedbackSubmitResult> {
  const token = await currentAccessToken();
  if (!token) return { ok: false, message: "Sign in is required before sharing feedback." };

  const image = await canvasJpeg(photo);
  if (!image) return { ok: false, message: "The side photo could not be prepared." };

  const metadata: SideFeedbackMetadata = {
    scanId: intent.scanId,
    submissionId: intent.submissionId,
    consentVersion: intent.consentVersion,
    faceDir: faceDir === -1 ? -1 : 1,
    width: photo.width,
    height: photo.height,
    seedMethod: intent.seedMethod,
    seedVersion: intent.seedVersion,
    automaticPoints: intent.automaticPoints,
    correctedPoints,
  };
  const body = new FormData();
  body.append("metadata", JSON.stringify(metadata));
  body.append("photo", image, `${intent.submissionId}.jpg`);

  try {
    const response = await fetch("/api/side-correction-feedback", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body,
    });
    const result = await response.json().catch(() => ({})) as {
      submissionId?: string;
      error?: string;
    };
    if (!response.ok) {
      return {
        ok: false,
        rateLimited: response.status === 429,
        message: result.error || "Feedback could not be sent.",
      };
    }
    return { ok: true, submissionId: result.submissionId };
  } catch {
    // A thrown fetch is a network failure and nothing else — never a limit.
    return { ok: false, message: "Feedback could not be sent. Your analysis will continue." };
  }
}

function canvasJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.84));
}

function isSharedSideFeedback(value: unknown): value is SharedSideFeedback {
  if (!value || typeof value !== "object") return false;
  const feedback = value as Partial<SharedSideFeedback>;
  return uuid(feedback.submissionId)
    && uuid(feedback.scanId)
    && feedback.consentVersion === SIDE_FEEDBACK_CONSENT_VERSION
    && validDate(feedback.createdAt)
    && validDate(feedback.expiresAt);
}

function uuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
