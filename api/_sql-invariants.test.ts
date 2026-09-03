import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

// ---------------------------------------------------------------------------
// The database invariants, run against a real Postgres.
//
// The other tests in this directory pin the migration TEXT. These run the
// migrations and then try to break what they promise: a goal paid twice, a
// day counted but unpaid, two phones migrating at once, a phone's value
// landing on a half-filled row, a signup blocked by a bad height. They need
// a Postgres to talk to, so they are skipped unless TRUEMAX_TEST_PG names
// one as a libpq conninfo string, for example:
//
//   TRUEMAX_TEST_PG="host=/tmp/tm-pg port=54329 user=postgres" npm test
//
// The harness creates a throwaway database, stubs the two things Supabase
// provides (the auth schema with auth.uid(), and the three roles), applies
// the three migrations verbatim, and drops the database at the end.
// ---------------------------------------------------------------------------

const CONN = process.env.TRUEMAX_TEST_PG;
const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const MIGRATIONS = [
  "supabase/migrations/20260903180000_body_profiles.sql",
  "supabase/migrations/20260904090000_daily_streak_and_points.sql",
  "supabase/migrations/20260904100000_body_profile_device_migration.sql",
];

const DB = `truemax_test_${process.pid}`;
const adminConn = CONN ?? "";
const testConn = `${adminConn.replace(/\bdbname=\S+/g, "").trim()} dbname=${DB}`;

