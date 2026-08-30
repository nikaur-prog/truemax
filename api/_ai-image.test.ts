import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The Studio meter. These are source and SQL assertions because the route
// drives OpenAI and Postgres and cannot be imported here, but the thing being
// asserted is an ORDER and an atomicity property, which is exactly what would
// rot silently: a refactor that moves the reservation after the first image
// call still passes every other test in this repository.
const route = readFileSync(new URL("./ai-image.ts", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../supabase/migrations/20260830120000_studio_render_meter.sql", import.meta.url),
  "utf8",
);

test("the quota is claimed in SQL, not counted and then spent", () => {
  // THE RACE THIS EXISTS TO CLOSE. The obvious shape was leagueRenderBudget()
  // to check, two OpenAI calls, then recordLeagueRender() to log. That is a
  // check-then-spend with two slow network calls in the middle: two pairs
  // requested at once both read the same remaining count and both take the
  // last slot.
  assert.match(route, /claimTtsRender\(user\.id, meter\)/);
  assert.doesNotMatch(route, /leagueRenderBudget/, "the non-atomic path must not come back");
  assert.doesNotMatch(route, /recordLeagueRender/);
  // The serialization itself.
  assert.match(migration, /pg_advisory_xact_lock/);
});

test("the slot is reserved BEFORE the first billable call", () => {
  const claim = route.indexOf("reservation = await claimTtsRender");
  const firstImage = route.indexOf("const before = await openaiImage");
  const secondImage = route.indexOf("const after = await openaiImage");
  assert.ok(claim > -1 && firstImage > -1);
  assert.ok(claim < firstImage, "reserving after the spend is not reserving");
  assert.ok(firstImage < secondImage);
});

test("it is finalized once, only after the COMPLETE pair succeeds", () => {
  const secondImage = route.indexOf("const after = await openaiImage");
  const finalize = route.indexOf("await finalizeTtsRender");
  assert.ok(finalize > secondImage, "half a pair is not a cheaper product, it is nothing");
  assert.equal((route.match(/await finalizeTtsRender/g) ?? []).length, 1);
});

test("every failing exit gives the slot back", () => {
  // A provider refusal, a safety rejection, a thrown error, or a half-finished
  // pair. Never a quota slot spent on nothing.
  assert.match(route, /\} finally \{[\s\S]*?refundTtsRender/);
  // Swallowed, because the stale sweep is the backstop and an error here would
  // replace one lost slot with a lost response.
  assert.match(route, /refundTtsRender\([^)]*\)\.catch\(/);
});

test("a stranded claim cannot hold a slot for the rest of the month", () => {
  const claim = migration.slice(migration.indexOf("create or replace function public.claim_tts_render"));
  assert.match(claim, /status = 'reserved'\s*\n\s*and created_at < now\(\) - interval '15 minutes'/);
  // Meter-agnostic: the sweep must cover studio rows, not just the two it
  // originally knew about.
  const sweep = claim.slice(claim.indexOf("with stale as"), claim.indexOf("returning meter"));
  assert.doesNotMatch(sweep, /meter =/, "the sweep filters on status and age, never on meter");
});

test("the grant is re-checked in SQL, under the lock", () => {
  // The route reads league_creators too, but only to choose which refusal to
  // send. Authorisation happens here, after the advisory lock, so a grant
  // revoked between the two statements is still caught.
  const claim = migration.slice(migration.indexOf("create or replace function public.claim_tts_render"));
  assert.match(claim, /required_grant := case when p_meter = 'studio' then 'studio' else 'cta' end/);
  assert.match(claim, /coalesce\(\(pillar_grants ->> required_grant\)::boolean, false\)/);
  assert.match(claim, /status = 'approved'/);
});

test("both metered kinds share ONE monthly pool", () => {
  // Counting only this meter's own reservations would hand a creator a full
  // quota of each, which is not what a shared quota means.
  const claim = migration.slice(migration.indexOf("create or replace function public.claim_tts_render"));
  assert.match(claim, /meter in \('league', 'studio'\) and status = 'reserved'/);
});

test("a spent pair is logged as its own kind", () => {
  // So the two meters can be told apart later from history rather than guessed
  // at now, if the shared quota turns out to be the wrong economics.
  const finalize = migration.slice(migration.indexOf("create or replace function public.finalize_tts_render"));
  assert.match(finalize, /claimed_meter in \('league', 'studio'\)/);
    assert.match(finalize, /when claimed_meter = 'studio' then 'ai-pair' else 'tts' end/);
});

test("staff generate unmetered, everybody else gets Not found", () => {
  assert.match(route, /let meter: "studio" \| null = null;/);
  assert.match(route, /pillar_grants\?\.studio !== true/);
  assert.match(route, /return json\(\{ error: "Not found\." \}, 404\)/);
  // The refusal for somebody who HAS the grant and has spent the month is a
  // different thing and says so.
  assert.match(route, /Monthly render quota reached/);
});

test("the service role is the only caller", () => {
  assert.match(migration, /revoke all on function public\.claim_tts_render\(uuid, text\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.claim_tts_render\(uuid, text\) to service_role/);
});

// --- the four defects found on 81dd49e ---------------------------------------

test("there is no free-text route into either prompt", () => {
  // It shipped as "anything the chips do not cover", capped and appended to
  // both halves. Which meant "a narrow jaw and a recessed chin" could be typed
  // into the before and then asked to be CLEARED in the after: exactly the
  // structural pair the catalogue exists to prevent, reachable by typing.
  // A guarantee with a text box beside it is not a guarantee.
  assert.doesNotMatch(route, /blemishes\?: unknown/);
  assert.doesNotMatch(route, /body\?\.blemishes/);
  assert.match(route, /function showing\(flaws: readonly FaceFlaw\[\]\): string/);
  assert.match(route, /function cleared\(flaws: readonly FaceFlaw\[\]\): string/);
  const html = readFileSync(new URL("../quick.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /q-ai-blemish/);
  const client = readFileSync(new URL("../src/quick.ts", import.meta.url), "utf8");
  assert.doesNotMatch(client, /blemishes,/, "the client no longer sends one either");
});

test("both image calls are bounded", () => {
  // A hung call holds a serverless invocation AND a reserved quota slot. The
  // stale sweep returns the slot eventually, but not before the creator has
  // spent a month believing they are one render poorer.
  assert.match(route, /const IMAGE_TIMEOUT_MS = 90_000/);
  assert.equal((route.match(/signal: abort\.signal/g) ?? []).length, 2, "both calls, not one");
  assert.match(route, /clearTimeout\(timer\)/);
  // Returned rather than thrown, so the caller's ordinary failure path refunds.
  assert.match(route, /name === "AbortError"/);
  assert.match(route, /did not respond in time/);
});

test("the grant can actually be given through the admin panel", () => {
  // The instruction was "tick studio on Adrian's row", and the panel offered
  // only three checkboxes, none of them studio.
  const league = readFileSync(new URL("../src/league/main.ts", import.meta.url), "utf8");
  assert.match(league, /data-grant="studio"/);
  // And staff without a creator row hold every key, or the founder sees their
  // own new tool as NOT IN YOUR PLAN.
  assert.match(league, /pillar_grants: \{ cta: true, clips: true, polisher: true, studio: true \}/);
});
