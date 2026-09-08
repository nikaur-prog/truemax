import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import type Anthropic from "@anthropic-ai/sdk";
import type { User } from "@supabase/supabase-js";
import { createSidePlacementHandler } from "./side-landmarks.js";
import { placeSideLandmarks, prepareLandmarkImage, SideLandmarkUnavailableError } from "./_sideLandmarks.js";
import { getSupabaseAdmin } from "./_shared.js";
import { cloudSideSeedFractions, parseCloudSidePlacement } from "../src/ui/sideCloudPlacement.js";
import { fuseSideSeeds } from "../src/engine/sideSeedFusion.js";
import type { SidePoints } from "../src/engine/sideMetrics.js";

const seed: SidePoints = {
  trichion: { x: 420, y: 250 }, glabella: { x: 470, y: 420 }, nasion: { x: 460, y: 475 },
  pronasale: { x: 550, y: 630 }, subnasale: { x: 500, y: 685 }, labialeSuperius: { x: 510, y: 740 },
  labialeInferius: { x: 500, y: 800 }, pogonion: { x: 490, y: 880 }, menton: { x: 450, y: 940 },
  cervicale: { x: 350, y: 980 }, gonion: { x: 280, y: 870 }, condylion: { x: 240, y: 615 },
  tragion: { x: 220, y: 615 },
};
const hint = cloudSideSeedFractions(seed, 1000, 1400, 1)!;
const bytes = () => sharp({ create: { width: 100, height: 140, channels: 3, background: "white" } }).jpeg().toBuffer();
type Mode = "throw" | "refuse" | "malformed" | "coarse-ear" | "fine-ear";

function provider(mode: Mode) {
  let calls = 0;
  const client = { messages: { create: async (body: {
    tools: Array<{ input_schema: { required: string[] } }>;
    messages: Array<{ content: Array<{ type: string }> }>;
  }) => {
    calls += 1;
    if (mode === "throw") throw new Error("synthetic provider failure");
    const ids = body.tools[0].input_schema.required;
    const fine = body.messages[0].content.filter((entry) => entry.type === "image").length === 2;
    const accept = ids.length === 2 && ids.includes("tragion") && (
      mode === "coarse-ear" && !fine || mode === "fine-ear" && fine
    );
    if (mode === "malformed") return { content: [{ type: "tool_use", input: { tragion: { x: 1, y: 1 } } }] };
    if (!accept) return { content: [{ type: "text", text: "Cannot read these points" }] };
    return {
      content: [{ type: "tool_use", input: {
        tragion: { x: 500, y: 500, confidence: 0.8 }, condylion: { x: 560, y: 500, confidence: 0.8 },
      } }],
      usage: { input_tokens: 10, output_tokens: 10 },
    };
  } } } as unknown as Anthropic;
  return { client, calls: () => calls };
}

for (const mode of ["throw", "refuse", "malformed"] as const) {
  test(`seeded ${mode} responses cannot turn retained hints into a successful pass`, async () => {
    const mock = provider(mode);
    const image = await prepareLandmarkImage(await bytes());
    await assert.rejects(placeSideLandmarks(mock.client, image, { hint }), (error: unknown) => {
      assert.ok(error instanceof SideLandmarkUnavailableError);
      assert.equal(error.attemptedCalls, 5);
      assert.equal(error.calls, mode === "throw" ? 0 : 5);
      return true;
    });
    assert.equal(mock.calls(), 5);
  });
}

for (const mode of ["coarse-ear", "fine-ear"] as const) {
  test(`${mode} success preserves only the evidence that actually arrived`, async () => {
    const mock = provider(mode);
    const pass = await placeSideLandmarks(mock.client, await prepareLandmarkImage(await bytes()), { hint });
    const stage = mode === "coarse-ear" ? "coarse" : "fine";
    assert.equal(pass.attemptedCalls, 5);
    assert.equal(pass.calls, 5, "refusals are counted as provider responses, not accepted point observations");
    assert.equal(pass.result.evidence.tragion, stage);
    assert.equal(pass.result.evidence.condylion, stage);
    for (const id of ["gonion", "menton", "cervicale", "nasion"] as const) {
      assert.equal(pass.result.evidence[id], "seed");
      assert.equal(pass.result.confidence[id], 0);
      assert.deepEqual(pass.result.points[id], hint[id]);
    }
    const parsed = parseCloudSidePlacement(pass.result, 1000, 1400)!;
    assert.ok(parsed);
    const fused = fuseSideSeeds(seed, parsed.points, parsed.confidenceByPoint, undefined, parsed.evidence);
    assert.equal(fused.secondOpinion, true);
    assert.equal(fused.agreement.gonion, null);
    assert.equal(fused.band.gonion, "mid");
    assert.deepEqual(fused.points.gonion, seed.gonion);
  });
}

