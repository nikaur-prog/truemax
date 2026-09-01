import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

test("Max conversation tables are private, owner-linked and photo-free", () => {
  const migration = read("supabase/migrations/20260902090000_max_conversation_memory.sql");
  for (const table of ["max_conversations", "max_messages", "max_plan_items"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, "i"));
  }
  assert.match(migration, /foreign key \(conversation_id, user_id\)[\s\S]*?references public\.max_conversations \(id, user_id\)/i);
  assert.match(migration, /max_plan_items_owner_title_unique unique \(user_id, normalized_title\)/i);
  assert.doesNotMatch(migration, /\b(?:photo_url|photo_data|landmarks|scan_payload)\s+(?:text|jsonb|bytea)/i);
});

test("chat generation saves the owner conversation and returns its id", () => {
  const route = read("api/max-chat.ts");
  assert.match(route, /maxAccessForUser\(user\.id\)/);
  assert.match(route, /from\("max_conversations"\)[\s\S]*?user_id: user\.id/);
  assert.match(route, /from\("max_messages"\)\.insert\([\s\S]*?role: "user"/);
  assert.match(route, /from\("max_messages"\)\.insert\([\s\S]*?role: "assistant"/);
  assert.match(route, /"X-Max-Conversation": conversation\.id/);
  assert.match(route, /parsePlanMemoryCommand\(latest\)/);
});

test("conversation reads are paywalled and owner-scoped on every query", () => {
  const route = read("api/max-conversations.ts");
  assert.match(route, /maxAccessForUser\(user\.id\)/);
  assert.match(route, /from\("max_conversations"\)[\s\S]*?\.eq\("user_id", user\.id\)/);
  assert.match(route, /from\("max_messages"\)[\s\S]*?\.eq\("user_id", user\.id\)/);
  assert.match(route, /from\("max_plan_items"\)[\s\S]*?\.eq\("user_id", user\.id\)/);
});

test("the archived full-analysis handoff closes the dashboard above it", () => {
  const main = read("src/main.ts");
  const reopen = main.match(/async function reopenArchivedScan[\s\S]*?\n}\n\nsetScanReopen/)?.[0];
  assert.ok(reopen, "archived scan reopen function is missing");
  assert.match(reopen, /closeDashboard\(\)[\s\S]*?renderResults\(/);
});

test("under-18 Max purchase is blocked by the server and the offer explains why", () => {
  const checkout = read("api/create-checkout-session.ts");
  const offer = read("src/ui/onboardingFunnel.ts");
  assert.match(checkout, /tier === "max" && !isAdult\(profile\.date_of_birth\)[\s\S]*?Max is available from age 18/);
  assert.match(offer, /weight, calorie and body-composition coaching written for adults/);
  assert.match(offer, /data-checkout="max"[^>]*\$\{adult \? "" : "disabled"\}/);
});
