import assert from "node:assert/strict";
import test from "node:test";
import { blueprintRecoveryKey, storedMorphRecipeKey, readMorphRequestMarker, writeMorphRequestMarker } from "./morphRecovery.js";
import { GOAL_CATALOGUE_VERSION } from "./goalCatalogue.js";
import { EMPTY_PROFILE } from "./goals.js";
import { buildMorphBlueprint } from "./morphPlan.js";
import { parseMorphRequest } from "../../api/morph-preview.js";
import { createMorphRenderRequest, listMorphPreviews, requestMorphRender } from "./morphContract.js";
import type { Report } from "./types.js";

const scanId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const report: Report = { sex: "female", overall: 5, overallPercentile: 50, overallZ: 0, potential: 6, pillars: { Harmony: 5, Angularity: 5, Dimorphism: 5, Features: 5 }, regions: [], metrics: [], zScores: {} };
const blueprint = buildMorphBlueprint(report, { ...EMPTY_PROFILE, goals: ["skin", "photos"] }, "selected", false);
const request = createMorphRenderRequest(scanId, blueprint, { front: "data:image/jpeg;base64," + Buffer.alloc(400, 7).toString("base64") });
const spec = { contract: "morph-preview-1", catalogueVersion: GOAL_CATALOGUE_VERSION, variant: "selected", hasSide: false, goalIds: ["skin", "photos"],
  recipe: { version: 1, status: "illustrative", effects: [{ id: "skinEvenness", amount: 0.2 }], targets: [{ id: "jawCheekRatio", view: "front", baseline: 0.5, target: 0.51 }] } };

test("the browser recipe key exactly matches the server's sanitized stored recipe", async () => {
  const parsed = parseMorphRequest(request);
  assert.ok(!("error" in parsed));
  assert.equal(await blueprintRecoveryKey(blueprint), await storedMorphRecipeKey({ ...spec, variant: parsed.variant, hasSide: parsed.hasSide, goalIds: parsed.goalIds, recipe: parsed.recipe }));
});

test("recipe matching includes goals, views, variant, signed effects and exact baseline/target but not display labels", async () => {
  const key = await storedMorphRecipeKey(spec);
  assert.match(key!, /^[a-f0-9]{64}$/);
  const cosmetic = structuredClone(spec);
  cosmetic.goalIds.reverse();
  Object.assign(cosmetic.recipe.targets[0], { label: "ignored label", unit: "ignored unit" });
  assert.equal(await storedMorphRecipeKey(cosmetic), key);
  for (const edit of [
    (s: typeof spec) => { s.variant = "max_vision"; },
    (s: typeof spec) => { s.hasSide = true; },
    (s: typeof spec) => { s.goalIds.pop(); },
    (s: typeof spec) => { s.recipe.effects[0].amount *= -1; },
    (s: typeof spec) => { s.recipe.targets[0].baseline += 0.00001; },
    (s: typeof spec) => { s.recipe.targets[0].target += 0.00001; },
    (s: typeof spec) => { s.hasSide = true; s.recipe.targets[0].view = "side"; },
  ]) { const changed = structuredClone(spec); edit(changed); assert.notEqual(await storedMorphRecipeKey(changed), key); }
});

test("stale contracts and malformed stored recipes cannot match", async () => {
  for (const invalid of [null, { ...spec, contract: "goal-preview-legacy" }, { ...spec, catalogueVersion: "stale" },
    { ...spec, recipe: { ...spec.recipe, targets: [...spec.recipe.targets, ...spec.recipe.targets] } },
    { ...spec, recipe: { ...spec.recipe, effects: [{ id: "bone", amount: 1 }] } },
    { ...spec, recipe: { ...spec.recipe, targets: [{ ...spec.recipe.targets[0], target: NaN }] } }]) {
    assert.equal(await storedMorphRecipeKey(invalid), null);
  }
});

test("uncertain request markers contain no photos or credentials and are scoped by owner, scan and recipe", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const match = { scanId, recipeKey: "a".repeat(64) };
  const marker = { startedAt: 1, requestId };
  writeMorphRequestMarker("user:a", match, marker, storage);
  assert.deepEqual([...values.values()].map((value) => JSON.parse(value)), [marker]);
  assert.deepEqual(readMorphRequestMarker("user:a", match, storage), marker, "age alone never permits another paid request");
  assert.equal(readMorphRequestMarker("user:b", match, storage), null);
  assert.equal(readMorphRequestMarker("user:a", { ...match, scanId: requestId }, storage), null);
  assert.equal(readMorphRequestMarker("user:a", { ...match, recipeKey: "b".repeat(64) }, storage), null);
  writeMorphRequestMarker("user:a", match, null, storage);
  assert.equal(values.size, 0);
});

test("metadata lookup validates the echoed selection, expiry and terminal request correlation", async () => {
  const match = { scanId, recipeKey: "a".repeat(64) };
  const row = { jobId: requestId, status: "ready", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() };
  const fetcher = (payload: unknown) => (async (url: RequestInfo | URL, options?: RequestInit) => {
    assert.equal(options?.method, undefined, "discovery only uses GET");
    assert.ok(String(url).includes(`scan=${scanId}`));
    return Response.json(payload);
  }) as typeof fetch;
  assert.deepEqual(await listMorphPreviews(match, "synthetic-token", undefined, fetcher({ ...match, jobs: [row] })), [row]);
  for (const payload of [{ ...match, scanId: requestId, jobs: [row] }, { ...match, recipeKey: "b".repeat(64), jobs: [row] },
    { ...match, jobs: [row, row] }, { ...match, jobs: [{ ...row, expiresAt: "2000-01-01" }] }, { ...match, jobs: [{ ...row, status: "failed" }] }]) {
    await assert.rejects(listMorphPreviews(match, "synthetic-token", undefined, fetcher(payload)));
  }
  const terminal = { ...row, status: "failed", expiresAt: "2000-01-01" };
  assert.equal((await listMorphPreviews({ ...match, requestId }, "synthetic-token", undefined, fetcher({ ...match, requestId, jobs: [terminal] })))[0].status, "failed");
});

test("only authoritative pre-job rejection or an identified terminal job resolves a POST failure", async () => {
  const fetcher = (body: unknown, status = 503) => (async () => Response.json(body, { status })) as typeof fetch;
  assert.equal((await requestMorphRender(request, "token", undefined, fetcher({ requestRejected: true, error: "Not configured" }))).status, "failed");
  assert.equal((await requestMorphRender(request, "token", undefined, fetcher({ status: "failed", jobId: scanId, error: "Rejected" }))).status, "failed");
  for (const [payload, status] of [[{ error: "Gateway failure" }, 503], [null, 200], [{ status: "failed", error: "Unknown job" }, 200]] as const) {
    await assert.rejects(requestMorphRender(request, "token", undefined, fetcher(payload, status)));
  }
});
