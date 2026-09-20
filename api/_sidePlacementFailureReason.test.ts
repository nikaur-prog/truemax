import assert from "node:assert/strict";
import test from "node:test";
import { providerPlacementFailureReason } from "./_sidePlacementFailureReason.js";

test("provider failures are classified without returning free-form error details", () => {
  for (const [error, expected] of [
    [{ status: 400, message: "Your credit balance is too low to access this service" }, "provider-credit"],
    [{ status: 400, message: "insufficient credits: private-account" }, "provider-credit"],
    [{ status: 400, message: "unrelated validation error" }, "provider-unavailable"],
    [{ status: 401, message: "secret credential" }, "provider-auth"],
    [{ status: 403 }, "provider-auth"], [{ status: 429 }, "provider-rate-limit"],
    [new Error("Missing server environment variable: ANTHROPIC_API_KEY"), "provider-config"],
    [new Error("ANTHROPIC_API_KEY holds no usable characters"), "provider-config"],
    [null, "provider-unavailable"],
  ] as const) assert.equal(providerPlacementFailureReason(error), expected);
});
