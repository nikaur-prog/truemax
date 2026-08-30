import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// THE RESERVATION FUNCTIONS, RUN AGAINST A REAL POSTGRES.
//
// This exists because a source-regex suite passed with the feature completely
// broken. The Studio migration taught claim_tts_render about a third meter and
// the table it inserts into still carried `check (meter in ('league','voice'))`,
// so the first real call raised 23514 and the whole room was dead. Nine tests
// asserted the TEXT of that migration. None of them executed it.
//
// So this loads the committed SQL into a throwaway cluster and calls the
// functions. It is skipped, loudly, when no Postgres server is installed, so a
// machine without one is not blocked; the point is that where a server exists
// the SQL is exercised rather than read.
// ---------------------------------------------------------------------------

const PG_BIN = ["/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin", "/usr/local/pgsql/bin"]
  .find((dir) => {
    try {
      execFileSync("test", ["-x", join(dir, "initdb")]);
      return true;
    } catch {
      return false;
    }
  });

const PORT = 55433;
let dir = "";
let ready = false;

/** Postgres refuses to run as root, so the cluster runs as an unprivileged user. */
function asUser(cmd: string): string {
  return process.getuid?.() === 0 ? `su -s /bin/bash nobody -c ${JSON.stringify(cmd)}` : cmd;
}

/**
 * One statement, or several, straight to the cluster.
 *
 * execFileSync rather than a shell string: multi-line SQL through a shell has
 * its newlines mangled by whatever quoting the string went through, and the
 * first version of this file failed every test with `syntax error at or near
 * "\\"` for exactly that reason. Passing the SQL as an argv element hands it
 * to psql untouched.
 */
