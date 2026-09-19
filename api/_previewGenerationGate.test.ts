import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { previewGenerationUnavailable } from "./_previewGenerationGate.js";
import { POST as morphPost } from "./morph-preview.js";
import { POST as legacyPost } from "./goal-preview.js";

test("new preview rendering requires a separate exact server opt-in", async () => {
  for (const value of [undefined, "", "0", "false", "true", "yes", " 1 "]) {
    const response = previewGenerationUnavailable({ GOAL_PREVIEW_RENDER_ENABLED: value, VITE_MORPH_PREVIEW: "1" });
    assert.equal(response?.status, 503);
    assert.equal(response?.headers.get("Cache-Control"), "no-store");
    const body = await response!.json();
    assert.equal(body.requestRejected, true);
    assert.match(body.error, /not available yet/);
    assert.equal(body.images, undefined);
    assert.equal(body.jobId, undefined);
  }
  assert.equal(previewGenerationUnavailable({ GOAL_PREVIEW_RENDER_ENABLED: "1" }), null);
});

test("both actual POST handlers reject without reading photos, credentials or provider configuration", async () => {
  const previous = process.env.GOAL_PREVIEW_RENDER_ENABLED;
  delete process.env.GOAL_PREVIEW_RENDER_ENABLED;
  try {
    for (const post of [morphPost, legacyPost]) {
      const request = new Proxy({} as Request, {
        get() { assert.fail("A disabled render must not inspect or read the request"); },
      });
      const response = await post(request);
      assert.equal(response.status, 503);
      assert.equal((await response.json()).requestRejected, true);
    }
  } finally {
    if (previous === undefined) delete process.env.GOAL_PREVIEW_RENDER_ENABLED;
    else process.env.GOAL_PREVIEW_RENDER_ENABLED = previous;
  }
});

test("the guard runs before service initialization and does not disable saved preview operations", () => {
  for (const file of ["morph-preview.ts", "goal-preview.ts"]) {
    const route = readFileSync(new URL(file, import.meta.url), "utf8");
    const post = route.slice(route.indexOf("export async function POST"), route.indexOf("export async function GET"));
    assert.ok(post.indexOf("previewGenerationUnavailable()") < post.indexOf("getSupabaseAdmin()"), file);
    assert.match(post, /if \(unavailable\) return unavailable;/);
    const savedOperations = route.slice(route.indexOf("export async function GET"));
    assert.doesNotMatch(savedOperations, /previewGenerationUnavailable|GOAL_PREVIEW_RENDER_ENABLED/, file);
  }
});
