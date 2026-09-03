import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseCountRequest } from "./streak.js";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const migration = read("supabase/migrations/20260904090000_daily_streak_and_points.sql");
const route = read("api/streak.ts");
const report = read("api/funnel-report.ts");

test("the count request needs a known reason and a day within the server window", () => {
  const now = new Date("2026-09-04T12:00:00Z");
  assert.deepEqual(parseCountRequest({ day: "2026-09-04", reason: "routine" }, now), { day: "2026-09-04", reason: "routine" });
  assert.ok("error" in parseCountRequest({ day: "2026-09-04", reason: "login" }, now), "opening the app is not a reason");
  assert.ok("error" in parseCountRequest({ day: "2026-09-10", reason: "scan" }, now), "a clock cannot be walked forward");
  assert.ok("error" in parseCountRequest({ day: "2026-08-20", reason: "scan" }, now));
  assert.ok("error" in parseCountRequest(null, now));
  assert.ok("error" in parseCountRequest({ reason: "checkin" }, now));
});

test("every streak method checks the origin, then the session, and the payload carries no user id", () => {
  for (const method of ["GET", "POST", "PATCH"]) {
    const body = route.match(new RegExp(`export async function ${method}\\(request: Request\\)[\\s\\S]*?\\n}\\n`))?.[0];
    assert.ok(body, `${method} handler is missing`);
    assert.match(body, /requestOrigin\(request\)[\s\S]*?authenticatedUser\(request\)/);
    assert.match(body, /user\.id/);
  }
  assert.doesNotMatch(route, /raw\.userId|body\.userId|p_user_id: (?!user\.id)/);
});

test("the count and both awards are one database transaction, and the funnel learns counts only", () => {
  const post = route.match(/export async function POST[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(post, /rpc\("count_streak_day", \{[\s\S]*?p_day_base: CONSISTENCY_POINTS_PER_DAY,[\s\S]*?p_week_base: STREAK_WEEK_BONUS,/);
  assert.doesNotMatch(post, /rpc\("award_consistency"/, "the route never awards on its own; the function does, inside the count");
  assert.match(post, /if \(result\.counted\) \{[\s\S]*?bump_funnel_event[\s\S]*?"streak-day-counted"[\s\S]*?"streak-ended"/);
  assert.doesNotMatch(route, /award_progress/, "verified progress is never awarded by the streak route");
  const fn = migration.match(/create or replace function public\.count_streak_day[\s\S]*?\$\$;/)?.[0] ?? "";
  assert.match(fn, /update public\.daily_streaks[\s\S]*?day_points := public\.award_consistency\(p_user_id, 'day', p_day, p_day_base\);[\s\S]*?if week_landed then[\s\S]*?week_points := public\.award_consistency\(p_user_id, 'week', p_day, p_week_base\);/);
  assert.match(fn, /'awarded', day_points \+ week_points/);
});

test("verified progress pays once per goal, ever, by a database invariant", () => {
  assert.match(migration, /create unique index if not exists points_events_progress_once\s+on public\.points_events \(user_id, reason\)\s+where ledger = 'progress'/);
  assert.match(migration, /award_progress[\s\S]*?on conflict \(user_id, reason\) where ledger = 'progress' do nothing/);
});

test("the streak and points tables are owner-readable, service-written, and the ledger is append-only", () => {
  for (const table of ["daily_streaks", "points_events"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on public\\.${table} from anon`));
    assert.match(migration, new RegExp(`revoke insert, update, delete on public\\.${table} from authenticated`));
    assert.match(migration, new RegExp(`create policy "own [a-z]+ - read"\\s+on public\\.${table} for select\\s+to authenticated\\s+using \\(\\(select auth\\.uid\\(\\)\\) = user_id\\)`));
  }
  assert.match(migration, /revoke update, delete on public\.points_events from service_role;\s+grant select, insert on public\.points_events to service_role/);
  assert.match(migration, /unique \(user_id, ledger, reason, day\)/);
  assert.match(migration, /create or replace view public\.points_balances\s+with \(security_invoker = true\)/);
  assert.match(migration, /grace_banked between 0 and 2/);
  for (const signature of ["streak_multiplier\\(integer\\)", "count_streak_day\\(uuid, date, integer, integer\\)", "award_consistency\\(uuid, text, date, integer\\)", "award_progress\\(uuid, text, date, integer\\)"]) {
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${signature} from public, anon, authenticated;\\s+grant execute on function public\\.${signature} to service_role`),
      `${signature} is not service-only`,
    );
  }
  assert.match(migration, /award_consistency[\s\S]*?on conflict \(user_id, ledger, reason, day\) do nothing/);
  assert.match(migration, /award_progress[\s\S]*?'progress', p_reason, p_day, p_points, 1\.00, p_points/, "progress is never multiplied");
});

test("count_streak_day is idempotent per day, spends grace, banks one per seven, and keeps the best", () => {
  const fn = migration.match(/create or replace function public\.count_streak_day[\s\S]*?\$\$;/)?.[0] ?? "";
  assert.match(fn, /for update/);
  assert.match(fn, /elsif p_day > s\.last_counted_day then/);
  assert.match(fn, /if missed <= s\.grace_banked then[\s\S]*?s\.grace_banked := s\.grace_banked - missed;[\s\S]*?s\.current := s\.current \+ 1;[\s\S]*?else[\s\S]*?ended := s\.current > 0;[\s\S]*?s\.current := 1;/);
  assert.match(fn, /if s\.current % 7 = 0 then\s+s\.grace_banked := least\(2, s\.grace_banked \+ 1\);/);
  assert.match(fn, /s\.best := greatest\(s\.best, s\.current\)/);
});

test("the funnel report is staff-only behind a 404 and reads counts only", () => {
  assert.match(report, /requestOrigin\(request\)\) return json\(\{ error: "Not found\." \}, 404\)/);
  assert.match(report, /!user \|\| !\(await isStaff\(user\.id\)\)\) return json\(\{ error: "Not found\." \}, 404\)/);
  assert.match(report, /\.from\("funnel_events"\)\s+\.select\("day,event,count"\)/);
});

test("no loss framing in the streak surfaces", () => {
  for (const source of [route, read("src/engine/dailyStreak.ts")]) {
    assert.doesNotMatch(source, /\blose\b|\blost\b|\bbroke|\bbreak\b|don't miss|\bflame|\bfire\b/i);
    assert.doesNotMatch(source, /—/);
  }
});
