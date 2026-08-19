import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const migrations = readdirSync(new URL("supabase/migrations/", root))
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => read(`supabase/migrations/${name}`))
  .join("\n");

test("every public application table enables row-level security", () => {
  const tables = [...migrations.matchAll(/create table(?: if not exists)? public\.([a-z_]+)/gi)]
    .map((match) => match[1]);
  assert.ok(tables.length >= 10, "the test must cover the real schema");
  for (const table of new Set(tables)) {
    assert.match(
      migrations,
      new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, "i"),
      `${table} is exposed without RLS`,
    );
  }
});

test("browser-readable rows are owner-bound and service-only rows are revoked", () => {
  for (const table of ["scans", "profiles", "entitlements", "scan_credits", "app_admins", "max_chat_usage"]) {
    const ownerPolicy = new RegExp(
      `create policy[\\s\\S]{0,180}on\\s+public\\.${table}[\\s\\S]{0,220}auth\\.uid\\(\\)[\\s\\S]{0,80}user_id`,
      "i",
    );
    assert.match(migrations, ownerPolicy, `${table} has no user_id RLS boundary`);
  }
  for (const table of [
    "stripe_webhook_events",
    "trial_redemptions",
    "funnel_events",
    "side_landmark_feedback",
    "side_feedback_storage_cleanup",
    "side_feedback_consent_events",
  ]) {
    assert.match(
      migrations,
      new RegExp(`revoke\\s+all\\s+on(?:\\s+table)?\\s+public\\.${table}\\s+from[\\s\\S]{0,80}(?:anon|authenticated)`, "i"),
      `${table} is not explicitly revoked from browser roles`,
    );
  }
});

test("scan credits expose only owner reads and narrowly granted RPCs", () => {
  assert.match(
    migrations,
    /revoke all on table public\.scan_credits from public, anon, authenticated[\s\S]*?grant select on table public\.scan_credits to authenticated/i,
  );
  assert.match(
    migrations,
    /create policy "read own scan credits"[\s\S]*?to authenticated[\s\S]*?\(select auth\.uid\(\)\) = user_id/i,
  );
  assert.match(
    migrations,
    /create or replace function public\.grant_scan_credit[\s\S]*?security definer[\s\S]*?set search_path = ''/i,
  );
  assert.match(
    migrations,
    /revoke all on function public\.grant_scan_credit\(uuid, integer\)[\s\S]*?from public, anon, authenticated[\s\S]*?grant execute on function public\.grant_scan_credit\(uuid, integer\)[\s\S]*?to service_role/i,
  );
  assert.match(
    migrations,
    /create or replace function public\.consume_scan_credit\(\)[\s\S]*?security definer[\s\S]*?set search_path = ''[\s\S]*?caller_id uuid := \(select auth\.uid\(\)\)[\s\S]*?where user_id = caller_id/i,
  );
  assert.match(
    migrations,
    /revoke all on function public\.consume_scan_credit\(\)[\s\S]*?from public, anon, authenticated, service_role[\s\S]*?grant execute on function public\.consume_scan_credit\(\)[\s\S]*?to authenticated/i,
  );
});

test("private face feedback is owner-pathed and linked to its immutable scan", () => {
  const route = read("api/side-correction-feedback.ts");
  assert.match(route, /`\$\{user\.id\}\/\$\{metadata\.submissionId\}\.jpg`/);
  assert.match(route, /scan_id:\s*metadata\.scanId/);
  assert.match(route, /user_id:\s*user\.id/);
  assert.match(migrations, /'side-correction-feedback',\s*'side-correction-feedback',\s*false/i);
  assert.match(migrations, /alter column scan_id set not null/i);
  assert.match(route, /\.eq\("user_id", user\.id\)/);
  assert.match(route, /p_user_id:\s*user\.id/);
  assert.match(route, /rpc\("revoke_side_feedback"/);
});

test("feedback revocation is atomic and its audit trail is pseudonymous", () => {
  const auditTable = migrations.match(
    /create table public\.side_feedback_consent_events \([\s\S]*?\n\);/i,
  )?.[0];
  assert.ok(auditTable, "consent audit table is missing");
  assert.doesNotMatch(auditTable, /user_id/i);
  assert.match(auditTable, /unique \(submission_id, event_type\)/i);
  assert.match(
    migrations,
    /grant select, insert, delete on table public\.side_feedback_consent_events to service_role/i,
  );
  assert.match(migrations, /create or replace function public\.revoke_side_feedback[\s\S]*?security invoker/i);
  assert.match(
    migrations,
    /create or replace function private\.queue_side_feedback_storage_cleanup\(\)[\s\S]*?security definer[\s\S]*?set search_path = ''/i,
  );
  assert.match(
    migrations,
    /delete from public\.side_landmark_feedback[\s\S]*?feedback\.user_id = p_user_id[\s\S]*?'revoked'/i,
  );
  assert.match(
    migrations,
    /revoke all on function public\.revoke_side_feedback\(uuid, uuid, uuid\)[\s\S]*?from public, anon, authenticated/i,
  );
  const cleanup = read("api/cleanup-side-correction-feedback.ts");
  assert.match(cleanup, /from\("side_feedback_consent_events"\)[\s\S]*?\.lte\("retain_until", now\)/);
});

test("settings feedback requests stay bound to the profile owner that opened the UI", () => {
  const auth = read("src/engine/auth.ts");
  const settings = read("src/ui/settings.ts");
  assert.match(auth, /currentAccessToken\(expectedUserId\?: string\)[\s\S]*?session\?\.user\.id !== expectedUserId/);
  assert.match(settings, /listSideCorrectionFeedback\(user\.id\)/);
  assert.match(settings, /revokeSideCorrectionFeedback\(user\.id, item\)/);
  assert.match(settings, /host !== activeHost \|\| !activeHost\.isConnected/);
});

test("server secrets are not referenced by browser source", () => {
  const browserSource = readdirSync(new URL("src/", root), { recursive: true })
    .filter((name) => typeof name === "string" && /\.(?:ts|tsx)$/.test(name))
    .map((name) => read(`src/${name}`))
    .join("\n");
  assert.doesNotMatch(
    browserSource,
    /SUPABASE_(?:SECRET|SERVICE_ROLE)_KEY|STRIPE_SECRET_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY|ELEVENLABS_API_KEY/,
  );
});

test("billable AI routes never log upstream bodies that may echo user content", () => {
  for (const path of ["api/ai-image.ts", "api/tts.ts"]) {
    const source = read(path);
    assert.doesNotMatch(source, /console\.(?:error|warn|log)\([^\n]*(?:detail|prompt|text|body|metadata|photo)/i);
  }
});
