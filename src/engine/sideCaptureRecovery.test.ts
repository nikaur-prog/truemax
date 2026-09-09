import assert from "node:assert/strict";
import test from "node:test";
import { SIDE_POINTS } from "./sideMetrics.js";
import type { SidePoints } from "./sideMetrics.js";
import { flipSideReviewPoints, recoverSideSeed, sideImageSize } from "./sideCaptureRecovery.js";
import type { RecoverableSideSeed } from "./sideCaptureRecovery.js";

const points = (): SidePoints => Object.fromEntries(SIDE_POINTS.map(({ id }, i) => [id, { x: 30 + i, y: 40 + i }])) as SidePoints;
const seed = (): RecoverableSideSeed => ({ points: points(), faceDir: 1, method: "mesh", confidence: 0.8 });
const template = (): RecoverableSideSeed => ({ points: points(), faceDir: 1, method: "silhouette", confidence: 0, templateFallback: true });
const input = () => ({ mode: "calibration" as const, signal: new AbortController().signal, prepare: async () => {}, read: async () => seed(), template });

test("decoded portrait and landscape dimensions are bounded without rejecting tiny but readable images", () => {
  assert.deepEqual(sideImageSize(4000, 3000), { width: 1400, height: 1050 });
  assert.deepEqual(sideImageSize(3000, 4000), { width: 1050, height: 1400 });
  assert.deepEqual(sideImageSize(1, 3000), { width: 1, height: 1400 });
  assert.deepEqual(sideImageSize(2, 1), { width: 2, height: 1 });
});

test("invalid dimensions remain a real image preparation failure", () => {
  for (const value of [0, -1, NaN, Infinity]) {
    assert.throws(() => sideImageSize(value, 600), /dimensions/);
    assert.throws(() => sideImageSize(600, value), /dimensions/);
  }
});

test("calibration still attempts automatic placement when detector preparation fails", async () => {
  let read = 0;
  const result = await recoverSideSeed({ ...input(), prepare: async () => { throw new Error("model unavailable"); }, read: async () => { read++; return seed(); } });
  assert.equal(read, 1);
  assert.equal(result.seed.method, "mesh");
  assert.deepEqual(result.diagnostics?.warnings, ["detector-unavailable"]);
  assert.equal(result.diagnostics?.templateFallback, false);
});

test("normal capture does not gain calibration's preparation bypass", async () => {
  let read = 0;
  await assert.rejects(recoverSideSeed({ ...input(), mode: undefined, prepare: async () => { throw new Error("model unavailable"); }, read: async () => { read++; return seed(); } }), /model unavailable/);
  assert.equal(read, 0);
});

test("a failed admin reader receives a zero-confidence template, not invented automatic evidence", async () => {
  const result = await recoverSideSeed({ ...input(), read: async () => { throw new Error("placement failed"); } });
  assert.equal(result.seed.confidence, 0);
  assert.equal(result.diagnostics?.templateFallback, true);
  assert.equal(result.diagnostics?.localAutomaticPoints, null);
  assert.equal(result.diagnostics?.localMethod, null);
  assert.deepEqual(result.diagnostics?.warnings, ["automatic-placement-failed"]);
});

test("template returned normally by the reader is still labelled as a template", async () => {
  const original = { ...template(), confidence: 0.75 };
  const result = await recoverSideSeed({ ...input(), read: async () => original });
  assert.equal(result.seed.confidence, 0);
  assert.equal(result.diagnostics?.templateFallback, true);
  assert.equal(result.diagnostics?.localConfidence, 0);
  assert.deepEqual(result.diagnostics?.localAutomaticPoints, original.points);
  assert.deepEqual(result.diagnostics?.warnings, [], "a template result does not invent a thrown model failure");
});

test("normal capture retains its reader failure rather than silently entering admin recovery", async () => {
  await assert.rejects(recoverSideSeed({ ...input(), mode: undefined, read: async () => { throw new Error("reader failed"); } }), /reader failed/);
});

test("an incomplete or non-finite automatic seed recovers before the point editor consumes it", async () => {
  const broken = seed();
  broken.points.gonion.x = NaN;
  const result = await recoverSideSeed({ ...input(), read: async () => broken });
  assert.equal(result.diagnostics?.templateFallback, true);
  for (const { id } of SIDE_POINTS) assert.ok(Number.isFinite(result.seed.points[id].x));
});

test("automatic provenance is an owned snapshot unaffected by point corrections or flips", async () => {
  const original = seed();
  const expected = structuredClone(original.points);
  const result = await recoverSideSeed({ ...input(), read: async () => original });
  const flipped = flipSideReviewPoints(result.seed.points, 400);
  result.seed.points.gonion.x = 999;
  assert.deepEqual(result.diagnostics?.localAutomaticPoints, expected);
  assert.equal(flipped.gonion.x, 400 - expected.gonion.x);
  assert.equal(flipped.gonion.y, expected.gonion.y);
  assert.deepEqual(flipSideReviewPoints(flipped, 400), expected);
});

test("normal successful capture has no calibration-only diagnostic record", async () => {
  const result = await recoverSideSeed({ ...input(), mode: undefined });
  assert.equal(result.diagnostics, undefined);
});

test("a hung admin reader reaches editable fallback within its bounded attempt", async () => {
  let readSignal: AbortSignal | undefined;
  const result = await recoverSideSeed({ ...input(), timeoutMs: 5, read: async (signal) => { readSignal = signal; return new Promise(() => {}); } });
  assert.equal(readSignal?.aborted, true);
  assert.equal(result.diagnostics?.templateFallback, true);
  assert.deepEqual(result.diagnostics?.warnings, ["automatic-placement-timeout"]);
});

test("cancelling a hung attempt never mounts a fallback for a retired photo", async () => {
  const controller = new AbortController();
  let templates = 0;
  const promise = recoverSideSeed({ ...input(), signal: controller.signal, read: async () => new Promise(() => {}), template: () => { templates++; return template(); } });
  controller.abort();
  await assert.rejects(promise, { name: "AbortError" });
  assert.equal(templates, 0);
});

test("an already-cancelled attempt neither reads nor invents a fallback", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(recoverSideSeed({ ...input(), signal: controller.signal, prepare: async () => { calls++; }, template: () => { calls++; return template(); } }), { name: "AbortError" });
  assert.equal(calls, 0);
});
