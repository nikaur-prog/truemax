import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CLIENT_GATES, EFFECT_LAYERS, SERVER_GATES, parseMorphRequest, validationBlock } from "./morph-preview.js";
import { buildMorphBlueprint, MORPH_GOAL_RULES } from "../src/engine/morphPlan.js";
import { EMPTY_PROFILE } from "../src/engine/goals.js";
import { createMorphRenderRequest, parseMorphRenderState, requestMorphRender } from "../src/engine/morphContract.js";
import type { Report } from "../src/engine/types.js";
import { GOAL_CATALOGUE_VERSION, specAllowed } from "../src/engine/goalCatalogue.js";

const route = readFileSync(new URL("./morph-preview.ts", import.meta.url), "utf8");
const contract = readFileSync(new URL("../docs/MORPH_PREVIEW_CONTRACT.md", import.meta.url), "utf8");

const PIXEL = "data:image/jpeg;base64," + Buffer.alloc(400, 7).toString("base64");
const SCAN = "123e4567-e89b-42d3-a456-426614174000";
const REPORT: Report = {
  sex: "male", overall: 5, overallPercentile: 50, overallZ: 0, potential: 5.5,
  pillars: { Harmony: 5, Angularity: 5, Dimorphism: 5, Features: 5 }, regions: [], metrics: [], zScores: {},
};
function request(overrides: Record<string, unknown> = {}, blueprint: Record<string, unknown> = {}) {
  return {
    version: 1,
    variant: "selected",
    scanId: SCAN,
    source: { front: PIXEL, side: PIXEL },
    privacy: { purpose: "goal-preview", retainSource: false },
    blueprint: {
      version: 1,
      variant: "selected",
      goals: [{ id: "grooming" }, { id: "skin" }],
      effects: { browDefinition: 0.4, skinEvenness: 0.3, hairFinish: 0, facialFullness: 0 },
      hasFront: true,
      hasSide: true,
      ...blueprint,
    },
    ...overrides,
  };
}

