import assert from "node:assert/strict";
import test from "node:test";
import { createSideFeedbackSubmitter } from "./sideFeedback.js";
import { createSideFeedbackIntent } from "./sideFeedbackPayload.js";
import { SIDE_POINTS } from "./sideMetrics.js";
import type { SidePoints } from "./sideMetrics.js";

function fixture() {
  const points = Object.fromEntries(SIDE_POINTS.map(({ id }) => [id, { x: 100, y: 200 }])) as SidePoints;
  const intent = createSideFeedbackIntent(true, "a42ad7cd-2285-4f0a-82f8-f075588101f8", "b42ad7cd-2285-4f0a-82f8-f075588101f9", points, "mesh", undefined, {
    verificationAnswer: "no", finalPlacementVerified: false,
  })!;
  intent.subjectConfirmation = "my-own-adult-face";
  return { points, intent, photo: { width: 400, height: 500 } as HTMLCanvasElement };
}

test("legacy or guest feedback intents never encode or upload without a fresh own-face declaration", async () => {
  const sample = fixture();
  delete sample.intent.subjectConfirmation;
  let calls = 0;
  const send = createSideFeedbackSubmitter({
    owner: () => "user:alice",
    token: async () => { calls++; return "test-token"; },
    encode: async () => { calls++; return new Blob(["fixture"]); },
    fetch: async () => { calls++; return Response.json({}); },
  });
  assert.equal((await send(sample.photo, sample.points, 1, sample.intent)).ok, false);
  assert.equal(calls, 0);
});

test("feedback snapshots ownership before auth and never encodes anonymous or cancelled requests", async () => {
  let authCalls = 0;
  let encodeCalls = 0;
  let owner: string | null = null;
  const send = createSideFeedbackSubmitter({
    owner: () => owner,
    token: async () => { authCalls++; return "test-token"; },
    encode: async () => { encodeCalls++; return null; },
    fetch: async () => { throw new Error("must not upload"); },
  });
  const { photo, points, intent } = fixture();
  assert.equal((await send(photo, points, 1, intent)).ok, false);
  owner = "anonymous:example";
  assert.equal((await send(photo, points, 1, intent)).ok, false);
  owner = "user:alice";
  const cancelled = new AbortController();
  cancelled.abort();
  assert.equal((await send(photo, points, 1, intent, { signal: cancelled.signal })).ok, false);
  assert.equal(authCalls, 0);
  assert.equal(encodeCalls, 0);
});

test("account changes during auth or JPEG prevent feedback upload", async () => {
  for (const changeAt of ["token", "encode"]) {
    let owner = "user:alice";
    let uploads = 0;
    const send = createSideFeedbackSubmitter({
      owner: () => owner,
      token: async (expected) => {
        assert.equal(expected, "alice");
        if (changeAt === "token") owner = "user:bob";
        return "test-token";
      },
      encode: async () => { owner = "user:bob"; return new Blob(["fixture"]); },
      fetch: async () => { uploads++; return Response.json({}); },
    });
    const { photo, points, intent } = fixture();
    assert.equal((await send(photo, points, 1, intent)).ok, false);
    assert.equal(uploads, 0);
  }
});

test("retake during encoding prevents upload and successful uploads keep immutable review metadata", async () => {
  const controller = new AbortController();
  const sample = fixture();
  let uploads = 0;
  const send = createSideFeedbackSubmitter({
    owner: () => "user:alice",
    token: async () => "test-token",
    encode: async () => { controller.abort(); return new Blob(["fixture"]); },
    fetch: async () => { uploads++; return Response.json({}); },
  });
  assert.equal((await send(sample.photo, sample.points, 1, sample.intent, { signal: controller.signal })).ok, false);
  assert.equal(uploads, 0);

  const next = new AbortController();
  const accepted = createSideFeedbackSubmitter({
    owner: () => "user:alice",
    token: async () => "test-token",
    encode: async () => {
      sample.intent.review!.finalPlacementVerified = true;
      sample.points.gonion.x = 300;
      return new Blob(["fixture"]);
    },
    fetch: async (_url, options) => {
      assert.equal(options?.signal, next.signal);
      const metadata = JSON.parse((options?.body as FormData).get("metadata") as string);
      assert.equal(metadata.review.finalPlacementVerified, false);
      assert.equal(metadata.subjectConfirmation, "my-own-adult-face");
      assert.equal(metadata.correctedPoints.gonion.x, 100);
      return Response.json({ submissionId: sample.intent.submissionId });
    },
  });
  assert.equal((await accepted(sample.photo, sample.points, 1, sample.intent, { signal: next.signal })).ok, true);
});

test("an account-switched response is ignored and interrupted auth cannot reject analysis", async () => {
  let owner = "user:alice";
  const send = createSideFeedbackSubmitter({
    owner: () => owner,
    token: async () => "test-token",
    encode: async () => new Blob(["fixture"]),
    fetch: async () => { owner = "user:bob"; return Response.json({ submissionId: "late" }); },
  });
  const { photo, points, intent } = fixture();
  assert.equal((await send(photo, points, 1, intent)).ok, false);
  const brokenAuth = createSideFeedbackSubmitter({
    owner: () => "user:alice",
    token: async () => { throw new Error("auth offline"); },
    encode: async () => null,
    fetch: async () => Response.json({}),
  });
  assert.equal((await brokenAuth(photo, points, 1, intent)).ok, false);
});
