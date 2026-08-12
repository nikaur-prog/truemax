import { currentAccessToken } from "./auth.ts";
import type { SidePoints } from "./sideMetrics.ts";
import type { SideFeedbackIntent, SideFeedbackMetadata } from "./sideFeedbackPayload.ts";

export interface SideFeedbackSubmitResult {
  ok: boolean;
  submissionId?: string;
  message?: string;
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
    submissionId: intent.submissionId,
    consentVersion: intent.consentVersion,
    faceDir: faceDir === -1 ? -1 : 1,
    width: photo.width,
    height: photo.height,
    seedMethod: intent.seedMethod,
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
    if (!response.ok) return { ok: false, message: result.error || "Feedback could not be sent." };
    return { ok: true, submissionId: result.submissionId };
  } catch {
    return { ok: false, message: "Feedback could not be sent. Your analysis will continue." };
  }
}

function canvasJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.84));
}