test("the route speaks the client's contract: same gate order, claim before render, caption before storage", () => {
  const post = route.slice(route.indexOf("export async function POST"), route.indexOf("export async function GET"));
  const at = (needle: string) => {
    const i = post.indexOf(needle);
    assert.ok(i > -1, needle);
    return i;
  };
  assert.ok(at("requestOrigin(request)") < at("authenticatedUser(request)"));
  assert.ok(at("authenticatedUser(request)") < at("maxAccessForUser(user.id)"));
  assert.ok(at("maxAccessForUser(user.id)") < at("access.age < 18"));
  assert.ok(at("access.age < 18") < at("await consented(user.id)"));
  assert.ok(at("await consented(user.id)") < at('rpc("claim_goal_preview_render"'));
  assert.ok(at('rpc("claim_goal_preview_render"') < at("provider.render("));
  assert.ok(at("captioned(rendered.front)") < at("storage.upload("));
  assert.match(post, /if \(!\("front" in rendered\)\) \{[\s\S]*?releaseClaim\(\)/);
  assert.doesNotMatch(route, /createSignedUrl/);
  // The contract's paths and states.
  assert.match(contract, /POST \/api\/morph-preview/);
  assert.match(contract, /GET \/api\/morph-preview\?job=<id>/);
  assert.match(route, /searchParams\.get\("job"\)/);
  assert.match(route, /status: "processing", jobId/);
});

test("the server never asserts a pixel gate it cannot check", () => {
  assert.deepEqual([...CLIENT_GATES], ["identityPreserved", "targetAligned"]);
  assert.deepEqual([...SERVER_GATES], ["moderationPassed", "naturalOnly", "crossViewConsistent"]);
  const post = route.slice(route.indexOf("export async function POST"), route.indexOf("export async function GET"));
  assert.match(post, /validation: validationBlock\(false\)/, "a fresh render carries the client gates as pending");
  const get = route.slice(route.indexOf("export async function GET"));
  assert.match(get, /validationBlock\(data\.validation\?\.passed === true\)/, "only the device's verdict turns them true");
  for (const gate of CLIENT_GATES) assert.ok(contract.includes(gate), gate);
});

test("the request is parsed strictly: ids, bounded images, a stated purpose, a scan id", () => {
  const ok = parseMorphRequest(request());
  assert.ok(!("error" in ok));
  if ("error" in ok) return;
  assert.deepEqual(ok.goalIds, ["grooming", "skin"]);
  assert.deepEqual(ok.layers, ["brows", "skinSurface"], "only nonzero effects become layers, in the catalogue's order");
  assert.equal(ok.hasSide, true);
  assert.ok(ok.side && ok.front.length === 400);
  assert.match((parseMorphRequest(request({ scanId: "nope" })) as { error: string }).error, /name the scan/);
  assert.match((parseMorphRequest(request({ version: 2 })) as { error: string }).error, /version/);
  assert.match((parseMorphRequest(request({ privacy: { purpose: "goal-preview", retainSource: true } })) as { error: string }).error, /not retained/);
  assert.match((parseMorphRequest(request({ source: { front: "data:image/png;base64,AAAA" } })) as { error: string }).error, /front photograph/);
  assert.match((parseMorphRequest(request({}, { hasSide: true, goals: [{ id: "grooming" }] }, ), ) as { scanId: string }).scanId, /^123e/);
  assert.match((parseMorphRequest(request({ source: { front: PIXEL } })) as { error: string }).error, /profile photograph/);
  assert.match((parseMorphRequest(request({}, { goals: [{ id: "nosejob" }] })) as { error: string }).error, /goal the catalogue does not know/);
  assert.match((parseMorphRequest(request({}, { effects: { boneWidth: 0.5 } })) as { error: string }).error, /effect the server does not render/);
  assert.match((parseMorphRequest(request({}, { effects: { browDefinition: 1.5 } })) as { error: string }).error, /out of range/);
  assert.ok("error" in parseMorphRequest(request({}, { effects: { constructor: 1 } })));
  assert.ok("error" in parseMorphRequest(request({}, { effects: [] })));
  assert.ok("error" in parseMorphRequest(request({}, { goals: [null] })));
  // A front-only blueprint needs no side.
  const frontOnly = parseMorphRequest(request({ source: { front: PIXEL } }, { hasSide: false }));
  assert.ok(!("error" in frontOnly) && frontOnly.side === null);
});

test("every real blueprint keeps signed effects inside the server's existing unit budget", () => {
  for (const id of Object.keys(MORPH_GOAL_RULES)) {
    const blueprint = buildMorphBlueprint(REPORT, { ...EMPTY_PROFILE, goals: [id] }, "selected", true);
    const parsed = parseMorphRequest(createMorphRenderRequest(SCAN, blueprint, { front: PIXEL, side: PIXEL }));
    assert.ok(!("error" in parsed), `${id}: ${"error" in parsed ? parsed.error : ""}`);
    assert.equal(specAllowed({ goalIds: parsed.goalIds, layers: parsed.layers, catalogueVersion: GOAL_CATALOGUE_VERSION }, true).ok, true, id);
  }
  const reducing = parseMorphRequest(request({}, { effects: { facialFullness: -1, blemishVisibility: -0.4, browDefinition: 0, hairFinish: -0 } }));
  assert.ok(!("error" in reducing));
  assert.deepEqual(reducing.layers, ["skinSurface", "leanerPresentation"]);
  for (const amount of [-1.0001, 1.0001, NaN, Infinity, -Infinity, "-0.4", null]) {
    const rejected = parseMorphRequest(request({}, { effects: { facialFullness: amount } }));
    assert.ok("error" in rejected, String(amount));
  }
});

test("the actual API validation block survives the client wire parser without becoming display-ready", async () => {
  const blueprint = buildMorphBlueprint(REPORT, { ...EMPTY_PROFILE, goals: ["bodyfat", "skin"] }, "selected", true);
  const payload = createMorphRenderRequest(SCAN, blueprint, { front: PIXEL, side: PIXEL });
  const fetcher: typeof fetch = async (_input, init) => {
    const parsed = parseMorphRequest(JSON.parse(String(init?.body)));
    assert.ok(!("error" in parsed));
    return Response.json({ status: "ready", jobId: SCAN, images: { front: PIXEL, side: PIXEL }, validation: validationBlock(false) });
  };
  const result = await requestMorphRender(payload, "test-member-token", undefined, fetcher);
  assert.equal(result.status, "validation_pending", "a fresh render still needs the device validator");
  assert.equal(parseMorphRenderState({ status: "ready", jobId: SCAN, images: { front: PIXEL, side: PIXEL }, validation: validationBlock(true) }, true).status, "ready");
});

test("every effect maps to a layer the catalogue knows, and body composition only to the adult-only layer", () => {
  for (const [effect, layer] of Object.entries(EFFECT_LAYERS)) {
    assert.ok(["hair", "facialHair", "brows", "skinSurface", "leanerPresentation", "posture", "expression", "lighting", "wardrobe"].includes(layer), effect);
  }
  assert.equal(EFFECT_LAYERS.facialFullness, "leanerPresentation");
  assert.equal(EFFECT_LAYERS.jawDefinition, "leanerPresentation");
  assert.equal(EFFECT_LAYERS.underChinFullness, "leanerPresentation");
  // Nothing in the table can reach the wardrobe or facial-hair layers: the blueprint has no such effect.
  assert.ok(!Object.values(EFFECT_LAYERS).includes("wardrobe"));
  assert.ok(!Object.values(EFFECT_LAYERS).includes("facialHair"));
});
