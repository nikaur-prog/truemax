import assert from "node:assert/strict";
import test from "node:test";
import { SIDE_POINTS } from "../engine/sideMetrics.js";
import { cloudSideSeedFractions, parseCloudSidePlacement, requestCloudSidePlacement } from "./sideCloudPlacement.js";
import type { SidePoints } from "../engine/sideMetrics.js";
import { sidePlacementTimeoutMs, SIDE_PLACEMENT_MAX_TIMEOUT_MS } from "../engine/sidePlacementRequest.js";

test("cloud side placement requires and scales all thirteen points", () => {
  const points = Object.fromEntries(SIDE_POINTS.map(({ id }, index) => [
    id,
    { x: 0.2 + index * 0.01, y: 0.1 + index * 0.02 },
  ]));
  const confidence = Object.fromEntries(SIDE_POINTS.map(({ id }, index) => [id, 0.4 + index * 0.04]));
  const result = parseCloudSidePlacement({ points, confidence, faceDir: 1, version: "pass-v2" }, 1_000, 500);

  assert.ok(result);
  assert.deepEqual(result.points.trichion, { x: 200, y: 50 });
  assert.equal(result.points.tragion.x, 320);
  assert.equal(result.faceDir, 1);
  assert.equal(result.seedVersion, "pass-v2");
  assert.ok(result.confidence > 0.6 && result.confidence < 0.7);
});

test("cloud side placement rejects partial, out-of-frame and incomplete-confidence results", () => {
  const points = Object.fromEntries(SIDE_POINTS.map(({ id }) => [id, { x: 0.5, y: 0.5 }]));
  const confidence = Object.fromEntries(SIDE_POINTS.map(({ id }) => [id, 0.8]));

  const partial = { ...points };
  delete partial.tragion;
  assert.equal(parseCloudSidePlacement({ points: partial, confidence, faceDir: 1 }, 500, 500), null);

  const outside = { ...points, pronasale: { x: 1.1, y: 0.5 } };
  assert.equal(parseCloudSidePlacement({ points: outside, confidence, faceDir: 1 }, 500, 500), null);

  const partialConfidence = { ...confidence };
  delete partialConfidence.gonion;
  assert.equal(parseCloudSidePlacement({ points, confidence: partialConfidence, faceDir: 1 }, 500, 500), null);
});

function fixture() {
  const points = Object.fromEntries(SIDE_POINTS.map(({ id }) => [id, { x: 200, y: 250 }])) as SidePoints;
  points.pronasale.x = 300;
  points.tragion.x = 100;
  return points;
}

function responseFixture() {
  return {
    points: cloudSideSeedFractions(fixture(), 400, 500), faceDir: 1,
    confidence: Object.fromEntries(SIDE_POINTS.map(({ id }) => [id, 0.7])),
  };
}

function canvas(encode?: (callback: BlobCallback) => void): HTMLCanvasElement {
  return {
    width: 400, height: 500,
    toBlob: encode ?? ((callback: BlobCallback) => callback(new Blob(["fixture"], { type: "image/jpeg" }))),
  } as HTMLCanvasElement;
}

test("seed fractions preserve the exact frame and facing instead of mirroring twice", () => {
  const points = fixture();
  const result = cloudSideSeedFractions(points, 400, 500, 1)!;
  assert.deepEqual(result.pronasale, { x: 0.75, y: 0.5 });
  points.pronasale.x = 250;
  assert.equal(result.pronasale.x, 0.75, "the request seed is an immutable snapshot");
  assert.equal(cloudSideSeedFractions(fixture(), 400, 500, -1), null);
  const mirrored = Object.fromEntries(Object.entries(fixture()).map(([id, p]) => [id, { ...p, x: 400 - p.x }])) as SidePoints;
  assert.equal(cloudSideSeedFractions(mirrored, 400, 500, -1)!.pronasale.x, 0.25);
  assert.equal(cloudSideSeedFractions({ ...fixture(), gonion: { x: Number.NaN, y: 100 } }, 400, 500), null);
  assert.equal(cloudSideSeedFractions({ ...fixture(), gonion: { x: 401, y: 100 } }, 400, 500), null);
  assert.equal(cloudSideSeedFractions({ ...fixture(), pronasale: fixture().tragion }, 400, 500), null);
  assert.equal(cloudSideSeedFractions(fixture(), Infinity, 500), null);
});

test("side request deadline stays conservative and bounded below the server duration", () => {
  for (const invalid of [undefined, null, "", Infinity, Number.NaN, 0, -50]) assert.equal(sidePlacementTimeoutMs(invalid), 5_000);
  assert.equal(sidePlacementTimeoutMs("12000"), 12_000);
  assert.equal(sidePlacementTimeoutMs(999_000), SIDE_PLACEMENT_MAX_TIMEOUT_MS);
});

test("cloud request sends the supported seed and parses into the original canvas dimensions", async (t) => {
  const image = canvas();
  t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, options?: RequestInit) => {
    const body = options!.body as FormData;
    assert.equal(body.get("width"), "400");
    assert.equal(body.get("height"), "500");
    assert.deepEqual(JSON.parse(body.get("seed") as string), responseFixture().points);
    assert.ok(Number(body.get("timeoutMs")) <= 5_000);
    image.width = 800;
    image.height = 1000;
    return Response.json(responseFixture());
  });
  const result = await requestCloudSidePlacement(image, "test-token", { seed: fixture(), faceDir: 1 });
  assert.deepEqual(result?.points.pronasale, { x: 300, y: 250 });
});

test("encoding, fetch and response decode share a total deadline", async (t) => {
  let encoded: BlobCallback | undefined;
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json(responseFixture()));
  assert.equal(await requestCloudSidePlacement(canvas((callback) => { encoded = callback; }), "test-token", 10), null);
  encoded!(new Blob(["late"]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(fetch.mock.callCount(), 0, "late encoding must not start a request");

  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: () => new Promise(() => {}) }) as Response);
  assert.equal(await requestCloudSidePlacement(canvas(), "test-token", 10), null, "stalled JSON must not hold the flow");
});

test("retake abort returns promptly and ignores a late successful response", async (t) => {
  const parent = new AbortController();
  let resolveResponse!: (response: Response) => void;
  let fetchSignal: AbortSignal | undefined;
  t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, options?: RequestInit) => {
    fetchSignal = options?.signal as AbortSignal;
    return new Promise<Response>((resolve) => { resolveResponse = resolve; });
  });
  const pending = requestCloudSidePlacement(canvas(), "test-token", { signal: parent.signal });
  await Promise.resolve();
  parent.abort();
  assert.equal(await pending, null);
  assert.equal(fetchSignal?.aborted, true);
  resolveResponse(Response.json(responseFixture()));
  assert.equal(await requestCloudSidePlacement(canvas(), "test-token", { signal: parent.signal }), null);
});

test("invalid seeds and empty auth never upload a photo", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json(responseFixture()));
  assert.equal(await requestCloudSidePlacement(canvas(), "test-token", { seed: { ...fixture(), gonion: { x: -1, y: 50 } } }), null);
  assert.equal(await requestCloudSidePlacement(canvas(), ""), null);
  assert.equal(fetch.mock.callCount(), 0);
});
