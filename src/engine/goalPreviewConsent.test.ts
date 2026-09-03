import assert from "node:assert/strict";
import test from "node:test";
import {
  GOAL_PREVIEW_CONSENT_VERSION,
  grantGoalPreviewConsent,
  readGoalPreviewConsent,
  revokeGoalPreviewConsent,
} from "./goalPreviewConsent.js";

test("goal preview consent reads the current server state", async () => {
  const result = await readGoalPreviewConsent("token", undefined, (async (input, init) => {
    assert.equal(input, "/api/goal-preview-consent");
    assert.equal(init?.method, "GET");
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer token");
    return new Response(JSON.stringify({
      granted: true,
      version: GOAL_PREVIEW_CONSENT_VERSION,
      grantedAt: "2026-09-03T00:00:00.000Z",
    }), { status: 200 });
  }) as typeof fetch);
  assert.equal(result.ok, true);
  assert.equal(result.state?.granted, true);
});

test("grant sends the exact wording version", async () => {
  const result = await grantGoalPreviewConsent("token", undefined, (async (_input, init) => {
    assert.equal(init?.method, "PUT");
    assert.deepEqual(JSON.parse(String(init?.body)), { version: GOAL_PREVIEW_CONSENT_VERSION });
    return new Response(JSON.stringify({ granted: true, version: GOAL_PREVIEW_CONSENT_VERSION }), { status: 200 });
  }) as typeof fetch);
  assert.equal(result.state?.granted, true);
});

test("revoke maps a successful deletion to a revoked state", async () => {
  const result = await revokeGoalPreviewConsent("token", undefined, (async (_input, init) => {
    assert.equal(init?.method, "DELETE");
    return new Response(JSON.stringify({ granted: false, deleted: 2 }), { status: 200 });
  }) as typeof fetch);
  assert.deepEqual(result.state, {
    granted: false,
    version: GOAL_PREVIEW_CONSENT_VERSION,
    grantedAt: null,
  });
});
