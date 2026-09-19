import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import {
  EVALUATION_CAPTURE_MAX_SIDE, deliveredEvaluationPoints, evaluationCacheMatches,
  evaluationFailureOutcome, evaluationFingerprint, evaluationHash, evaluationSettings,
  prepareEvaluationSource, runEvaluationAttempt,
} from "../../scripts/side-evaluation-protocol.js";
import type { EvaluationSource } from "../../scripts/side-evaluation-protocol.js";
import { SIDE_LANDMARK_IDS, SideLandmarkUnavailableError } from "../../api/_sideLandmarks.js";
import type { LandmarkPass } from "../../api/_sideLandmarks.js";
import { cloudSideSeedFractions } from "../ui/sideCloudPlacement.js";
import { sidePlacementEvidence } from "./sidePlacementEvidence.js";
import { fuseSideSeeds } from "./sideSeedFusion.js";
import type { SidePoints } from "./sideMetrics.js";

const colors = [[240, 20, 20], [20, 230, 20], [20, 20, 240], [230, 230, 20]];
async function quadrants(orientation: number): Promise<Buffer> {
  const width = 80, height = 40;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const color = colors[(y >= height / 2 ? 2 : 0) + (x >= width / 2 ? 1 : 0)];
    for (let c = 0; c < 3; c++) pixels[(y * width + x) * 3 + c] = color[c];
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 100, chromaSubsampling: "4:4:4" }).withMetadata({ orientation }).toBuffer();
}

function seed(frame: EvaluationSource["frame"]): SidePoints {
  const points = Object.fromEntries(SIDE_LANDMARK_IDS.map((id, i) => [id, { x: frame.w * 0.7, y: frame.h * (0.1 + i * 0.04) }])) as SidePoints;
  points.tragion = { x: frame.w * 0.3, y: frame.h * 0.4 };
  points.condylion = { x: frame.w * 0.31, y: frame.h * 0.4 };
  return points;
}

function pass(source: EvaluationSource): LandmarkPass {
  const hint = cloudSideSeedFractions(seed(source.frame), source.frame.w, source.frame.h)!;
  const evidence = sidePlacementEvidence("seed");
  evidence.tragion = "fine";
  hint.tragion.x += 0.01;
  return {
    result: { points: hint, faceDir: 1, confidence: Object.fromEntries(SIDE_LANDMARK_IDS.map((id) => [id, 0.8])) as LandmarkPass["result"]["confidence"], evidence },
    model: "test-reader", version: "test-protocol", usage: { inputTokens: 12, outputTokens: 7 }, calls: 1, attemptedCalls: 1,
    zoomed: ["tragion"], ms: 10, stages: {}, gonion: null, gonionDisagreement: null, mentonRetried: false, seeded: true, windows: {}, spread: {},
  };
}

const expectedCorners = [
  [0, 1, 2, 3], [1, 0, 3, 2], [3, 2, 1, 0], [2, 3, 0, 1],
  [0, 2, 1, 3], [2, 0, 3, 1], [3, 1, 2, 0], [1, 3, 0, 2],
];

for (let orientation = 1; orientation <= 8; orientation++) {
  test(`EXIF ${orientation}: actual upright pixels, mirrored corners and review coordinates agree`, async () => {
    const source = await prepareEvaluationSource(await quadrants(orientation));
    const swapped = orientation >= 5;
    assert.equal(source.width, swapped ? 40 : 80);
    assert.equal(source.height, swapped ? 80 : 40);
    assert.deepEqual(source.frame, { w: 640, h: swapped ? 1280 : 320 });
    assert.equal((await sharp(source.upright).metadata()).orientation, undefined);
    const { data, info } = await sharp(source.upright).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const corners = [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]].map(([x, y]) => {
      const at = (Math.floor(y * info.height) * info.width + Math.floor(x * info.width)) * info.channels;
      const distances = colors.map((rgb) => rgb.reduce((sum, value, c) => sum + (value - data[at + c]) ** 2, 0));
      return distances.indexOf(Math.min(...distances));
    });
    assert.deepEqual(corners, expectedCorners[orientation - 1]);
    const points = seed(source.frame);
    const hint = cloudSideSeedFractions(points, source.frame.w, source.frame.h)!;
    for (const id of SIDE_LANDMARK_IDS) {
      assert.ok(Math.abs(hint[id].x * source.frame.w - points[id].x) < 1e-10);
      assert.ok(Math.abs(hint[id].y * source.frame.h - points[id].y) < 1e-10);
    }
    const delivered = deliveredEvaluationPoints(points, pass(source).result, source.frame, "test-protocol", true);
    assert.equal(delivered.secondOpinion, true);
    assert.deepEqual(delivered.points.menton, points.menton);
    assert.ok(delivered.points.tragion.x > points.tragion.x);
  });
}

test("capture resizing materializes portrait and landscape geometry with the production bound", async () => {
  for (const [width, height] of [[2800, 1400], [1400, 2800]]) {
    const input = await sharp({ create: { width, height, channels: 3, background: "#fff" } }).png().toBuffer();
    const source = await prepareEvaluationSource(input);
    assert.equal(Math.max(source.width, source.height), EVALUATION_CAPTURE_MAX_SIDE);
    assert.equal(source.frame.h / source.frame.w, height / width);
  }
});

