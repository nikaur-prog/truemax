import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { GOAL_CATALOGUE_VERSION } from "../src/engine/goalCatalogue.js";
import { MORPH_EFFECT_LAYERS } from "../src/engine/morphEffects.js";
import { storedMorphRecipeKey } from "../src/engine/morphRecovery.js";
import { isScanId } from "../src/engine/scanSession.js";

// Execute the real route with a query/storage boundary double. No provider, network or DB writes.
const js = ts.transpileModule(readFileSync(new URL("./morph-preview.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replace(/^import[\s\S]*?;\n/gm, "").replace(/^export \{[^}]*\};?\n/gm, "").replace(/^export /gm, "");
const id = "11111111-1111-4111-8111-111111111111";
const scan = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const spec = { contract: "morph-preview-1", catalogueVersion: GOAL_CATALOGUE_VERSION, variant: "selected", hasSide: false, goalIds: ["skin"], requestId,
  recipe: { version: 1, status: "illustrative", effects: [{ id: "skinEvenness", amount: 0.2 }], targets: [] } };
function row(changes: Record<string, unknown> = {}) {
  return { id, user_id: "a", scan_id: scan, spec, catalogue_version: GOAL_CATALOGUE_VERSION, status: "ready", front_path: `a/${id}/front.jpg`, side_path: null,
    validation: { passed: true }, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString(), kept_until: null, ...changes };
}
function harness(rows = [row()], options: { user?: string | null; age?: number; entitled?: boolean; consent?: boolean; origin?: boolean; queryError?: boolean; missingImage?: boolean } = {}) {
  const reads: unknown[][] = [], downloads: string[] = [];
  const admin = { from(table: string) {
    assert.equal(table, "goal_previews");
    const filters: unknown[][] = [];
    let single = false, limit = Infinity;
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    for (const op of ["eq", "in", "order"]) chain[op] = (...args: unknown[]) => { filters.push([op, ...args]); return chain; };
    chain.limit = (n: number) => { limit = n; return chain; };
    chain.maybeSingle = () => { single = true; return chain; };
    chain.then = (resolve: (value: unknown) => void) => {
      reads.push(...filters);
      const data = rows.filter((item) => filters.every(([op, key, value]) => {
        const [column, property] = String(key).split("->>");
        const actual = property ? (item[column as keyof typeof item] as Record<string, unknown>)?.[property] : item[column as keyof typeof item];
        return op === "eq" ? actual === value : op === "in" ? (value as unknown[]).includes(actual) : true;
      })).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, limit);
      resolve({ data: single ? data[0] ?? null : data, error: options.queryError ? { message: "synthetic unavailable" } : null });
    };
    return chain;
  }, rpc: () => { assert.fail("GET must never claim a render"); }, storage: { from: () => ({ download: async (path: string) => {
    downloads.push(path);
    return options.missingImage ? { data: null, error: new Error("Deleted") } : { data: new Blob(["synthetic bytes"]), error: null };
  } }) } };
  const args = { MORPH_EFFECT_LAYERS, storedMorphRecipeKey, isScanId, GOAL_CATALOGUE_VERSION,
    previewGenerationUnavailable: () => null,
    authenticatedUser: async () => options.user === null ? null : { id: options.user ?? "a" }, getSupabaseAdmin: () => admin,
    maxAccessForUser: async () => options.entitled === false ? { ok: false, status: 402, error: "Max required" } : { ok: true, age: options.age ?? 30 },
    consented: async () => options.consent !== false, requestOrigin: () => options.origin !== false,
    json: (body: unknown, status = 200) => Response.json(body, { status }), safeMessage: () => "synthetic error",
    GOAL_PREVIEW_BUCKET: "private", GOAL_PREVIEW_CAPTION: "Illustrative", dataUrl: () => "data:image/jpeg;base64,c3ludGhldGlj",
  };
  const api = new Function(...Object.keys(args), `${js}\nreturn { GET, POST };`)(...Object.values(args)) as { GET(request: Request): Promise<Response>; POST(request: Request): Promise<Response> };
  return { api, reads, downloads };
}
async function url(job?: string, exactRequest = false) {
  return new Request(`https://truemax.app/api/morph-preview?${new URLSearchParams({ scan, recipe: (await storedMorphRecipeKey(spec))!, ...(job ? { job } : {}), ...(exactRequest ? { request: requestId } : {}) })}`);
}

test("saved discovery reads only this owner/scan/current exact recipe and returns metadata without storage or paid work", async () => {
  const h = harness([row(), row({ id: requestId, user_id: "b" }), row({ id: scan, scan_id: id }), row({ id: requestId, spec: { ...spec, variant: "max_vision" } })]);
  const response = await h.api.GET(await url());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.jobs.map((job: { jobId: string }) => job.jobId), [id]);
  assert.deepEqual(Object.keys(body.jobs[0]).sort(), ["createdAt", "expiresAt", "jobId", "status"]);
  assert.equal(h.downloads.length, 0);
  assert.ok(h.reads.some(([op, key, value]) => op === "eq" && key === "user_id" && value === "a"));
});

test("origin, session, entitlement, adult and consent guards run before recovery reads", async () => {
  for (const [options, status] of [[{ origin: false }, 403], [{ user: null }, 401], [{ entitled: false }, 402], [{ age: 17 }, 403], [{ consent: false }, 403]] as const) {
    const h = harness([], options);
    assert.equal((await h.api.GET(await url())).status, status);
    assert.equal(h.reads.length, 0);
    assert.equal(h.downloads.length, 0);
  }
});

test("expired, rejected, failed, stale-contract, deleted and foreign records cannot deliver recovered images", async () => {
  for (const changes of [{ expires_at: "2000-01-01" }, { status: "rejected" }, { status: "failed" }, { validation: { passed: false } },
    { spec: { ...spec, contract: "legacy" } }, { spec: { ...spec, catalogueVersion: "stale" } }, { user_id: "b" },
    { spec: { ...spec, recipe: { ...spec.recipe, effects: [{ id: "skinEvenness", amount: 0.3 }] } } }, { front_path: `b/${id}/front.jpg` }]) {
    const h = harness([row(changes)]);
    assert.deepEqual((await (await h.api.GET(await url())).json()).jobs, []);
    const body = await (await h.api.GET(await url(id))).json();
    assert.equal(body.status, "failed");
    assert.equal(body.images, undefined);
    assert.equal(h.downloads.length, 0);
  }
  const deleted = harness([]);
  assert.equal((await deleted.api.GET(await url(id))).status, 404);
  assert.equal(deleted.downloads.length, 0);
});

test("a matching uncertain request can discover its terminal job but never an older failed request", async () => {
  const h = harness([row({ status: "failed", expires_at: "2000-01-01" }), row({ id: scan, status: "failed", spec: { ...spec, requestId: id } })]);
  assert.deepEqual((await (await h.api.GET(await url())).json()).jobs, []);
  const body = await (await h.api.GET(await url(undefined, true))).json();
  assert.equal(body.requestId, requestId);
  assert.deepEqual(body.jobs.map((job: { jobId: string; status: string }) => [job.jobId, job.status]), [[id, "failed"]]);
  assert.equal(h.downloads.length, 0);
});

test("matched polling preserves pending pixel gates and cannot load a missing paired or deleted image", async () => {
  const h = harness([row({ validation: null })]);
  const body = await (await h.api.GET(await url(id))).json();
  assert.equal(body.status, "ready");
  assert.equal(body.validation.identityPreserved, false);
  assert.equal(body.validation.targetAligned, false);
  assert.deepEqual(h.downloads, [`a/${id}/front.jpg`]);
  const missing = harness([row()], { missingImage: true });
  assert.equal((await missing.api.GET(await url(id))).status, 404);
  const paired = harness([row({ spec: { ...spec, hasSide: true } })]);
  const request = new Request(`https://truemax.app/api/morph-preview?job=${id}`);
  assert.equal((await (await paired.api.GET(request)).json()).status, "failed");
  assert.equal(paired.downloads.length, 0);
});

test("an incomplete bounded search fails closed rather than implying no job exists", async () => {
  const h = harness(Array.from({ length: 51 }, () => row()));
  assert.equal((await h.api.GET(await url())).status, 409);
  assert.equal(h.downloads.length, 0);
});

test("pre-job rejection explicitly tells the client that no render was started", async () => {
  const h = harness([], { origin: false });
  const response = await h.api.POST(new Request("https://truemax.app/api/morph-preview", { method: "POST" }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).requestRejected, true);
  assert.equal(h.reads.length, 0);
});
