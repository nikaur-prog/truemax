import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("./tiktok-auth.ts", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../supabase/migrations/20260901013000_allow_staff_tiktok_links.sql", import.meta.url),
  "utf8",
);

test("a staff TikTok link is authorized and can satisfy its foreign key", () => {
  assert.match(route, /from\("app_admins"\)[\s\S]*from\("league_creators"\)/);
  assert.match(route, /return Boolean\(staff\) \|\| creator\?\.status === "approved"/);
  assert.match(migration, /foreign key \(user_id\) references auth\.users \(id\) on delete cascade/i);
  assert.doesNotMatch(migration, /references public\.league_creators/i);
});

test("the creator dashboard stays inside the already-approved display scopes", () => {
  assert.match(route, /fields=open_id,display_name,avatar_url/);
  assert.match(route, /const SCOPES = "user\.info\.basic,video\.list"/);
  assert.match(route, /listOwnTikTokVideos\(access, 20, undefined, true\)/);
  assert.match(route, /syncedAt: new Date\(\)\.toISOString\(\)/);
});
