import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CLIENT_GATES, EFFECT_LAYERS, SERVER_GATES, parseMorphRequest } from "./morph-preview.js";

const route = readFileSync(new URL("./morph-preview.ts", import.meta.url), "utf8");
const contract = readFileSync(new URL("../docs/MORPH_PREVIEW_CONTRACT.md", import.meta.url), "utf8");

const PIXEL = "data:image/jpeg;base64," + Buffer.alloc(400, 7).toString("base64");
const SCAN = "123e4567-e89b-42d3-a456-426614174000";
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
  assert.deepEqual(ok.layers, ["brows", "skinSurface"], "only effects above zero become layers, in the catalogue's order");
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
  // A front-only blueprint needs no side.
  const frontOnly = parseMorphRequest(request({ source: { front: PIXEL } }, { hasSide: false }));
  assert.ok(!("error" in frontOnly) && frontOnly.side === null);
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
