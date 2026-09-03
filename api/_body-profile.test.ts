import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bodyRequired, parseBodyRequest } from "./body-profile.js";
import { buildSystemPrompt, sanitiseContext } from "./_maxPersona.js";

const route = readFileSync(new URL("./body-profile.ts", import.meta.url), "utf8");
const chat = readFileSync(new URL("./max-chat.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20260903180000_body_profiles.sql", import.meta.url), "utf8");
const scoring = ["scoring.ts", "metrics.ts", "sideMetrics.ts", "aggregate.ts", "report.ts"]
  .map((f) => {
    try {
      return readFileSync(new URL(`../src/engine/${f}`, import.meta.url), "utf8");
    } catch {
      return "";
    }
  })
  .join("\n");

test("the requirement is adult, live Max, and missing; never a minor, never Free or Starter, never once filled", () => {
  assert.equal(bodyRequired({ age: 25, tier: "max", status: "active", hasBody: false }), true);
  assert.equal(bodyRequired({ age: 25, tier: "max", status: "trialing", hasBody: false }), true);
  assert.equal(bodyRequired({ age: 25, tier: "max", status: "active", hasBody: true }), false);
  assert.equal(bodyRequired({ age: 17, tier: "max", status: "active", hasBody: false }), false, "a minor is never asked");
  assert.equal(bodyRequired({ age: null, tier: "max", status: "active", hasBody: false }), false, "an unknown age is a minor");
  assert.equal(bodyRequired({ age: 25, tier: "starter", status: "active", hasBody: false }), false);
  assert.equal(bodyRequired({ age: 25, tier: "free", status: "none", hasBody: false }), false);
  assert.equal(bodyRequired({ age: 25, tier: "max", status: "past_due", hasBody: false }), false, "a lapsed Max is not live");
});

test("the route reads age and tier from the account, never the payload, and is origin and sign-in gated", () => {
  for (const method of ["GET", "PUT", "DELETE"]) {
    const fn = route.slice(route.indexOf(`export async function ${method}`));
    assert.ok(fn.indexOf("requestOrigin(request)") < fn.indexOf("authenticatedUser(request)"), method);
  }
  assert.match(route, /from\("profiles"\)\.select\("date_of_birth"\)/);
  assert.match(route, /from\("entitlements"\)\.select\("tier,status"\)/);
  assert.doesNotMatch(route, /raw\.age|raw\.tier|body\.adult|raw\.required/);
  // A migration write never overwrites a typed value.
  const put = route.slice(route.indexOf("export async function PUT"), route.indexOf("export async function DELETE"));
  assert.match(put, /source === "device_migration"[\s\S]*?return json\(await state\(user\.id\)\)/);
});

test("the request parser accepts either unit system and nothing else", () => {
  const metric = parseBodyRequest({ unit: "metric", heightCm: 180, weightKg: 75 });
  assert.ok(!("error" in metric) && metric.entry.unit === "metric" && metric.source === "dialog");
  const imperial = parseBodyRequest({ unit: "imperial", feet: 5, inches: 11, pounds: 165, source: "settings" });
  assert.ok(!("error" in imperial) && imperial.entry.unit === "imperial" && imperial.source === "settings");
  assert.ok("error" in parseBodyRequest({ heightCm: 180, weightKg: 75 }));
  assert.ok("error" in parseBodyRequest("nope"));
  const odd = parseBodyRequest({ unit: "metric", heightCm: "180", weightKg: 75, source: "hacker" });
  assert.ok(!("error" in odd) && Number.isNaN(odd.entry.heightCm) && odd.source === "dialog", "a string is not a number and an unknown source is the default");
});

test("Max is told when the body is missing and never reads it from the browser", () => {
  const base = sanitiseContext({ sex: "male", tone: "kind", pillars: [], regions: [], focus: [], activePlan: [], measurements: [], scans: 1, overall: 6, bodyProfile: { heightCm: 999, weightKg: 1 } }, 25);
  assert.ok(base);
  assert.equal(base!.bodyProfile, undefined, "the payload cannot set a body profile");
  base!.bodyProfile = "missing";
  const missing = buildSystemPrompt(base!);
  assert.match(missing, /Body profile: not provided/);
  assert.match(missing, /Do not build or estimate a diet, macro, calorie or body-composition plan/);
  base!.bodyProfile = { heightCm: 180, weightKg: 75 };
  const given = buildSystemPrompt(base!);
  assert.match(given, /height 180 cm, weight 75 kg/);
  assert.match(given, /says nothing about the face/);
  assert.doesNotMatch(missing + given, /—/);
  // The chat sets it from the account row, only for adults, and only after access is known.
  assert.match(chat, /if \(age >= 18\) \{[\s\S]*?from\("body_profiles"\)/);
  assert.match(chat, /context\.bodyProfile = /);
});

test("the migration keeps the row owner-bound, browser-undeletable, bounded, and filled from signup metadata only within bounds", () => {
  assert.match(migration, /alter table public\.body_profiles enable row level security/);
  assert.match(migration, /create policy "own body profile - read"[\s\S]*?auth\.uid\(\)\) = user_id/);
  assert.match(migration, /revoke delete on public\.body_profiles from authenticated/);
  assert.match(migration, /revoke all on public\.body_profiles from anon/);
  assert.match(migration, /height_cm between 120 and 230/);
  assert.match(migration, /weight_kg between 35 and 300/);
  assert.match(migration, /after insert on auth\.users/);
  assert.match(migration, /if h < 120 or h > 230 or w < 35 or w > 300 then\s*return new;/);
  assert.match(migration, /on conflict \(user_id\) do nothing/);
});

test("facial scoring never reads height, weight or BMI", () => {
  assert.ok(scoring.length > 1000, "the scoring modules were read");
  assert.doesNotMatch(scoring, /heightCm|weightKg|body_profiles|\bbmi\b/i);
});

test("the device migration is one conditional statement that writes only into a row holding neither figure", () => {
  const rpcMigration = readFileSync(new URL("../supabase/migrations/20260904100000_body_profile_device_migration.sql", import.meta.url), "utf8");
  const route = readFileSync(new URL("./body-profile.ts", import.meta.url), "utf8");
  assert.match(rpcMigration, /on conflict \(user_id\) do update[\s\S]*?where public\.body_profiles\.height_cm is null\s+and public\.body_profiles\.weight_kg is null/);
  assert.match(rpcMigration, /revoke all on function public\.migrate_body_profile\(uuid, numeric, numeric, text\) from public, anon, authenticated;\s+grant execute on function public\.migrate_body_profile\(uuid, numeric, numeric, text\) to service_role/);
  const put = route.match(/export async function PUT[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(put, /if \(parsed\.source === "device_migration"\) \{[\s\S]*?rpc\("migrate_body_profile"[\s\S]*?return json\(await state\(user\.id\)\);/);
  assert.doesNotMatch(put, /select\("height_cm,weight_kg"\)/, "no read-then-write in the migration path");
});
