import { SIDE_PLACEMENT_DEFAULT_TIMEOUT_MS } from "./sidePlacementRequest.js";
import type { SideReviewMode } from "./sideCaptureRecovery.js";

export type SideCloudAttempt<T> =
  | { status: "success"; placement: T }
  | { status: "disabled" | "unavailable" | "cancelled"; placement: null };

/** An admin deadline covers authentication and placement together. */
export async function runSideCloudAttempt<T>(input: {
  enabled: boolean;
  mode: SideReviewMode;
  signal: AbortSignal;
  getAccessToken: () => Promise<string | null>;
  request: (token: string, signal: AbortSignal) => Promise<T | null>;
  timeoutMs?: number;
}): Promise<SideCloudAttempt<T>> {
  // A device-only choice must not wait for a session refresh or auth lock.
  if (!input.enabled) return { status: "disabled", placement: null };
  if (input.signal.aborted) return { status: "cancelled", placement: null };

  const calibration = input.mode === "calibration";
  const local = new AbortController();
  const unavailable = (): SideCloudAttempt<T> => ({ status: "unavailable", placement: null });
  const interrupted = (): SideCloudAttempt<T> => input.signal.aborted
    ? { status: "cancelled", placement: null }
    : unavailable();
  let resolveStopped!: (value: SideCloudAttempt<T>) => void;
  const stopped = new Promise<SideCloudAttempt<T>>((resolve) => { resolveStopped = resolve; });
  const cancel = () => {
    local.abort();
    resolveStopped(interrupted());
  };
  input.signal.addEventListener("abort", cancel, { once: true });
  const timer = calibration ? setTimeout(() => {
    local.abort();
    resolveStopped(unavailable());
  }, input.timeoutMs ?? SIDE_PLACEMENT_DEFAULT_TIMEOUT_MS) : undefined;

  const work = async (): Promise<SideCloudAttempt<T>> => {
    const token = await input.getAccessToken().catch(() => null);
    // A late token must not upload a photo after timeout, retake or cancellation.
    if (local.signal.aborted) return interrupted();
    if (!token) return unavailable();
    const placement = await input.request(token, local.signal);
    if (local.signal.aborted) return interrupted();
    return placement === null ? unavailable() : { status: "success", placement };
  };
  try {
    return await Promise.race([work(), stopped]);
  } catch (error) {
    if (!calibration) throw error;
    return input.signal.aborted ? interrupted() : unavailable();
  } finally {
    clearTimeout(timer);
    input.signal.removeEventListener("abort", cancel);
  }
}
