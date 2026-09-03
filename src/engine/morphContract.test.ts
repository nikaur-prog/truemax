import assert from "node:assert/strict";
import test from "node:test";
import { buildMorphBlueprint } from "./morphPlan.js";
import { EMPTY_PROFILE } from "./goals.js";
import { createMorphRenderRequest, parseMorphRenderState, requestMorphRender } from "./morphContract.js";
import type { Report } from "./types.js";

const PIXEL = "data:image/webp;base64,UklGRg==";
const REPORT: Report = {
  sex: "male",
  overall: 5,
  overallPercentile: 50,
  overallZ: 0,
  potential: 5.5,
  pillars: { Harmony: 5, Angularity: 5, Dimorphism: 5, Features: 5 },
  regions: [],
  metrics: [],
  zScores: {},
};

function ready(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: "ready",
    jobId: "preview_12345678",
    images: { front: PIXEL, side: PIXEL },
    validation: {
      identityPreserved: true,
      naturalOnly: true,
      targetAligned: true,
      crossViewConsistent: true,
      moderationPassed: true,
    },
    ...overrides,
  };
}

test("a render request carries no retention permission", () => {
  const blueprint = buildMorphBlueprint(REPORT, { ...EMPTY_PROFILE, goals: ["skin"] }, "selected", true);
  const request = createMorphRenderRequest(blueprint, { front: PIXEL, side: PIXEL });
  assert.deepEqual(request.privacy, { purpose: "goal-preview", retainSource: false });
  assert.equal(request.variant, "selected");
});

test("a two-view blueprint rejects a missing profile source", () => {
  const blueprint = buildMorphBlueprint(REPORT, EMPTY_PROFILE, "selected", true);
  assert.throws(() => createMorphRenderRequest(blueprint, { front: PIXEL }), /profile photograph/i);
});

test("renderer output is withheld unless every validation gate passes", () => {
  const failed = ready({
    validation: {
      identityPreserved: false,
      naturalOnly: true,
      targetAligned: true,
      crossViewConsistent: true,
      moderationPassed: true,
    },
  });
  assert.equal(parseMorphRenderState(failed, true).status, "failed");
  assert.equal(parseMorphRenderState(ready(), true).status, "ready");
});

test("renderer output rejects remote URLs and missing paired views", () => {
  assert.equal(parseMorphRenderState(ready({ images: { front: "https://example.com/face.jpg", side: PIXEL } }), true).status, "failed");
  assert.equal(parseMorphRenderState(ready({ images: { front: PIXEL } }), true).status, "failed");
});

test("the request is authenticated and provider-neutral", async () => {
  const blueprint = buildMorphBlueprint(REPORT, EMPTY_PROFILE, "selected", false);
  const request = createMorphRenderRequest(blueprint, { front: PIXEL });
  let auth = "";
  let path = "";
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    path = String(input);
    auth = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(JSON.stringify(ready({ images: { front: PIXEL } })), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const response = await requestMorphRender(request, "member-token", undefined, fetcher);
  assert.equal(response.status, "ready");
  assert.equal(path, "/api/morph-preview");
  assert.equal(auth, "Bearer member-token");
  assert.doesNotMatch(JSON.stringify(request), /model|provider/i);
});
