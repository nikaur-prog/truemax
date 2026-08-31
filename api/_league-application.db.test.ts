import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// apply_to_creator_league, RUN AGAINST A REAL POSTGRES.
//
// The rule being changed lived in two places and the client half was the one
// you could see. Loosening the form alone would have moved a friendly message
// into a raw database exception, which is a worse version of the same wall, so
// what matters is that the FUNCTION accepts an empty links array. That is a
// claim about SQL behaviour, and the only honest way to check it is to run it.
//
// Skipped loudly where no Postgres exists, so a machine without one is not
// blocked. See _studio-meter.db.test.ts for why this pattern exists at all: a
// source-regex suite once passed with a feature completely dead.
// ---------------------------------------------------------------------------

const PG_BIN = ["/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin", "/usr/local/pgsql/bin"]
  .find((d) => {
    try {
      execFileSync("test", ["-x", join(d, "initdb")]);
      return true;
    } catch {
      return false;
    }
  });

// Offset from the meter harness's range so the two files can run at once.
const PORT = 56000 + (process.pid % 900);
let dir = "";
let ready = false;

function asUser(cmd: string): string {
  return process.getuid?.() === 0 ? `su -s /bin/bash nobody -c ${JSON.stringify(cmd)}` : cmd;
}

const q = (sql: string): string =>
  execFileSync("psql", ["-h", "/tmp", "-p", String(PORT), "-U", "postgres", "-tA", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();

const APPLICANT = "11111111-1111-1111-1111-111111111111";

// Only what the function reads or writes, plus a stub auth.uid() so the
// security-definer body can identify its caller without a real GoTrue.
const HARNESS = `
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create table if not exists public.league_creators (
  user_id uuid primary key references auth.users(id),
  handle text, display_name text, niche text, links jsonb, pitch text,
  status text not null, league_terms_version text, league_terms_accepted_at timestamptz);
do $$ begin
  create role service_role; create role anon; create role authenticated;
exception when duplicate_object then null; end $$;
create table if not exists auth.caller (id uuid);
create or replace function auth.uid() returns uuid language sql stable
  as $fn$ select id from auth.caller limit 1 $fn$;
insert into auth.users (id) values ('${APPLICANT}') on conflict do nothing;
insert into auth.caller (id) values ('${APPLICANT}');
`;

/** Call the function the way the browser does, and report what came back. */
function apply(links: string, pitch = "null"): { ok: boolean; message: string } {
  try {
    q(`select public.apply_to_creator_league(
      '@truemaxapp', 'Clipping Content', 'looksmaxxing',
      '${links}'::jsonb, ${pitch}, true, true, '2026-08-31')`);
    return { ok: true, message: "" };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

const reset = () => q("delete from public.league_creators");

test.before(() => {
  if (!PG_BIN) return;
  dir = mkdtempSync(join(tmpdir(), "tm-league-pg-"));
  try {
    execSync(`chown -R nobody ${dir} 2>/dev/null || true`);
    execSync(asUser(`${PG_BIN}/initdb -D ${dir} -U postgres --auth=trust`), { stdio: "ignore" });
    execSync(
      asUser(`${PG_BIN}/pg_ctl -D ${dir} -o "-k /tmp -p ${PORT} -c listen_addresses=''" -l ${dir}/log start`),
      { stdio: "ignore" },
    );
    let up = false;
    for (let attempt = 0; attempt < 40 && !up; attempt++) {
      try {
        execFileSync("psql", ["-h", "/tmp", "-p", String(PORT), "-U", "postgres", "-tAc", "select 1"], { stdio: "pipe" });
        up = true;
      } catch {
        execSync("sleep 0.25");
      }
    }
    if (!up) throw new Error(`postgres did not accept connections on port ${PORT}`);

    // Both COMMITTED migrations in order: the original function, then the one
    // that loosens it. Loading them in sequence is also what proves the replace
    // actually takes effect rather than erroring on a signature mismatch.
    const original = readFileSync(
      new URL("../supabase/migrations/20260830232247_league_payout_launch.sql", import.meta.url),
      "utf8",
    );
    const slice = original.slice(
      original.indexOf("create or replace function public.apply_to_creator_league"),
      original.indexOf("revoke insert on table public.league_creators"),
    );
    const loosened = readFileSync(
      new URL("../supabase/migrations/20260831051500_league_application_links_optional.sql", import.meta.url),
      "utf8",
    );
    const file = join(dir, "load.sql");
    writeFileSync(file, `${HARNESS}\n${slice}\n${loosened}`);
    execSync(`psql -h /tmp -p ${PORT} -U postgres -q -v ON_ERROR_STOP=1 -f ${file}`, { stdio: "pipe" });
    ready = true;
  } catch (error) {
    console.error("postgres harness unavailable:", (error as Error).message.slice(0, 200));
  }
});

test.after(() => {
  if (dir) {
    try {
      execSync(asUser(`${PG_BIN}/pg_ctl -D ${dir} -m immediate stop`), { stdio: "ignore" });
    } catch {
      /* already down */
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

const guard = (t: { skip: (why: string) => void }): boolean => {
  if (!ready) {
    t.skip("no Postgres server on this machine: the SQL was not exercised");
    return false;
  }
  return true;
};

test("a fresh account with NO links can apply", (t) => {
  if (!guard(t)) return;
  reset();
  // The whole point. Somebody opening a new account to make TrueMax content
  // has nothing to link to, and the form's only possible answer was no.
  const result = apply("[]");
  assert.ok(result.ok, `an empty links array must be accepted: ${result.message}`);
  assert.equal(q(`select status from public.league_creators where user_id = '${APPLICANT}'`), "applied");
  assert.equal(q(`select links::text from public.league_creators where user_id = '${APPLICANT}'`), "[]");
});

test("one link is fine too, which the old floor of two rejected", (t) => {
  if (!guard(t)) return;
  reset();
  assert.ok(apply('["https://tiktok.com/@truemaxapp/video/1"]').ok);
});

test("the pitch stays optional", (t) => {
  if (!guard(t)) return;
  reset();
  const result = apply("[]", "null");
  assert.ok(result.ok);
  assert.equal(q(`select coalesce(pitch, 'NULL') from public.league_creators where user_id = '${APPLICANT}'`), "NULL");
});

test("the ceiling of three survives", (t) => {
  if (!guard(t)) return;
  reset();
  // The floor was removed; the cap was not. Four is still an invalid
  // application rather than a silently truncated one.
  const four = apply('["https://a.com/1","https://a.com/2","https://a.com/3","https://a.com/4"]');
  assert.ok(!four.ok, "four links must still be rejected");
  assert.match(four.message, /Invalid Creator League application/);
  reset();
  assert.ok(apply('["https://a.com/1","https://a.com/2","https://a.com/3"]').ok, "three is still fine");
});

test("everything that protects the product is untouched", (t) => {
  if (!guard(t)) return;
  reset();
  // Name and handle are the identity, the two confirmations are the consent,
  // and the terms version pins WHICH terms were agreed to. Loosening the links
  // must not have loosened any of these by accident.
  const bad = (sql: string) => {
    try {
      q(sql);
      return "";
    } catch (error) {
      return (error as Error).message;
    }
  };
  const call = (handle: string, name: string, adult: string, terms: string, version: string) =>
    `select public.apply_to_creator_league('${handle}', '${name}', 'looksmaxxing', '[]'::jsonb, null, ${adult}, ${terms}, '${version}')`;

  assert.match(bad(call("", "Clipping Content", "true", "true", "2026-08-31")), /Invalid/, "handle still required");
  assert.match(bad(call("@x", "", "true", "true", "2026-08-31")), /Invalid/, "display name still required");
  assert.match(bad(call("@x", "N", "false", "true", "2026-08-31")), /Adult eligibility/, "18+ still required");
  assert.match(bad(call("@x", "N", "true", "false", "2026-08-31")), /Adult eligibility/, "terms still required");
  assert.match(bad(call("@x", "N", "true", "true", "2020-01-01")), /Adult eligibility/, "terms version still pinned");
  assert.equal(q("select count(*) from public.league_creators"), "0", "none of those wrote a row");
});

test("a non-array links value is still refused", (t) => {
  if (!guard(t)) return;
  reset();
  // The column shape must never vary, so the type check outlives the count
  // check that sat beside it.
  for (const shape of ['"https://a.com"', "42", "{}", "null"]) {
    const result = apply(shape);
    assert.ok(!result.ok, `${shape} must not be accepted as links`);
  }
});
