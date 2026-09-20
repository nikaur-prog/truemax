import type { SideCloudFailureReason } from "../src/engine/sideCloudFailure.js";

/** Inspect errors in memory; only this allowlisted classification leaves here. */
export function providerPlacementFailureReason(error: unknown): SideCloudFailureReason {
  const raw = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const status = typeof raw.status === "number" ? raw.status : null;
  const message = typeof raw.message === "string" ? raw.message.toLowerCase() : "";
  if (message.includes("anthropic_api_key") && (message.includes("missing") || message.includes("no usable"))) return "provider-config";
  if (status === 401 || status === 403) return "provider-auth";
  if (status === 429) return "provider-rate-limit";
  if (status === 400 && (message.includes("credit balance") || message.includes("insufficient credit"))) return "provider-credit";
  return "provider-unavailable";
}
