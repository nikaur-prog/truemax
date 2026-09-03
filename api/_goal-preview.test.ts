import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";
import { GOAL_CATALOGUE_VERSION, RENDER_LAYERS } from "../src/engine/goalCatalogue.js";
import { previewInstructions, previewProvider } from "./_previewProvider.js";
import { GOAL_PREVIEW_CONSENT_VERSION, captioned, parseSpec } from "./goal-preview.js";

const route = readFileSync(new URL("./goal-preview.ts", import.meta.url), "utf8");
const consentRoute = readFileSync(new URL("./goal-preview-consent.ts", import.meta.url), "utf8");
const cron = readFileSync(new URL("./cleanup-goal-previews.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20260903120000_goal_previews.sql", import.meta.url), "utf8");
const vercel = readFileSync(new URL("../vercel.json", import.meta.url), "utf8");

test("the gates run in the standing order: origin, sign in, Max tier and age, consent, then the claim before the provider", () => {
  const post = route.slice(route.indexOf("export async function POST"), route.indexOf("function previewIdFrom"));
  const at = (needle: string) => {
    const i = post.indexOf(needle);
    assert.ok(i > -1, needle);
    return i;
  };
  const origin = at("requestOrigin(request)");
  const auth = at("authenticatedUser(request)");
  const access = at("maxAccessForUser(user.id)");
  const age = at("access.age < 18");
  const consent = at("await consented(user.id)");
  const claim = at('rpc("claim_goal_preview_render"');
  const render = at("provider.render(");
  const upload = at("storage.upload(");
  assert.ok(origin < auth && auth < access && access < age && age < consent && consent < claim && claim < render && render < upload);
  // A provider that produced nothing gives the claim back; a delivered render does not.
  assert.match(post, /if \(!\("front" in rendered\)\) \{[\s\S]*?releaseClaim\(\)/);
  assert.match(post, /claimedUserId = null;\s*\n\s*const \[frontOut, sideOut\]/);
});

test("no signed URL is ever issued, nothing logs a photo, and every stored image is captioned first", () => {
  assert.doesNotMatch(route, /createSignedUrl/);
  assert.doesNotMatch(route, /console\.(log|error)\([^)]*(front|side|photo)\b/i);
  const post = route.slice(route.indexOf("export async function POST"), route.indexOf("function previewIdFrom"));
  assert.ok(post.indexOf("captioned(rendered.front)") < post.indexOf("storage.upload("), "captioned before stored");
  const shared = readFileSync(new URL("../src/engine/goalPreviewConsent.ts", import.meta.url), "utf8");
  assert.match(shared, /GOAL_PREVIEW_CAPTION = "A synthetic visual direction based on your selected goals, not a forecast\."/);
  assert.match(shared, /GOAL_PREVIEW_CONSENT_VERSION = "goal-preview-v1"/);
});

test("the caption lands in the pixels and the output stays under the response ceiling", async () => {
  const src = await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#b08a70" } }).jpeg().toBuffer();
  const out = await captioned(src);
  assert.ok(out);
  const meta = await sharp(out!).metadata();
  assert.equal(meta.format, "jpeg");
  assert.ok((meta.width ?? 0) <= 1400 && out!.length < 1_800_000);
  // The bottom band is dark: the caption pill was drawn.
  const { data } = await sharp(out!).extract({ left: 0, top: (meta.height ?? 0) - 4, width: 10, height: 4 }).raw().toBuffer({ resolveWithObject: true });
  const mean = [...data].reduce((t, v) => t + v, 0) / data.length;
  assert.ok(mean < 120, `bottom band mean ${mean}`);
});

test("a spec is ids only, from the catalogue's vocabularies, and the versions must match", () => {
  const good = { sourceScanId: "123e4567-e89b-42d3-a456-426614174000", goalIds: ["grooming", "eyes"], layers: ["brows", "hair"], catalogueVersion: GOAL_CATALOGUE_VERSION, consentVersion: GOAL_PREVIEW_CONSENT_VERSION };
  const parsed = parseSpec(JSON.stringify(good));
  assert.ok(parsed);
  assert.deepEqual(parsed!.goalIds, ["grooming", "eyes"]);
  assert.equal(parseSpec({ ...good, goalIds: ["grooming", "nosejob"] }), null);
  assert.equal(parseSpec({ ...good, layers: ["surgery"] }), null);
  assert.equal(parseSpec({ ...good, sourceScanId: "not-a-uuid" }), null);
  assert.equal(parseSpec({ ...good, catalogueVersion: "catalogue-0" }), null);
  assert.equal(parseSpec({ ...good, consentVersion: "goal-preview-v0" }), null);
  assert.equal(parseSpec({ ...good, prompt: "make me look like a celebrity" })!.goalIds.length, 2, "free text is ignored, never carried");
  assert.equal(parseSpec("not json"), null);
});

test("the instructions carry the identity clauses, only allowed layer phrases, and no inference", () => {
  const text = previewInstructions(["brows", "posture", "surgery"]);
  assert.match(text, /same person/);
  assert.match(text, /same bone structure/);
  assert.match(text, /Do not infer or alter ethnicity/);
  assert.match(text, /No cosmetic surgery/);
  assert.match(text, /eyebrows/);
  assert.match(text, /Upright posture/);
  assert.doesNotMatch(text, /leaner/);
  assert.doesNotMatch(text, /surgery may/);
  assert.doesNotMatch(text, /—/);
  const none = previewInstructions([]);
  assert.match(none, /Nothing about the person's presentation differs/);
  for (const layer of RENDER_LAYERS) assert.ok(previewInstructions([layer]).length > none.length, layer);
});

test("the provider is a deployment setting: none configured means none", () => {
  assert.equal(previewProvider({}), null);
  assert.equal(previewProvider({ HF_CREDENTIALS: "key:secret" }), null, "an endpoint is required as well");
  assert.equal(previewProvider({ HF_CREDENTIALS: "key:secret", HIGGSFIELD_PREVIEW_ENDPOINT: "x/y" })?.name, "higgsfield");
  assert.equal(previewProvider({ OPENAI_API_KEY: "sk-test" })?.name, "openai");
});

test("consent is granted and revoked only through the route, behind the same gates, with a trail that fails closed", () => {
  for (const method of ["GET", "PUT", "DELETE"]) assert.match(consentRoute, new RegExp(`export async function ${method}\\(`), method);
  const gate = consentRoute.slice(consentRoute.indexOf("async function gate"), consentRoute.indexOf("export async function GET"));
  assert.ok(gate.indexOf("requestOrigin(request)") < gate.indexOf("authenticatedUser(request)"));
  assert.ok(gate.indexOf("authenticatedUser(request)") < gate.indexOf("maxAccessForUser(user.id)"));
  assert.ok(gate.indexOf("maxAccessForUser(user.id)") < gate.indexOf("access.age < 18"));
  const put = consentRoute.slice(consentRoute.indexOf("export async function PUT"), consentRoute.indexOf("export async function DELETE"));
  assert.match(put, /body\.version !== GOAL_PREVIEW_CONSENT_VERSION/, "a stale dialog is refused");
  assert.match(put, /event_type: "granted"/);
  assert.match(put, /if \(auditError\) \{[\s\S]*?\.delete\(\)\.eq\("user_id", gated\.userId\)/, "a grant without a trail is rolled back");
  const del = consentRoute.slice(consentRoute.indexOf("export async function DELETE"));
  assert.ok(del.indexOf('from("goal_previews")') < del.indexOf('from("goal_preview_consents")'), "previews go before the consent flips");
  assert.match(del, /event_type: "revoked"/);
  // The trail never carries the user id.
  assert.doesNotMatch(consentRoute, /subject_id: gated\.userId/);
  // The browser cannot write consent directly: no RPC for it in the migration.
  assert.doesNotMatch(migration, /revoke_goal_preview_consent|grant_goal_preview_consent/);
  assert.match(migration, /revoke all on table public\.goal_preview_consents from public, anon, authenticated/);
});

test("a rejected verdict leaves a trail, and a render killed mid-flight is swept to failed", () => {
  const patch = route.slice(route.indexOf("export async function PATCH"), route.indexOf("export async function DELETE"));
  assert.match(patch, /event_type: "rejected"/);
  assert.match(cron, /\.eq\("status", "generating"\)\s*\.lte\("created_at", stale\)/);
  assert.match(cron, /15 \* 60_000/);
  assert.doesNotMatch(route, /deleted_at/, "no soft-delete column: a deleted preview is deleted");
  assert.doesNotMatch(migration, /deleted_at|'revoked'\)/);
});

test("the two inline images together stay under the response cap", () => {
  const m = route.match(/MAX_RESPONSE_JPEG_BYTES = ([0-9_]+)/);
  assert.ok(m);
  const each = Number(m![1].replace(/_/g, ""));
  assert.ok(2 * each * 1.37 < 4_500_000, `two images of ${each} bytes encoded exceed the cap`);
});

test("the migration keeps every table under RLS, service-only writes, a private bucket and a retention trail", () => {
  for (const table of ["goal_previews", "goal_preview_consents", "goal_preview_consent_events", "goal_preview_storage_cleanup", "goal_preview_usage"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`), table);
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`), table);
  }
  assert.match(migration, /'goal-previews',\s*'goal-previews',\s*false/);
  assert.match(migration, /before delete on public\.goal_previews/);
  assert.match(migration, /retain_until\s+timestamptz not null default \(now\(\) \+ interval '365 days'\)/);
  assert.match(migration, /expires_at\s+timestamptz not null default \(now\(\) \+ interval '30 days'\)/);
  assert.match(migration, /claim_goal_preview_render\(p_user_id uuid, p_limit integer\)/);
  assert.match(migration, /release_goal_preview_render\(p_user_id uuid\)/);
  // No column of the person's face lives in the table: no points, no photo bytes.
  assert.doesNotMatch(migration, /\b(landmarks|points|photo|source_photo)\s+(jsonb|bytea|text)/i);
});

test("the sweep is cron-secret gated and drains rows, objects and audits", () => {
  assert.match(cron, /process\.env\.CRON_SECRET/);
  assert.match(cron, /return json\(\{ error: "Unauthorized\." \}, 401\)/);
  assert.match(cron, /from\("goal_previews"\)\s*\.delete\(\)/);
  assert.match(cron, /storage\.from\(BUCKET\)\.remove\(paths\)/);
  assert.match(cron, /from\("goal_preview_consent_events"\)\s*\.delete/);
  assert.match(vercel, /"\/api\/cleanup-goal-previews", "schedule": "30 3 \* \* \*"/);
  assert.match(vercel, /"api\/goal-preview\.ts": \{\s*"maxDuration": 300\s*\}/);
});