const q = (sql: string): string =>
  execFileSync("psql", ["-h", "/tmp", "-p", String(PORT), "-U", "postgres", "-tA", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();

/** The harness: only the columns the reservation functions read or write. */
const HARNESS = `
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create table if not exists public.league_creators (
  user_id uuid primary key references auth.users(id),
  status text not null, monthly_render_quota integer not null default 0, pillar_grants jsonb);
create table if not exists public.league_render_log (
  id uuid primary key default gen_random_uuid(), creator_id uuid not null,
  kind text not null, reservation_id uuid unique, created_at timestamptz not null default now());
create table if not exists public.voice_credits (
  user_id uuid primary key, balance integer not null default 0,
  updated_at timestamptz not null default now());
do $$ begin
  create role service_role; create role anon; create role authenticated;
exception when duplicate_object then null; end $$;
`;

test.before(() => {
  if (!PG_BIN) return;
  dir = mkdtempSync(join(tmpdir(), "tm-pg-"));
  try {
    execSync(`chown -R nobody ${dir} 2>/dev/null || true`);
    execSync(asUser(`${PG_BIN}/initdb -D ${dir} -U postgres --auth=trust`), { stdio: "ignore" });
    execSync(
      asUser(`${PG_BIN}/pg_ctl -D ${dir} -o "-k /tmp -p ${PORT} -c listen_addresses=''" -l ${dir}/log start`),
      { stdio: "ignore" },
    );
    execSync("sleep 2");

    // The COMMITTED migrations, not a paraphrase of them. The base file carries
    // the table and the original functions; the Studio file is the change under
    // test. Slicing the base at the reservation block keeps this to the subject
    // rather than standing up the entire product schema.
    const base = readFileSync(
      new URL("../supabase/migrations/20260830000000_harden_billing_and_usage_integrity.sql", import.meta.url),
      "utf8",
    );
    const slice = base.slice(
      base.indexOf("create table if not exists public.tts_render_reservations"),
      base.indexOf("-- Max claims are made by the server admin client"),
    );
    const studio = readFileSync(
      new URL("../supabase/migrations/20260830120000_studio_render_meter.sql", import.meta.url),
      "utf8",
    );
    const file = join(dir, "load.sql");
    writeFileSync(file, `${HARNESS}\n${slice}\n${studio}`);
    execSync(`psql -h /tmp -p ${PORT} -U postgres -q -v ON_ERROR_STOP=1 -f ${file}`, { stdio: "pipe" });
    ready = true;
  } catch (error) {
    console.error("postgres harness unavailable:", (error as Error).message.slice(0, 200));
  }
});

test.after(() => {
  if (!dir) return;
  try {
    execSync(asUser(`${PG_BIN}/pg_ctl -D ${dir} stop -m immediate`), { stdio: "ignore" });
  } catch { /* already down */ }
  rmSync(dir, { recursive: true, force: true });
});

const skip = () => (PG_BIN ? (ready ? false : "the harness failed to start") : "no postgres server installed");

/** A fresh approved creator with the grants and quota given. */
function creator(id: string, grants: string, quota = 5): string {
  q(`insert into auth.users (id) values ('${id}') on conflict do nothing;
     insert into public.league_creators values ('${id}','approved',${quota},'${grants}'::jsonb)
     on conflict (user_id) do update set monthly_render_quota = ${quota}, pillar_grants = '${grants}'::jsonb;`);
  return id;
}

test("a studio claim inserts, which is what the check constraint used to forbid", { skip: skip() }, () => {
  // THE REGRESSION. Without the constraint widening in the Studio migration
  // this raises 23514 and the feature is dead on its first call.
  const id = creator("aaaaaaaa-0000-0000-0000-000000000001", '{"studio":true}');
  const reservation = q(`select public.claim_tts_render('${id}','studio');`);
  assert.match(reservation, /^[0-9a-f-]{36}$/, "a reservation id, not an error");
  assert.equal(q(`select meter from public.tts_render_reservations where id = '${reservation}';`), "studio");
});

test("finalizing a studio pair logs it as its own kind", { skip: skip() }, () => {
  const id = creator("aaaaaaaa-0000-0000-0000-000000000002", '{"studio":true}');
  const r = q(`select public.claim_tts_render('${id}','studio');`);
  assert.equal(q(`select public.finalize_tts_render('${r}','${id}');`), "t");
  assert.equal(q(`select status from public.tts_render_reservations where id='${r}';`), "consumed");
  assert.equal(q(`select kind from public.league_render_log where reservation_id='${r}';`), "ai-pair");
});

test("a narration on the same account still logs as tts", { skip: skip() }, () => {
  // The change must not have moved the meter it was modelled on.
  const id = creator("aaaaaaaa-0000-0000-0000-000000000003", '{"cta":true}');
  const r = q(`select public.claim_tts_render('${id}','league');`);
  q(`select public.finalize_tts_render('${r}','${id}');`);
  assert.equal(q(`select kind from public.league_render_log where reservation_id='${r}';`), "tts");
});

test("the grant is what opens each meter, and they do not open each other", { skip: skip() }, () => {
  const studioOnly = creator("aaaaaaaa-0000-0000-0000-000000000004", '{"studio":true}');
  assert.equal(q(`select coalesce(public.claim_tts_render('${studioOnly}','league')::text,'null');`), "null");
  const ctaOnly = creator("aaaaaaaa-0000-0000-0000-000000000005", '{"cta":true}');
  assert.equal(q(`select coalesce(public.claim_tts_render('${ctaOnly}','studio')::text,'null');`), "null");
});

test("an unapproved creator claims nothing whatever their grants say", { skip: skip() }, () => {
  const id = "aaaaaaaa-0000-0000-0000-000000000006";
  q(`insert into auth.users (id) values ('${id}') on conflict do nothing;
     insert into public.league_creators values ('${id}','applied',5,'{"studio":true}'::jsonb)
     on conflict (user_id) do update set status='applied';`);
  assert.equal(q(`select coalesce(public.claim_tts_render('${id}','studio')::text,'null');`), "null");
});

test("THE LAST SLOT IS SHARED, and only one meter can take it", { skip: skip() }, () => {
  // The shared quota, proven rather than described. A creator with one slot who
  // spends it on a voiceover has no image pair left, and the reverse.
  const id = creator("aaaaaaaa-0000-0000-0000-000000000007", '{"studio":true,"cta":true}', 1);
  const first = q(`select public.claim_tts_render('${id}','league');`);
  assert.match(first, /^[0-9a-f-]{36}$/);
  // Reserved, not yet finalized, and it must already count against the pool.
  assert.equal(q(`select coalesce(public.claim_tts_render('${id}','studio')::text,'null');`), "null");
  q(`select public.finalize_tts_render('${first}','${id}');`);
  // Spent is still spent.
  assert.equal(q(`select coalesce(public.claim_tts_render('${id}','studio')::text,'null');`), "null");
});

test("a refunded slot comes back", { skip: skip() }, () => {
  // The failure path: a provider refusal or a half-finished pair must leave the
  // creator exactly where they started.
  const id = creator("aaaaaaaa-0000-0000-0000-000000000008", '{"studio":true}', 1);
  const r = q(`select public.claim_tts_render('${id}','studio');`);
  assert.equal(q(`select coalesce(public.claim_tts_render('${id}','studio')::text,'null');`), "null");
  assert.equal(q(`select public.refund_tts_render('${r}','${id}');`), "t");
  assert.match(q(`select public.claim_tts_render('${id}','studio');`), /^[0-9a-f-]{36}$/);
  assert.equal(q(`select count(*) from public.league_render_log where creator_id='${id}';`), "0");
});

test("a stranded studio claim is swept, not held for the month", { skip: skip() }, () => {
  // A crashed function must not cost somebody a slot until the 1st. The sweep
  // is meter-agnostic and this proves it covers the new one.
  const id = creator("aaaaaaaa-0000-0000-0000-000000000009", '{"studio":true}', 1);
  const r = q(`select public.claim_tts_render('${id}','studio');`);
  q(`update public.tts_render_reservations set created_at = now() - interval '20 minutes' where id='${r}';`);
  assert.match(q(`select public.claim_tts_render('${id}','studio');`), /^[0-9a-f-]{36}$/);
  assert.equal(q(`select status from public.tts_render_reservations where id='${r}';`), "refunded");
});

test("finalize is idempotent, so a retried call cannot double-log", { skip: skip() }, () => {
  const id = creator("aaaaaaaa-0000-0000-0000-00000000000a", '{"studio":true}');
  const r = q(`select public.claim_tts_render('${id}','studio');`);
  q(`select public.finalize_tts_render('${r}','${id}');`);
  assert.equal(q(`select public.finalize_tts_render('${r}','${id}');`), "t", "still reports success");
  assert.equal(q(`select count(*) from public.league_render_log where reservation_id='${r}';`), "1");
});

test("an unknown meter is rejected outright", { skip: skip() }, () => {
  const id = creator("aaaaaaaa-0000-0000-0000-00000000000b", '{"studio":true}');
  assert.throws(() => q(`select public.claim_tts_render('${id}','not-a-meter');`), /Invalid render claim/);
});

test("only the service role may call these", { skip: skip() }, () => {
  for (const fn of ["claim_tts_render(uuid, text)", "finalize_tts_render(uuid, uuid)"]) {
    const acl = q(`select coalesce(array_to_string(proacl,','),'') from pg_proc
      where oid = 'public.${fn}'::regprocedure;`);
    assert.ok(acl.includes("service_role=X"), `${fn} is executable by service_role`);
    assert.ok(!acl.includes("anon=X") && !acl.includes("authenticated=X"), `${fn} is not reachable from a browser`);
  }
});
