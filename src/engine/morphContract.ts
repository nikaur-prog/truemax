import type { MorphBlueprint } from "./morphPlan.js";

export interface MorphRenderSource {
  front: string;
  side?: string;
}

export interface MorphRenderRequest {
  version: 1;
  variant: MorphBlueprint["variant"];
  source: MorphRenderSource;
  blueprint: MorphBlueprint;
  privacy: {
    purpose: "goal-preview";
    retainSource: false;
  };
}

export interface MorphRenderValidation {
  identityPreserved: true;
  naturalOnly: true;
  targetAligned: true;
  crossViewConsistent: true;
  moderationPassed: true;
}

export type MorphRenderState =
  | { status: "accepted" | "processing"; jobId: string }
  | {
      status: "ready";
      jobId: string;
      images: MorphRenderSource;
      validation: MorphRenderValidation;
    }
  | { status: "failed"; jobId?: string; error: string };

const MAX_IMAGE_CHARS = 16_000_000;
const SAFE_IMAGE = /^data:image\/(?:jpeg|webp);base64,[a-z0-9+/=]+$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeImage(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_IMAGE_CHARS && SAFE_IMAGE.test(value);
}

function jobId(value: unknown): string | null {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{8,128}$/.test(value) ? value : null;
}

export function createMorphRenderRequest(
  blueprint: MorphBlueprint,
  source: MorphRenderSource,
): MorphRenderRequest {
  if (!safeImage(source.front)) throw new Error("The front photograph could not be prepared safely.");
  if (blueprint.hasSide && !safeImage(source.side)) {
    throw new Error("The profile photograph could not be prepared safely.");
  }
  return {
    version: 1,
    variant: blueprint.variant,
    source: { front: source.front, ...(source.side ? { side: source.side } : {}) },
    blueprint,
    privacy: { purpose: "goal-preview", retainSource: false },
  };
}

/**
 * Treat renderer output as untrusted. A result is displayable only when it is
 * a safe in-memory image and every product gate has passed. The renderer may
 * return a beautiful face; that alone does not make it an honest preview.
 */
export function parseMorphRenderState(value: unknown, expectSide: boolean): MorphRenderState {
  if (!isRecord(value) || typeof value.status !== "string") {
    return { status: "failed", error: "The preview service returned an invalid response." };
  }

  if (value.status === "accepted" || value.status === "processing") {
    const id = jobId(value.jobId);
    return id
      ? { status: value.status, jobId: id }
      : { status: "failed", error: "The preview service returned an invalid job." };
  }

  if (value.status === "failed") {
    const id = jobId(value.jobId) ?? undefined;
    const message = typeof value.error === "string" && value.error.trim()
      ? value.error.trim().slice(0, 240)
      : "The preview could not be created.";
    return { status: "failed", ...(id ? { jobId: id } : {}), error: message };
  }

  if (value.status !== "ready" || !isRecord(value.images) || !isRecord(value.validation)) {
    return { status: "failed", error: "The preview service returned an invalid response." };
  }

  const id = jobId(value.jobId);
  const front = value.images.front;
  const side = value.images.side;
  const validation = value.validation;
  const passed =
    validation.identityPreserved === true &&
    validation.naturalOnly === true &&
    validation.targetAligned === true &&
    validation.crossViewConsistent === true &&
    validation.moderationPassed === true;

  if (!id || !safeImage(front) || (expectSide && !safeImage(side)) || !passed) {
    return { status: "failed", error: "The preview did not pass TrueMax validation." };
  }

  return {
    status: "ready",
    jobId: id,
    images: { front, ...(safeImage(side) ? { side } : {}) },
    validation: {
      identityPreserved: true,
      naturalOnly: true,
      targetAligned: true,
      crossViewConsistent: true,
      moderationPassed: true,
    },
  };
}

export async function requestMorphRender(
  request: MorphRenderRequest,
  accessToken: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<MorphRenderState> {
  if (!accessToken.trim()) return { status: "failed", error: "Sign in again to create this preview." };
  const response = await fetcher("/api/morph-preview", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
    signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === "string"
      ? payload.error.slice(0, 240)
      : "The preview service could not be reached.";
    return { status: "failed", error: message };
  }
  return parseMorphRenderState(payload, request.blueprint.hasSide);
}

export async function pollMorphRender(
  jobIdValue: string,
  expectSide: boolean,
  accessToken: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<MorphRenderState> {
  const id = jobId(jobIdValue);
  if (!id) return { status: "failed", error: "The preview job was invalid." };
  const response = await fetcher(`/api/morph-preview?job=${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === "string"
      ? payload.error.slice(0, 240)
      : "The preview service could not be reached.";
    return { status: "failed", jobId: id, error: message };
  }
  return parseMorphRenderState(payload, expectSide);
}