function psql(conn: string, sql: string): string {
  return execFileSync("psql", ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", conn, "-c", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function psqlFile(conn: string, sql: string): void {
  execFileSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", conn], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}

/** A statement expected to fail; returns the error text. */
function psqlFails(conn: string, sql: string): string {
  try {
    psql(conn, sql);
  } catch (error) {
    return String((error as { stderr?: string }).stderr ?? error);
  }
  throw new Error(`expected a failure for: ${sql}`);
}

const STUBS = `
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to authenticated, service_role;
`;

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

let ready = false;
if (CONN) {
  psql(adminConn, `create database ${DB}`);
  try {
    psqlFile(testConn, STUBS);
    for (const file of MIGRATIONS) psqlFile(testConn, read(file));
    psql(testConn, `insert into auth.users (id) values ('${U1}'), ('${U2}')`);
    ready = true;
  } catch (error) {
    psql(adminConn, `drop database ${DB}`);
    throw error;
  }
}

const skip = CONN ? false : "set TRUEMAX_TEST_PG to a libpq conninfo string to run the database invariants";

test("verified progress pays once per goal, on any later day, and once per goal only", { skip }, () => {
  assert.equal(psql(testConn, `select public.award_progress('${U1}', 'jaw', '2026-09-01', 100)`), "100");
  assert.equal(psql(testConn, `select public.award_progress('${U1}', 'jaw', '2026-09-20', 100)`), "0", "the same goal on a later day pays nothing");
  assert.equal(psql(testConn, `select public.award_progress('${U1}', 'skin', '2026-09-20', 100)`), "100", "a different goal pays");
  assert.equal(psql(testConn, `select public.award_progress('${U2}', 'jaw', '2026-09-20', 100)`), "100", "another person's same goal pays");
  assert.equal(psql(testConn, `select points from public.points_balances where user_id = '${U1}' and ledger = 'progress'`), "200");
  assert.equal(psql(testConn, `select count(*) from public.points_events where user_id = '${U1}' and ledger = 'progress' and reason = 'jaw'`), "1");
});

test("a failed award leaves the day uncounted, so the retry counts and pays it once", { skip }, () => {
  // A negative base makes award_consistency raise inside count_streak_day.
  const error = psqlFails(testConn, `select public.count_streak_day('${U1}', '2026-09-04', -1, 10)`);
  assert.match(error, /Base points cannot be negative/);
  assert.equal(psql(testConn, `select count(*) from public.daily_streaks where user_id = '${U1}'`), "0", "nothing of the count survived the failed award");
  assert.equal(psql(testConn, `select count(*) from public.points_events where user_id = '${U1}' and ledger = 'consistency'`), "0");

  const first = JSON.parse(psql(testConn, `select public.count_streak_day('${U1}', '2026-09-04', 2, 10)`));
  assert.equal(first.counted, true);
  assert.equal(first.current, 1);
  assert.equal(first.awarded, 2);
  const again = JSON.parse(psql(testConn, `select public.count_streak_day('${U1}', '2026-09-04', 2, 10)`));
  assert.equal(again.counted, false);
  assert.equal(again.awarded, 0);
  assert.equal(psql(testConn, `select count(*) from public.points_events where user_id = '${U1}' and ledger = 'consistency'`), "1", "one day, one award, however many calls");
});

test("seven days bank a grace day and pay the week bonus at the tier reached; a miss spends it; a second miss ends the run", { skip }, () => {
  let last: Record<string, unknown> = {};
  for (let d = 5; d <= 10; d++) {
    last = JSON.parse(psql(testConn, `select public.count_streak_day('${U1}', '2026-09-${String(d).padStart(2, "0")}', 2, 10)`));
  }
  assert.equal(last.current, 7);
  assert.equal(last.weekLanded, true);
  assert.equal(last.graceBanked, 1);
  assert.equal(last.awarded, Math.round(2 * 1.1) + Math.round(10 * 1.1), "day and week both at 1.1x");
  assert.equal(psql(testConn, `select multiplier from public.points_events where user_id = '${U1}' and reason = 'week'`), "1.10");

  const skipped = JSON.parse(psql(testConn, `select public.count_streak_day('${U1}', '2026-09-12', 2, 10)`));
  assert.equal(skipped.counted, true);
  assert.equal(skipped.ended, false);
  assert.equal(skipped.current, 8);
  assert.equal(skipped.graceBanked, 0);

  const ended = JSON.parse(psql(testConn, `select public.count_streak_day('${U1}', '2026-09-14', 2, 10)`));
  assert.equal(ended.ended, true);
  assert.equal(ended.current, 1);
  assert.equal(ended.best, 8);
  assert.equal(psql(testConn, `select points from public.points_balances where user_id = '${U1}' and ledger = 'consistency'`), String(2 * 6 + 2 + 11 + 2 + 2));
});

test("the device migration fills only a completely empty profile", { skip }, () => {
  assert.equal(psql(testConn, `select public.migrate_body_profile('${U1}', 180.04, 80.06, 'metric')`), "t");
  assert.equal(psql(testConn, `select height_cm || '/' || weight_kg || '/' || source from public.body_profiles where user_id = '${U1}'`), "180.0/80.1/device_migration");
  assert.equal(psql(testConn, `select public.migrate_body_profile('${U1}', 170, 70, 'imperial')`), "f", "a second phone cannot overwrite");
  assert.equal(psql(testConn, `select height_cm || '/' || weight_kg || '/' || unit_preference from public.body_profiles where user_id = '${U1}'`), "180.0/80.1/metric");

  // A half-filled row is not empty.
  psql(testConn, `insert into public.body_profiles (user_id, height_cm, weight_kg, source) values ('${U2}', 175, null, 'settings')`);
  assert.equal(psql(testConn, `select public.migrate_body_profile('${U2}', 160, 60, 'metric')`), "f");
  assert.equal(psql(testConn, `select height_cm || '/' || coalesce(weight_kg::text, 'null') || '/' || source from public.body_profiles where user_id = '${U2}'`), "175.0/null/settings");

  // Cleared in Settings means empty again, and a later migration may fill it.
  psql(testConn, `update public.body_profiles set height_cm = null, weight_kg = null where user_id = '${U2}'`);
  assert.equal(psql(testConn, `select public.migrate_body_profile('${U2}', 160, 60, 'metric')`), "t");
});

test("two phones migrating at the same moment write once, and the first commit wins", { skip }, async () => {
  const U3 = "33333333-3333-4333-8333-333333333333";
  psql(testConn, `insert into auth.users (id) values ('${U3}')`);
  const run = (sql: string) =>
    new Promise<string>((resolve, reject) => {
      const child = spawn("psql", ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", testConn], { stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("close", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err))));
      child.stdin.end(sql);
    });
  // A holds its transaction open after writing; B arrives while A is open
  // and must wait on the row, then see it is no longer empty.
  const a = run(`begin; select public.migrate_body_profile('${U3}', 180, 80, 'metric'); select pg_sleep(1.5); commit;`);
  await new Promise((r) => setTimeout(r, 400));
  const b = run(`begin; select public.migrate_body_profile('${U3}', 170, 70, 'imperial'); commit;`);
  const [outA, outB] = await Promise.all([a, b]);
  assert.equal(outA.split("\n")[0], "t");
  assert.equal(outB.split("\n")[0], "f");
  assert.equal(psql(testConn, `select height_cm || '/' || weight_kg from public.body_profiles where user_id = '${U3}'`), "180.0/80.0");
  assert.equal(psql(testConn, `select count(*) from public.body_profiles where user_id = '${U3}'`), "1");
});

test("the signup trigger copies a valid pair and never blocks the account", { skip }, () => {
  psql(testConn, `insert into auth.users (id, raw_user_meta_data) values ('44444444-4444-4444-8444-444444444444', '{"height_cm": "182", "weight_kg": "77.25", "unit_preference": "imperial"}')`);
  assert.equal(psql(testConn, `select height_cm || '/' || weight_kg || '/' || unit_preference || '/' || source from public.body_profiles where user_id = '44444444-4444-4444-8444-444444444444'`), "182.0/77.3/imperial/signup");
  psql(testConn, `insert into auth.users (id, raw_user_meta_data) values ('55555555-5555-4555-8555-555555555555', '{"height_cm": "20", "weight_kg": "77"}')`);
  assert.equal(psql(testConn, `select count(*) from public.body_profiles where user_id = '55555555-5555-4555-8555-555555555555'`), "0", "out of bounds is dropped, the account exists");
  psql(testConn, `insert into auth.users (id, raw_user_meta_data) values ('66666666-6666-4666-8666-666666666666', '{"height_cm": "tall", "weight_kg": "77"}')`);
  assert.equal(psql(testConn, `select count(*) from auth.users where id = '66666666-6666-4666-8666-666666666666'`), "1", "garbage is dropped, the account exists");
});

test("a signed-in browser reads only its own rows and writes none of them", { skip }, () => {
  const asUser = (uid: string, sql: string) =>
    psql(testConn, `set role authenticated; set request.jwt.claim.sub = '${uid}'; ${sql}`);
  assert.equal(asUser(U1, `select count(*) from public.daily_streaks`), "1", "own streak row visible");
  assert.equal(asUser(U2, `select count(*) from public.daily_streaks`), "0", "nobody else's row is visible");
  assert.equal(asUser(U1, `select count(*) from public.points_balances where ledger = 'consistency'`), "1");
  assert.equal(asUser(U2, `select coalesce(sum(points), 0) from public.points_balances`), "100", "only their own jaw award, none of U1's");
  assert.equal(asUser(U2, `select count(*) from public.points_events where user_id = '${U1}'`), "0", "another person's events are invisible even when named");
  assert.equal(asUser(U1, `select count(*) from public.body_profiles`), "1");
  for (const write of [
    `insert into public.points_events (user_id, ledger, reason, day, base, multiplier, points) values ('${U1}', 'consistency', 'x', '2026-09-01', 1, 1.00, 999)`,
    `update public.daily_streaks set current = 999 where user_id = '${U1}'`,
    `select public.award_progress('${U1}', 'jaw2', '2026-09-01', 100)`,
    `select public.count_streak_day('${U1}', '2026-09-30', 2, 10)`,
    `select public.migrate_body_profile('${U1}', 150, 50, 'metric')`,
  ]) {
    const error = psqlFails(testConn, `set role authenticated; set request.jwt.claim.sub = '${U1}'; ${write}`);
    assert.match(error, /permission denied/i, `browser role must not be able to: ${write}`);
  }
  // The service role can never rewrite history either.
  const rewrite = psqlFails(testConn, `set role service_role; update public.points_events set points = 0 where user_id = '${U1}'`);
  assert.match(rewrite, /permission denied/i);
  const erase = psqlFails(testConn, `set role service_role; delete from public.points_events where user_id = '${U1}'`);
  assert.match(erase, /permission denied/i);
});

test.after(() => {
  if (ready) psql(adminConn, `drop database ${DB}`);
});
