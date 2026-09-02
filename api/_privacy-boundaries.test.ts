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
    "self_score_feedback",
    "billing_credit_events",
    "scan_credit_uses",
    "tts_render_reservations",
    "side_feedback_upload_claims",
  ]) {
    assert.match(
      migrations,
      new RegExp(`revoke\\s+all\\s+on(?:\\s+table)?\\s+public\\.${table}\\s+from[\\s\\S]{0,80}(?:anon|authenticated)`, "i"),
      `${table} is not explicitly revoked from browser roles`,
    );
  }
});

test("billable credits and narration are idempotent, atomic and server-only", () => {
  const webhook = read("api/stripe-webhook.ts");
  const checkout = read("api/create-checkout-session.ts");
  const reconcile = read("api/reconcile-purchase.ts");
  const entitlement = read("src/engine/entitlement.ts");
  const tts = read("api/tts.ts");
  assert.match(migrations, /create table if not exists public\.billing_credit_events[\s\S]*?event_id text primary key[\s\S]*?checkout_session_id text not null unique/i);
  assert.match(migrations, /create or replace function public\.apply_one_time_credit[\s\S]*?on conflict do nothing[\s\S]*?get diagnostics inserted = row_count/i);
  assert.match(webhook, /rpc\("apply_one_time_credit"/);
  assert.match(
    migrations,
    /create or replace function public\.reserve_downsell_checkout[\s\S]*?update public\.profiles as profile[\s\S]*?trial_declined_at is not null[\s\S]*?status in \('active', 'trialing'\)/i,
  );
  assert.match(
    migrations,
    /create or replace function public\.redeem_downsell_credit[\s\S]*?for update[\s\S]*?downsell_claim_id is distinct from p_claim_id[\s\S]*?downsell_checkout_session_id is distinct from p_checkout_session_id[\s\S]*?apply_one_time_credit[\s\S]*?downsell_redeemed_at/i,
  );
  for (const signature of [
    "claim_downsell\\(uuid\\)",
    "reserve_downsell_checkout\\(uuid, uuid\\)",
    "link_downsell_checkout\\(uuid, uuid, text\\)",
    "release_downsell_checkout\\(uuid, uuid, text\\)",
    "redeem_downsell_credit\\(text, text, uuid, uuid\\)",
  ]) {
    assert.match(
      migrations,
      new RegExp(`revoke all on function public\\.${signature}[\\s\\S]{0,120}?from public, anon, authenticated[\\s\\S]{0,120}?grant execute[\\s\\S]{0,120}?to service_role`, "i"),
      `${signature} is not service-only`,
    );
  }
  assert.match(checkout, /rpc\("reserve_downsell_checkout"[\s\S]*?checkout\.sessions\.create[\s\S]*?rpc\("link_downsell_checkout"/);
  assert.match(webhook, /rpc\("redeem_downsell_credit"/);
  assert.match(reconcile, /session\.status !== "complete"[\s\S]*?session\.mode !== "payment"[\s\S]*?session\.payment_status !== "paid"/);
  assert.match(reconcile, /session\.client_reference_id !== user\.id[\s\S]*?supabase_user_id !== user\.id/);
  assert.match(entitlement, /sessionStorage\.setItem\(PURCHASE_RETURN_KEY[\s\S]*?PURCHASE_RETURN_TTL_MS/);
  assert.match(entitlement, /clearPurchaseResult[\s\S]*?forgetStoredPurchaseResult/);
  assert.equal(
    (checkout.match(/\{CHECKOUT_SESSION_ID\}/g) ?? []).length,
    4,
    "every successful Stripe return must carry its exact Checkout Session",
  );
  assert.equal(
    (checkout.match(/integration_identifier: CHECKOUT_INTEGRATION_ID/g) ?? []).length,
    4,
    "every Checkout surface must be identifiable in Stripe Workbench",
  );
  assert.match(webhook, /checkout\.session\.async_payment_succeeded/);
  assert.match(webhook, /checkout\.session\.async_payment_failed[\s\S]*?release_downsell_checkout/);
  assert.match(webhook, /customer\.subscription\.deleted[\s\S]*?subscriptions\.retrieve\(event\.data\.object\.id\)/);
  assert.match(checkout, /Scan pricing lookup failed/);
  assert.match(migrations, /create or replace function public\.apply_stripe_entitlement[\s\S]*?auth\.users where id = p_user_id/);
  assert.match(migrations, /create table if not exists public\.scan_credit_uses[\s\S]*?primary key \(user_id, scan_id\)/i);
  assert.match(migrations, /create or replace function public\.consume_scan_credit_for_scan[\s\S]*?pg_advisory_xact_lock[\s\S]*?insert into public\.scan_credit_uses/i);
  assert.match(migrations, /create or replace function public\.claim_tts_render[\s\S]*?pg_advisory_xact_lock[\s\S]*?status = 'reserved'/i);
  assert.match(migrations, /create or replace function public\.refund_tts_render[\s\S]*?claimed_meter = 'voice'[\s\S]*?balance = credits\.balance \+ 1/i);
  assert.match(tts, /claimTtsRender[\s\S]*?speakWithElevenLabs[\s\S]*?refundTtsRender[\s\S]*?Voice generation is temporarily unavailable/);
  assert.doesNotMatch(tts, /json\(\{ error: attempts\.join/);
});

test("every anonymous-to-account scan refreshes identity state before access decisions", () => {
  const main = read("src/main.ts");
  const continuation = main.match(/async function continueAuthenticatedAnalysis[\s\S]*?\n}\n/)?.[0];
  assert.ok(continuation, "shared authenticated continuation is missing");
  assert.match(continuation, /await refreshMaxAccess\(\)[\s\S]*?ensureScanAllowed[\s\S]*?askLateSubject\(\)/);
  assert.match(main, /if \(user\) \{[\s\S]{0,120}?continueAuthenticatedAnalysis\(sideReport, token, generation\)/);
  assert.match(main, /onAuthenticated: async \(signedInUser\)[\s\S]{0,700}?continueAuthenticatedAnalysis/);
  assert.match(main, /async function resumePendingAfterAuth[\s\S]*?await refreshMaxAccess\(\)[\s\S]*?ensureScanAllowed/);
});

test("the signed-out result gate never puts exact scores behind CSS blur", () => {
  const main = read("src/main.ts");
  const account = read("src/ui/authModal.ts");
  const gatePreview = main.match(/preview = `<div class="lockblur gate-preview"[\s\S]*?<\/div>`;/)?.[0];
  const teaser = account.match(/function teaserMarkup[\s\S]*?return `<aside class="acct-teaser[\s\S]*?<\/aside>`;/)?.[0];
  assert.ok(gatePreview, "the signed-out gate preview is missing");
  assert.ok(teaser, "the account-modal teaser is missing");
  assert.match(gatePreview, /gate-prev-score">•••/);
  assert.match(gatePreview, /gate-prev-cell[\s\S]*?<b>•••<\/b>/);
  assert.doesNotMatch(gatePreview, /merged\.overall|g\.score/);
  assert.match(teaser, /acct-teaser-score[\s\S]*?<b>•••<\/b>/);
  assert.match(teaser, /acct-cell[\s\S]*?<b>•••<\/b>/);
  assert.doesNotMatch(teaser, /toFixed\(|scoreTone|--at/);
});

test("feedback caps and uniqueness are decided atomically", () => {
  const selfScore = read("api/self-score-feedback.ts");
  const side = read("api/side-correction-feedback.ts");
  assert.match(migrations, /create or replace function public\.submit_self_score_feedback[\s\S]*?pg_advisory_xact_lock[\s\S]*?scan_id = p_scan_id[\s\S]*?interval '24 hours'/i);
  assert.match(selfScore, /rpc\("submit_self_score_feedback"/);
  assert.doesNotMatch(selfScore, /\.from\("self_score_feedback"\)\.insert/);
  assert.match(migrations, /create or replace function public\.claim_side_feedback_upload[\s\S]*?pg_advisory_xact_lock[\s\S]*?status = 'reserved'/i);
  assert.match(side, /rpc\("claim_side_feedback_upload"[\s\S]*?storagePath/);
});

test("feedback schema precedes its hardening functions and accepts every current seed", () => {
  const tableAt = migrations.indexOf("create table if not exists public.self_score_feedback");
  const functionAt = migrations.indexOf("create or replace function public.submit_self_score_feedback");
  assert.ok(tableAt >= 0, "self_score_feedback table migration is missing");
  assert.ok(functionAt > tableAt, "self-score hardening runs before its table exists");
  assert.match(
    migrations,
    /add constraint side_feedback_seed_method[\s\S]*?check \(seed_method in \('mesh', 'silhouette', 'segmentation', 'vision', 'existing'\)\)/i,
  );
  assert.match(migrations, /add column if not exists seed_version text/i);
});

test("Creator League links, sprint writes and settlement are bounded in SQL", () => {
  assert.match(migrations, /league_tiktok_accounts_open_id_not_blank[\s\S]*?btrim\(open_id\) <> ''/i);
  assert.match(migrations, /delete from public\.league_tiktok_accounts as stale[\s\S]*?stale\.open_id = current\.open_id/i);
  assert.match(migrations, /league_tiktok_accounts_open_id_unique[\s\S]*?\(open_id\)/i);
  assert.match(migrations, /create policy submissions_self_insert[\s\S]*?sprint\.status = 'active'[\s\S]*?now\(\) between sprint\.starts_at and sprint\.ends_at/i);
  assert.match(migrations, /create or replace function public\.record_league_payout[\s\S]*?status = 'closed'[\s\S]*?on conflict \(sprint_id, creator_id\)[\s\S]*?status = 'paid_out'/i);
});

test("guest scans do not spend the owner's depth allowance or enter Max context", () => {
  const main = read("src/main.ts");
  const gate = read("src/ui/scanGate.ts");
  const results = read("src/ui/results.ts");
  assert.match(main, /resultAccessContext\?\.priorScanCount \?\? ownScans\(readAllHistory\(\)\)\.length/);
  assert.match(main, /ownScans\(historyBefore\)\.length - \(existingScan && !scanSubject \? 1 : 0\)/);
  assert.match(gate, /ownScans\(readAllHistory\(\)\)\.length >= TRIAL_SCANS/);
  assert.match(results, /scans: ownScans\(readAllHistory\(\)\)\.length/);
  // Guest scans now have a budget of their own, which makes the SEPARATION
  // load-bearing rather than incidental: a guest writes to GUEST_KEY and never
  // to the owner's weekly stamp, and the owner's slot arithmetic still reads
  // own scans only. Merging the two stores in either direction would let a
  // friend's face spend the owner's week, which is the thing this test is for.
  assert.match(gate, /const GUEST_KEY = "truemax\.guestScanTimes"/);
  assert.match(gate, /if \(guest\) \{[\s\S]{0,400}?scopedStorageKey\(GUEST_KEY\)[\s\S]{0,400}?return;\s*\}/);
  assert.match(gate, /const history = ownScans\(readAllHistory\(\)\)/);
});

test("late camera and rundown work cannot resurrect replaced user media", () => {
  const camera = read("src/ui/camera.ts");
  const quick = read("src/quick.ts");
  const exporter = read("src/ui/rundownExport.ts");
  assert.match(camera, /const attempt = \+\+attachAttempt[\s\S]*?!live \|\| attempt !== attachAttempt[\s\S]*?nextStream\.getTracks\(\)/);
  assert.match(camera, /stop\(\) \{[\s\S]*?live = false;[\s\S]*?attachAttempt\+\+[\s\S]*?removeEventListener\("visibilitychange"/);
  assert.match(quick, /if \(!last \|\| rundownRendering\) return/);
  assert.match(quick, /shouldCancel: \(\) => mediaEpoch !== rundownMediaEpoch \|\| source !== last/);
  assert.match(exporter, /const ensureCurrent[\s\S]*?throw new RundownCancelled[\s\S]*?for \(let frame[\s\S]*?ensureCurrent\(\)/);
});

test("public diagnostics do not inventory infrastructure", () => {
  for (const path of ["api/health.ts", "api/db-probe.ts"]) {
    const source = read(path);
    assert.match(source, /authorization[\s\S]*?Bearer \$\{secret\}/);
    assert.match(source, /return (?:Response\.)?json\(\{ ok: true \}/);
  }
});

test("the Stripe catalogue probe validates every required offer exactly", () => {
  const probe = read("api/stripe-config.ts");
  for (const cents of [799, 1199, 8999, 599, 299]) {
    assert.match(probe, new RegExp(`cents: ${cents}`));
  }
  assert.match(probe, /price\.currency === "usd"[\s\S]*?price\.unit_amount === entry\.cents[\s\S]*?actualInterval === expectedInterval/);
  assert.match(probe, /!p\.configured \|\| !p\.resolves \|\| p\.active === false \|\| p\.matchesExpected === false/);
  assert.match(probe, /\(\?:sk\|rk\)_live_/);
  assert.match(probe, /\(\?:sk\|rk\)_test_/);
});

test("the billing catalog names the shipped live offers rather than the retired scaffold", () => {
  const catalog = read("docs/BILLING_CATALOG.md");
  assert.match(catalog, /TrueMax Starter \| Recurring monthly \| \$7\.99 USD/);
  assert.match(catalog, /TrueMax Max \| Recurring yearly \| \$89\.99 USD/);
  assert.match(catalog, /Decline downsell \| One-time eligible account \| \$2\.99 USD/);
  assert.match(catalog, /Voiced analysis \| One-time \| \$2\.99 USD/);
  assert.doesNotMatch(catalog, /no active products|One-time scan payments are not fulfilled/);
});

test("billing Customer ids are accepted only through a user-bound Stripe subscription", () => {
  const shared = read("api/_shared.ts");
  const portal = read("api/create-portal-session.ts");
  const checkout = read("api/create-checkout-session.ts");
  assert.match(shared, /candidate\.metadata\.supabase_user_id === userId/);
  assert.match(shared, /filter\(\(subscription\) => subscription\.metadata\.supabase_user_id === userId\)/);
  assert.doesNotMatch(portal, /stripe_customer_id/);
  assert.doesNotMatch(checkout, /ent\?\.stripe_customer_id|entitlement\?\.stripe_customer_id/);
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
