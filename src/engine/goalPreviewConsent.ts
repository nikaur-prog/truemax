// The Goal preview consent, as one string shared by the client and the
// server, so the dialog, the route and the migration's check constraint
// cannot drift apart. Its own version, never merged with the cloud-pass
// choice or the feedback consent: agreeing to one is never agreeing to
// another (docs/FACIAL_MORPH_PLAN.md, section 5a).
export const GOAL_PREVIEW_CONSENT_VERSION = "goal-preview-v1";

/** The caption every rendered preview carries, in its pixels and beside it. */
export const GOAL_PREVIEW_CAPTION = "A synthetic visual direction based on your selected goals, not a forecast.";

export interface GoalPreviewConsentState {
  granted: boolean;
  version: typeof GOAL_PREVIEW_CONSENT_VERSION;
  grantedAt: string | null;
}

export interface GoalPreviewConsentResult {
  ok: boolean;
  state?: GoalPreviewConsentState;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stateFrom(value: unknown): GoalPreviewConsentState | null {
  if (!isRecord(value) || typeof value.granted !== "boolean") return null;
  if (value.version !== GOAL_PREVIEW_CONSENT_VERSION) return null;
  if (value.grantedAt !== null && typeof value.grantedAt !== "string") return null;
  return {
    granted: value.granted,
    version: GOAL_PREVIEW_CONSENT_VERSION,
    grantedAt: value.grantedAt as string | null,
  };
}

async function consentRequest(
  accessToken: string,
  method: "GET" | "PUT" | "DELETE",
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<GoalPreviewConsentResult> {
  if (!accessToken.trim()) return { ok: false, error: "Sign in again to manage Goal preview." };
  const response = await fetcher("/api/goal-preview-consent", {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(method === "PUT" ? { "content-type": "application/json" } : {}),
    },
    ...(method === "PUT" ? { body: JSON.stringify({ version: GOAL_PREVIEW_CONSENT_VERSION }) } : {}),
    signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      ok: false,
      error: isRecord(payload) && typeof payload.error === "string"
        ? payload.error.slice(0, 240)
        : "Goal preview consent could not be updated.",
    };
  }
  const state = stateFrom(payload);
  if (state) return { ok: true, state };
  if (method === "DELETE" && isRecord(payload) && payload.granted === false) {
    return {
      ok: true,
      state: { granted: false, version: GOAL_PREVIEW_CONSENT_VERSION, grantedAt: null },
    };
  }
  if (method === "PUT" && isRecord(payload) && payload.granted === true) {
    return {
      ok: true,
      state: { granted: true, version: GOAL_PREVIEW_CONSENT_VERSION, grantedAt: null },
    };
  }
  return { ok: false, error: "Goal preview consent returned an invalid response." };
}

export function readGoalPreviewConsent(
  accessToken: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<GoalPreviewConsentResult> {
  return consentRequest(accessToken, "GET", signal, fetcher);
}

export function grantGoalPreviewConsent(
  accessToken: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<GoalPreviewConsentResult> {
  return consentRequest(accessToken, "PUT", signal, fetcher);
}

export function revokeGoalPreviewConsent(
  accessToken: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<GoalPreviewConsentResult> {
  return consentRequest(accessToken, "DELETE", signal, fetcher);
}