test("production settings stay seeded within 5s; slower or raw experiments are explicit diagnostic runs", () => {
  assert.deepEqual(evaluationSettings(), { mode: "production", delivery: "cloud", seeded: true, zoom: true, samples: 1, timeoutMs: 5000, responseReserveMs: 250 });
  for (const override of [{ seeded: false }, { zoom: false }, { samples: 2 }, { timeoutMs: 55000 }]) assert.throws(() => evaluationSettings(override), /diagnostic/);
  assert.equal(evaluationSettings({ mode: "diagnostic", seeded: false, zoom: false, samples: 3 }).timeoutMs, 55000);
  for (const invalid of [{ mode: "invalid" }, { delivery: "invalid" }, { mode: "diagnostic", samples: NaN }, { mode: "diagnostic", timeoutMs: 60000 }]) assert.throws(() => evaluationSettings(invalid));
});

test("cache identity hashes image bytes, canonical seed, reader and every protocol setting", () => {
  const bytes = Buffer.from("synthetic-image");
  const points = seed({ w: 640, h: 960 });
  const protocol = evaluationHash({ sources: { decoder: "source-a" }, reader: "private-reader-alias", settings: evaluationSettings() });
  const fingerprint = evaluationFingerprint(bytes, points, protocol);
  const cached = { fingerprint, runs: [{}] };
  assert.equal(evaluationCacheMatches(cached, fingerprint, 2), true);
  assert.equal(evaluationCacheMatches(cached, fingerprint, 3), false);
  assert.equal(evaluationCacheMatches({}, fingerprint), false);
  assert.equal(evaluationCacheMatches(null, fingerprint), false);
  const reordered = Object.fromEntries(Object.entries(points).reverse()) as SidePoints;
  assert.deepEqual(evaluationFingerprint(bytes, reordered, protocol), fingerprint);
  const changedSeed = structuredClone(points);
  changedSeed.gonion.x += 1;
  for (const next of [
    evaluationFingerprint(Buffer.from("new-image"), points, protocol),
    evaluationFingerprint(bytes, changedSeed, protocol),
    evaluationFingerprint(bytes, points, evaluationHash({ sources: { decoder: "source-b" }, reader: "private-reader-alias", settings: evaluationSettings() })),
    evaluationFingerprint(bytes, points, evaluationHash({ sources: { decoder: "source-a" }, reader: "other-reader-alias", settings: evaluationSettings() })),
    evaluationFingerprint(bytes, points, evaluationHash({ sources: { decoder: "source-a" }, reader: "private-reader-alias", settings: evaluationSettings({ mode: "diagnostic" }) })),
  ]) assert.equal(evaluationCacheMatches(cached, next), false);
  assert.throws(() => evaluationHash({ value: NaN }), /nonfinite/);
});

test("the replay uses prepared upright image, the shared response reserve, parser and unchanged fusion policy", async () => {
  const source = await prepareEvaluationSource(await quadrants(6));
  const points = seed(source.frame);
  const expected = pass(source);
  let deadlineMs = 0, disposed = 0;
  const controller = new AbortController();
  const run = await runEvaluationAttempt(source, points, evaluationSettings(), "test-protocol", {
    deadline: (ms) => { deadlineMs = ms; return { signal: controller.signal, dispose: () => { disposed++; } }; },
    read: async (image, hint, signal) => {
      assert.equal(signal, controller.signal);
      assert.equal(image.width, 40);
      assert.equal(image.height, 80);
      assert.equal((await sharp(image.plain).metadata()).orientation, undefined);
      assert.deepEqual(hint, cloudSideSeedFractions(points, 640, 1280));
      return expected;
    },
  });
  assert.equal(deadlineMs, 4750);
  assert.equal(disposed, 1);
  assert.equal(run.outcome, "success");
  const cloudPoints = Object.fromEntries(SIDE_LANDMARK_IDS.map((id) => [id, { x: expected.result.points[id].x * source.frame.w, y: expected.result.points[id].y * source.frame.h }])) as SidePoints;
  assert.deepEqual(run.delivered, fuseSideSeeds(points, cloudPoints, expected.result.confidence, undefined, expected.result.evidence));
  assert.deepEqual(run.usage, expected.usage);
});

test("signed-out and no-upload cohorts never encode or call a provider", async () => {
  const source = await prepareEvaluationSource(await quadrants(1));
  for (const delivery of ["signed_out", "device_choice"] as const) {
    const run = await runEvaluationAttempt(source, seed(source.frame), evaluationSettings({ delivery }), "test-protocol", {
      encode: async () => { throw new Error("must not encode"); },
      read: async () => { throw new Error("must not upload"); },
    });
    assert.equal(run.outcome, delivery);
    assert.equal(run.result, null);
    assert.equal(run.attemptedCalls, 0);
    assert.equal(run.delivered.secondOpinion, false);
    assert.deepEqual(run.delivered.points, seed(source.frame));
  }
});