async function request(signal?: AbortSignal) {
  const body = new FormData();
  body.append("photo", new Blob([await bytes()], { type: "image/jpeg" }), "synthetic.jpg");
  body.append("seed", JSON.stringify(hint));
  return new Request("https://example.test/api/side-landmarks", {
    method: "POST", headers: { origin: "https://example.test" }, body, signal,
  });
}

function handler(mock: ReturnType<typeof provider>, rpcs: string[], remaining = 3, releaseFails = false) {
  return createSidePlacementHandler({
    client: () => mock.client,
    authenticatedUser: async () => ({ id: "synthetic-user" }) as User,
    getSupabaseAdmin: () => ({ rpc: async (name: string) => {
      rpcs.push(name);
      return { data: remaining, error: releaseFails && name === "release_side_landmark_pass" ? { message: "synthetic release failure" } : null };
    } }) as unknown as ReturnType<typeof getSupabaseAdmin>,
  });
}

for (const mode of ["throw", "refuse", "malformed"] as const) {
  test(`endpoint returns a ${mode} pass allowance exactly once`, async (t) => {
    t.mock.method(console, "error", () => {});
    const rpcs: string[] = [];
    const response = await handler(provider(mode), rpcs)(await request());
    assert.equal(response.status, 502);
    assert.deepEqual(rpcs, ["claim_side_landmark_pass", "release_side_landmark_pass"]);
    const payload = await response.json();
    assert.equal(payload.points, undefined);
  });
}

test("endpoint keeps a partial successful claim and carries its evidence to the client", async (t) => {
  t.mock.method(console, "error", () => {});
  const rpcs: string[] = [];
  const response = await handler(provider("coarse-ear"), rpcs)(await request());
  assert.equal(response.status, 200);
  assert.deepEqual(rpcs, ["claim_side_landmark_pass"]);
  const parsed = parseCloudSidePlacement(await response.json(), 1000, 1400)!;
  assert.ok(parsed);
  assert.equal(parsed.evidence.tragion, "coarse");
  assert.equal(parsed.evidence.gonion, "seed");
});

test("rate-limited placement neither calls the provider nor releases an unclaimed slot", async () => {
  const mock = provider("throw");
  const rpcs: string[] = [];
  const response = await handler(mock, rpcs, -1)(await request());
  assert.equal(response.status, 429);
  assert.equal(mock.calls(), 0);
  assert.deepEqual(rpcs, ["claim_side_landmark_pass"]);
});

test("a failed allowance release is not retried as another decrement", async (t) => {
  t.mock.method(console, "error", () => {});
  const rpcs: string[] = [];
  const response = await handler(provider("throw"), rpcs, 3, true)(await request());
  assert.equal(response.status, 502);
  assert.deepEqual(rpcs, ["claim_side_landmark_pass", "release_side_landmark_pass"]);
});

test("a deadline during a claimed pass returns the allowance and no points", async (t) => {
  t.mock.method(console, "error", () => {});
  const parent = new AbortController();
  const rpcs: string[] = [];
  const mock = provider("throw");
  const post = createSidePlacementHandler({
    client: () => mock.client,
    authenticatedUser: async () => ({ id: "synthetic-user" }) as User,
    getSupabaseAdmin: () => ({ rpc: async (name: string) => {
      rpcs.push(name);
      return { data: 3, error: null };
    } }) as unknown as ReturnType<typeof getSupabaseAdmin>,
    placeSideLandmarks: async (_client, _image, options) => {
      parent.abort(new Error("synthetic deadline"));
      options!.signal!.throwIfAborted();
      throw new Error("unreachable");
    },
  });
  const response = await post(await request(parent.signal));
  assert.equal(response.status, 408);
  assert.deepEqual(rpcs, ["claim_side_landmark_pass", "release_side_landmark_pass"]);
});
