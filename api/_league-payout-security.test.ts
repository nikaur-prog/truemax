import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260830232247_league_payout_launch.sql", import.meta.url),
  "utf8",
);
const payoutApi = readFileSync(new URL("./league-payout.ts", import.meta.url), "utf8");
const connectApi = readFileSync(new URL("./league-connect.ts", import.meta.url), "utf8");
const leagueClient = readFileSync(new URL("../src/league/main.ts", import.meta.url), "utf8");
const leagueTracker = readFileSync(new URL("./league-track.ts", import.meta.url), "utf8");
const tiktokClient = readFileSync(new URL("./_tiktok.ts", import.meta.url), "utf8");

test("the browser cannot choose a payout amount or call the old writer", () => {
  assert.doesNotMatch(leagueClient, /record_league_payout/);
  assert.doesNotMatch(payoutApi, /body\.amount|amountCents/);
  assert.match(migration, /revoke all on function public\.record_league_payout[\s\S]*?service_role/i);
  assert.match(migration, /revoke all on table public\.league_payouts from anon, authenticated/i);
});

test("close locks the sprint and freezes counts in the same database function", () => {
  assert.match(migration, /finalize_league_sprint[\s\S]*?for update[\s\S]*?set status = 'closed'[\s\S]*?insert into public\.league_payouts/i);
  assert.match(migration, /before insert on public\.league_stat_snapshots[\s\S]*?guard_league_snapshot_insert/i);
  assert.match(migration, /revoke insert, update, delete on table public\.league_sprints from authenticated/i);
});

test("ownership alone cannot make an unrelated creator post payable", () => {
  assert.match(migration, /caption_compliant is true[\s\S]*?cta_verified_at is not null[\s\S]*?disclosure_verified_at is not null/i);
  assert.match(migration, /create or replace function public\.review_league_submission/i);
  assert.match(migration, /revoke update, delete on table public\.league_submissions from authenticated/i);
  assert.match(migration, /and tiktok_video_id is null[\s\S]*?and cta_verified_at is null/i);
  assert.doesNotMatch(leagueClient, /from\("league_submissions"\)\.update\(\{ status: "approved"/);
  assert.match(leagueClient, /rpc\("review_league_submission"/);
  assert.match(tiktokClient, /TRACKING_VIDEO_FIELDS[\s\S]{0,120}?video_description/);
  assert.match(tiktokClient, /videosUrl[\s\S]{0,240}?TRACKING_VIDEO_FIELDS/);
  assert.match(leagueTracker, /captionIncludesCampaignTag\(video\.description/);
  assert.match(leagueTracker, /submissionCanAccrue\([\s\S]*?league_stat_snapshots/i);
});

test("settlement requires a post-deadline compliance recheck", () => {
  assert.match(migration, /Every earning post needs a final caption, CTA and disclosure review/i);
  assert.match(migration, /caption_checked_at is null or sub\.caption_checked_at < sprint\.ends_at/i);
  assert.match(migration, /sub\.cta_verified_at is null or sub\.cta_verified_at < sprint\.ends_at/i);
  assert.match(leagueClient, /Re-check before settlement/);
  assert.doesNotMatch(leagueTracker, /\.gt\("league_sprints\.ends_at"/);
  assert.match(leagueTracker, /beforeDeadline && submissionCanAccrue/);
});

test("pool scaling uses floors plus deterministic largest remainders", () => {
  assert.match(migration, /floor\(accrued_cents::numeric \* sprint\.pool_cents \/ total_accrued\)/i);
  assert.match(migration, /mod\(accrued_cents \* sprint\.pool_cents::bigint, total_accrued\)/i);
  assert.match(migration, /row_number\(\) over \(order by remainder desc, creator_id\)/i);
  assert.match(migration, /case when total_accrued <= sprint\.pool_cents then 0\s+else sprint\.pool_cents - sum\(base_cents\) over \(\)\s+end as cents_left/i);
});

test("transfers are mode-bound, service-only and idempotent", () => {
  assert.match(migration, /claim_league_transfer_for_mode\(uuid, boolean\)[\s\S]*?to service_role/i);
  assert.match(payoutApi, /idempotencyKey: `league-payout:\$\{payout\.payout_id\}`/);
  assert.match(payoutApi, /LEAGUE_PAYOUTS_ENABLED !== "true"/);
  assert.doesNotMatch(payoutApi, /destination:\s*body\./);
});

test("onboarding is idempotent and never exposes bank details", () => {
  assert.match(connectApi, /claim_league_payout_account_setup/);
  assert.match(connectApi, /idempotencyKey: `league-connect:/);
  assert.match(connectApi, /configuration:\s*\{[\s\S]*?recipient:/);
  assert.doesNotMatch(connectApi, /bank_account|account_number|routing_number/);
  assert.doesNotMatch(migration, /grant select on table public\.league_payout_accounts to authenticated/i);
  assert.match(connectApi, /payoutCountryAllowed\(country\)/);
});

test("creator terms are explicit and cannot be forged by a legacy default", () => {
  assert.doesNotMatch(migration, /league_terms_version text not null default/i);
  assert.doesNotMatch(migration, /league_terms_accepted_at timestamptz not null default/i);
  assert.match(migration, /insert into public\.league_creators[\s\S]*?league_terms_version, league_terms_accepted_at/i);
  assert.match(migration, /revoke update on table public\.league_creators from authenticated/i);
});

test("refund and dispute transitions are idempotent and debt-aware", () => {
  assert.match(migration, /billing_credit_adjustment_events[\s\S]*?event_id text primary key/i);
  assert.match(migration, /refund_active boolean[\s\S]*?dispute_active boolean/i);
  assert.match(migration, /balance = greatest\(0, current_balance - n\)[\s\S]*?debt = current_debt \+ greatest/i);
  assert.match(migration, /if inserted = 0 then return true; end if/i);
});
