/** Fixed diagnostic codes only: never persist provider messages or photo data. */
export const SIDE_CLOUD_FAILURE_REASONS = [
  "auth-required", "auth-unavailable", "auth-timeout", "invalid-image", "invalid-seed",
  "encoding-failed", "image-too-large", "timeout", "network-error", "origin-rejected",
  "rate-limited", "provider-config", "provider-auth", "provider-credit", "provider-rate-limit",
  "provider-unavailable", "response-invalid", "allowance-unavailable", "server-unavailable",
  "request-unavailable",
] as const;

export type SideCloudFailureReason = typeof SIDE_CLOUD_FAILURE_REASONS[number];

export function sideCloudFailureReason(value: unknown): SideCloudFailureReason | undefined {
  return typeof value === "string" && (SIDE_CLOUD_FAILURE_REASONS as readonly string[]).includes(value)
    ? value as SideCloudFailureReason : undefined;
}

/** Old servers have no code. Keep a useful status fallback during mixed rollout. */
export function sideCloudHttpFailure(status: number, payload?: unknown): SideCloudFailureReason {
  const code = payload && typeof payload === "object"
    ? sideCloudFailureReason((payload as Record<string, unknown>).code) : undefined;
  if (code) return code;
  if (status === 401) return "auth-required";
  if (status === 403) return "origin-rejected";
  if (status === 408 || status === 504) return "timeout";
  if (status === 413) return "image-too-large";
  if (status === 429) return "rate-limited";
  if (status === 502 || status === 503) return "provider-unavailable";
  return "server-unavailable";
}
