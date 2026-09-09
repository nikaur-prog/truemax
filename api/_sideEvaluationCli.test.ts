import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { prepareEvaluationSource } from "../scripts/side-evaluation-protocol.js";
import type { EvaluationSource } from "../scripts/side-evaluation-protocol.js";
import { SIDE_LANDMARK_IDS } from "./_sideLandmarks.js";
import type { SidePoints } from "../src/engine/sideMetrics.js";

function seed(frame: EvaluationSource["frame"]): SidePoints {
  const points = Object.fromEntries(SIDE_LANDMARK_IDS.map((id, i) => [id, { x: frame.w * 0.7, y: frame.h * (0.1 + i * 0.04) }])) as SidePoints;
  points.tragion = { x: frame.w * 0.3, y: frame.h * 0.4 };
  points.condylion = { x: frame.w * 0.31, y: frame.h * 0.4 };
  return points;
}

test("the actual CLI scores and caches a synthetic no-upload fallback without provider credentials", async () => {
  const directory = mkdtempSync(join(tmpdir(), "truemax-side-eval-synthetic-"));
  try {
    const image = await sharp({ create: { width: 80, height: 40, channels: 3, background: "#aabbcc" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const source = await prepareEvaluationSource(image);
    const points = seed(source.frame);
    const truth = structuredClone(points);
    for (const id of ["menton", "cervicale", "gonion", "condylion", "tragion"] as const) truth[id].x += 5;
    mkdirSync(join(directory, "raw"));
    writeFileSync(join(directory, "raw", "synthetic-a.jpg"), image);
    writeFileSync(join(directory, "seeds.json"), JSON.stringify({ "synthetic-a": { points } }));
    writeFileSync(join(directory, "labels.json"), JSON.stringify({ "synthetic-a": { points: truth } }));
    const script = fileURLToPath(new URL("../scripts/eval-vision-landmarks.ts", import.meta.url));
    const args = ["--import", "tsx", script, "--data-dir", directory, "--delivery", "device_choice", "--repeat", "2"];
    // This limit covers process startup/transpilation under the parallel suite,
    // not placement: the CLI still uses the independently tested 5s budget.
    const run = () => spawnSync(process.execPath, args, { encoding: "utf8", timeout: 30_000, env: { ...process.env, ANTHROPIC_API_KEY: "", CLAUDE_API_KEY: "" } });
    const first = run();
    assert.equal(first.status, 1, first.stderr); // Device cohort cannot approve cloud rollout.
    assert.match(first.stdout, /device_choice=2/);
    assert.match(first.stdout, /HOLD the fused seed/);
    assert.match(first.stdout, /0 requests started/);
    assert.doesNotMatch(first.stderr, /need a model call|invalid evaluation input/);
    const file = readdirSync(directory).find((name) => name.startsWith("vision-production-"))!;
    const cached = JSON.parse(readFileSync(join(directory, file), "utf8"))["synthetic-a"];
    assert.equal(cached.result, null);
    assert.equal(cached.outcome, "device_choice");
    assert.equal(cached.runs.length, 1);
    assert.deepEqual(cached.delivered.points, points);
    assert.equal(cached.fingerprint.imageHash.length, 64);
    assert.equal(cached.fingerprint.seedHash.length, 64);
    assert.equal(cached.fingerprint.protocolHash.length, 64);
    const second = run();
    assert.equal(second.status, 1, second.stderr);
    assert.equal(second.stderr, "", "matching cache must not repeat the evaluation attempts");
    assert.match(second.stdout, /device_choice=2/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