test("fallback retains rate limit, refusal, unavailable and invalid-response outcomes without scoring a raw seed", async () => {
  const source = await prepareEvaluationSource(await quadrants(1));
  for (const [error, outcome] of [[{ status: 429 }, "rate_limited"], [{ code: "refusal" }, "refused"], [new SideLandmarkUnavailableError(), "unavailable"], [{ code: "invalid_response" }, "invalid_response"]] as const) {
    const run = await runEvaluationAttempt(source, seed(source.frame), evaluationSettings(), "test-protocol", {
      encode: async () => ({ plain: Buffer.alloc(0), width: source.width, height: source.height }),
      read: async () => { throw error; },
      metrics: () => ({ attemptedCalls: 5, calls: 2, usage: { inputTokens: 19, outputTokens: 11 } }),
    });
    assert.equal(run.outcome, outcome);
    assert.equal(run.result, null);
    assert.deepEqual(run.delivered.points, seed(source.frame));
    assert.equal(run.delivered.secondOpinion, false);
    assert.equal(run.attemptedCalls, 5);
    assert.equal(run.calls, 2);
    assert.deepEqual(run.usage, { inputTokens: 19, outputTokens: 11 });
  }
  assert.equal(evaluationFailureOutcome({ name: "AbortError" }), "timeout");
  assert.equal(evaluationFailureOutcome({ status: 408 }), "timeout");
});

test("inherited-only and malformed provider results cannot be successful delivered refinements", async () => {
  const source = await prepareEvaluationSource(await quadrants(1));
  for (const malformed of ["inherited", "missing-evidence", "coordinate", "confidence"] as const) {
    const output = pass(source);
    if (malformed === "inherited") output.result.evidence = sidePlacementEvidence("seed");
    if (malformed === "missing-evidence") delete (output.result as Partial<LandmarkPass["result"]>).evidence;
    if (malformed === "coordinate") output.result.points.tragion.x = 2;
    if (malformed === "confidence") output.result.confidence.tragion = NaN;
    const run = await runEvaluationAttempt(source, seed(source.frame), evaluationSettings(), "test-protocol", {
      encode: async () => ({ plain: Buffer.alloc(0), width: source.width, height: source.height }), read: async () => output,
    });
    assert.equal(run.outcome, "invalid_response");
    assert.equal(run.result, null);
    assert.equal(run.delivered.secondOpinion, false);
  }
});

test("encoding consumes the same deadline and cannot start a provider call after timeout", async () => {
  const source = await prepareEvaluationSource(await quadrants(1));
  let release!: () => void, calls = 0;
  const controller = new AbortController();
  const encoding = new Promise<void>((resolve) => { release = resolve; });
  const running = runEvaluationAttempt(source, seed(source.frame), evaluationSettings(), "test-protocol", {
    deadline: () => ({ signal: controller.signal, dispose: () => {} }),
    encode: async () => { await encoding; return { plain: Buffer.alloc(0), width: source.width, height: source.height }; },
    read: async () => { calls++; return pass(source); },
  });
  controller.abort();
  const run = await running;
  assert.equal(run.outcome, "timeout");
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 0);
});

test("a late provider completion cannot replace the delivered timeout fallback", async () => {
  const source = await prepareEvaluationSource(await quadrants(1));
  const controller = new AbortController();
  let release!: (value: LandmarkPass) => void, started!: () => void;
  const began = new Promise<void>((resolve) => { started = resolve; });
  const response = new Promise<LandmarkPass>((resolve) => { release = resolve; });
  const running = runEvaluationAttempt(source, seed(source.frame), evaluationSettings(), "test-protocol", {
    deadline: () => ({ signal: controller.signal, dispose: () => {} }),
    encode: async () => ({ plain: Buffer.alloc(0), width: source.width, height: source.height }),
    read: async (_image, _hint, signal) => { assert.equal(signal, controller.signal); started(); return response; },
  });
  await began;
  controller.abort();
  const run = await running;
  const snapshot = structuredClone(run);
  release(pass(source));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(run.outcome, "timeout");
  assert.deepEqual(run, snapshot);
});

test("harness cache fingerprints protocol source, scores fallback and keeps diagnostic rollout on HOLD", () => {
  const source = readFileSync(new URL("../../scripts/eval-vision-landmarks.ts", import.meta.url), "utf8");
  for (const path of ["sidePlacementRequest.ts", "sidePlacementEvidence.ts", "sideSeedFusion.ts", "side-evaluation-protocol.ts", "sideCloudPlacement.ts", "api/_sideLandmarks.ts", "package-lock.json"]) assert.ok(source.includes(path));
  assert.match(source, /evaluationFingerprint\(inputBytes\.get\(id\)!/);
  assert.match(source, /deliveredEvaluationPoints\(seed as SidePoints, raw/);
  assert.match(source, /diagnostic mode cannot approve production rollout/);
  assert.doesNotMatch(source, /\.rotate\(\)\.metadata\(\)/);
});
