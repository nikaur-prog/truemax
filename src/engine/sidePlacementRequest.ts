/** The deployed function has 60 seconds, including auth, upload and cleanup. */
export const SIDE_PLACEMENT_SERVER_DURATION_MS = 60_000;
export const SIDE_PLACEMENT_MAX_TIMEOUT_MS = SIDE_PLACEMENT_SERVER_DURATION_MS - 5_000;
// Preserve the rollout's deadline until a held-out latency study supports a change.
export const SIDE_PLACEMENT_DEFAULT_TIMEOUT_MS = 5_000;
export const SIDE_PLACEMENT_RESPONSE_RESERVE_MS = 250;

/** Keep correction cohorts distinct when the same reader uses a different path. */
export function sidePlacementProtocolVersion(version: string, seeded: boolean): string {
  return `${version}.${seeded ? "seeded" : "full"}.e1`;
}

export function sidePlacementTimeoutMs(value: unknown): number {
  const parsed = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed <= 0) {
    return SIDE_PLACEMENT_DEFAULT_TIMEOUT_MS;
  }
  return Math.max(1, Math.min(SIDE_PLACEMENT_MAX_TIMEOUT_MS, Math.floor(parsed)));
}

/** One total deadline, not a fresh timeout for every crop/provider call. */
export function sidePlacementDeadline(timeoutMs: number, parent?: AbortSignal): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("Side placement deadline reached")), timeoutMs);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    },
  };
}
