import assert from "node:assert/strict";
import test from "node:test";
import { buildMorphBlueprint } from "./morphPlan.js";
import { EMPTY_PROFILE } from "./goals.js";
import { createMorphRenderRequest, parseMorphRenderState, requestMorphRender, submitMorphValidation } from "./morphContract.js";
import type { Report } from "./types.js";

const PIXEL = "data:image/webp;base64,UklGRg==";
const SCAN_ID = "123e4567-e89b-42d3-a456-426614174000";
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
  const request = createMorphRenderRequest(SCAN_ID, blueprint, { front: PIXEL, side: PIXEL });
  assert.deepEqual(request.privacy, { purpose: "goal-preview", retainSource: false });
  assert.equal(request.scanId, SCAN_ID);
  assert.equal(request.variant, "selected");
});

test("a two-view blueprint rejects a missing profile source", () => {
  const blueprint = buildMorphBlueprint(REPORT, EMPTY_PROFILE, "selected", true);
  assert.throws(() => createMorphRenderRequest(SCAN_ID, blueprint, { front: PIXEL }), /profile photograph/i);
});

test("a front-only request never transmits an unused side photograph", () => {
  const blueprint = buildMorphBlueprint(REPORT, EMPTY_PROFILE, "selected", false);
  assert.deepEqual(createMorphRenderRequest(SCAN_ID, blueprint, { front: PIXEL, side: PIXEL }).source, { front: PIXEL });
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

test("a server-checked render waits for the device instead of becoming a false failure", () => {
  const pending = ready({
    validation: {
      identityPreserved: false,
      naturalOnly: true,
      targetAligned: false,
      crossViewConsistent: true,
      moderationPassed: true,
    },
    pending: ["identityPreserved", "targetAligned"],
  });
  assert.equal(parseMorphRenderState(pending, true).status, "validation_pending");
});

test("nested pending gates and the legacy wire shape both wait for validation", () => {
  const gates = ["identityPreserved", "targetAligned"];
  const validation = {
    identityPreserved: false, targetAligned: false,
    naturalOnly: true, crossViewConsistent: true, moderationPassed: true,
  };
  for (const overrides of [
    { validation: { ...validation, pending: gates } },
    { validation, pending: gates },
    { validation: { ...validation, pending: gates }, pending: [...gates].reverse() },
  ]) assert.equal(parseMorphRenderState(ready(overrides), true).status, "validation_pending");
});

test("pending cannot rescue failed gates, unsafe images or conflicting incomplete lists", () => {
  const gates = ["identityPreserved", "targetAligned"];
  const validation = {
    identityPreserved: false, targetAligned: false,
    naturalOnly: true, crossViewConsistent: true, moderationPassed: true,
    pending: gates,
  };
  for (const badPending of [null, "identityPreserved", [], ["identityPreserved"], ["targetAligned"], [...gates, "unknown"], ["identityPreserved", "identityPreserved"]]) {
    assert.equal(parseMorphRenderState(ready({ validation: { ...validation, pending: badPending }, pending: gates }), true).status, "failed");
  }
  assert.equal(parseMorphRenderState(ready({ validation, pending: ["identityPreserved"] }), true).status, "failed");
  for (const gate of ["naturalOnly", "crossViewConsistent", "moderationPassed"]) {
    assert.equal(parseMorphRenderState(ready({ validation: { ...validation, [gate]: false } }), true).status, "failed");
  }
  assert.equal(parseMorphRenderState(ready({ validation: { ...validation, targetAligned: true } }), true).status, "failed");
  assert.equal(parseMorphRenderState(ready({ validation, images: { front: "https://example.invalid/face.jpg", side: PIXEL } }), true).status, "failed");
  assert.equal(parseMorphRenderState(ready({ validation, images: { front: PIXEL } }), true).status, "failed");
});

test("completed pixel checks cannot coexist with pending markers", () => {
  const validation = ready().validation as Record<string, unknown>;
  assert.equal(parseMorphRenderState(ready({ validation: { ...validation, pending: [] }, pending: [] }), true).status, "ready");
  for (const pending of [["identityPreserved", "targetAligned"], ["identityPreserved"], null, "", false]) {
    assert.equal(parseMorphRenderState(ready({ validation: { ...validation, pending } }), true).status, "failed");
    assert.equal(parseMorphRenderState(ready({ pending }), true).status, "failed");
  }
});

test("renderer output rejects remote URLs and missing paired views", () => {
  assert.equal(parseMorphRenderState(ready({ images: { front: "https://example.com/face.jpg", side: PIXEL } }), true).status, "failed");
  assert.equal(parseMorphRenderState(ready({ images: { front: PIXEL } }), true).status, "failed");
});

test("the request is authenticated and provider-neutral", async () => {
  const blueprint = buildMorphBlueprint(REPORT, EMPTY_PROFILE, "selected", false);
  const request = createMorphRenderRequest(SCAN_ID, blueprint, { front: PIXEL });
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

test("device validation is posted to the owning preview route", async () => {
  let path = "";
  let body = "";
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    path = String(input);
    body = String(init?.body ?? "");
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  const result = await submitMorphValidation("preview_12345678", true, "member-token", undefined, fetcher);
  assert.equal(result.ok, true);
  assert.equal(path, "/api/goal-preview?id=preview_12345678");
  assert.deepEqual(JSON.parse(body), { validation: { passed: true } });
});
