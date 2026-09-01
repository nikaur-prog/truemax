import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The Studio meter. These are source and SQL assertions because the route
// drives OpenAI and Postgres and cannot be imported here, but the thing being
// asserted is an ORDER and an atomicity property, which is exactly what would
// rot silently: a refactor that moves the reservation after the first image
// call still passes every other test in this repository.
const route = readFileSync(new URL("./ai-image.ts", import.meta.url), "utf8");
// The route now has two independent billable paths: the pair generation and a
// single-frame redo. Counting calls across the whole file conflates them, so
// each is sliced out and asserted on its own terms.
const SCENE = route.slice(route.indexOf('if (body?.mode === "scene")'), route.indexOf('if (body?.mode === "redo")'));
const REDO = route.slice(route.indexOf('if (body?.mode === "redo")'), route.indexOf("const spec: PairSpec"));
const PAIR = route.slice(route.indexOf("const spec: PairSpec"));

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
  const claim = route.indexOf("await claimTtsRender(user.id, meter)");
  const firstImage = route.indexOf("const afterPortrait = await openaiImage");
  const secondImage = route.indexOf("const beforePortrait = await openaiImage");
  assert.ok(claim > -1 && firstImage > -1 && secondImage > -1);
  assert.ok(claim < firstImage, "reserving after the spend is not reserving");
  assert.ok(firstImage < secondImage);
});

test("the AFTER is the root call and the before descends from it", () => {
  // The inversion, pinned. Making the before first capped the pair at whatever
  // face the first call happened to return, so an operator asking for an eight
  // got the model's default person with the puffiness removed. If this order
  // ever flips back, that ceiling comes back with it and nothing else in the
  // suite would notice.
  const afterCall = route.indexOf("const afterPortrait = await openaiImage");
  const beforeCall = route.indexOf("const beforePortrait = await openaiImage");
  assert.ok(afterCall < beforeCall, "the after defines the face; the before is an edit of it");
  // And the before is genuinely an EDIT of the after's pixels, not a second
  // generation from the same words, which would return a sibling.
  const beforeBlock = route.slice(beforeCall, beforeCall + 400);
  assert.match(beforeBlock, /edit: afterPortrait\.b64/);
});

test("a slot is claimed for every billable pair, not one for all four", () => {
  // The full-length shots are two MORE calls to the same provider at the same
  // price. One slot covering four images would have halved the protection this
  // meter exists to give, quietly, on the day the body shot shipped.
  assert.match(PAIR, /for \(let i = 0; i < \(fullBody \? 2 : 1\); i \+= 1\)/);
  // Four billable calls on the pair path, and only when the body pair was asked
  // for. The redo path is a separate invocation and is counted separately.
  assert.equal((PAIR.match(/await openaiImage\(apiKey/g) ?? []).length, 4);
  assert.equal((REDO.match(/await openaiImage\(apiKey/g) ?? []).length, 1, "a redo is one call");
  assert.equal((REDO.match(/await claimTtsRender/g) ?? []).length, 1, "and it costs one slot");
  // A scene is one call and one slot too. A whole set is ten requests rather
  // than one, which is what keeps it inside both the response ceiling and the
  // function duration ceiling.
  assert.equal((SCENE.match(/await openaiImage\(apiKey/g) ?? []).length, 1, "a scene is one call");
  assert.equal((SCENE.match(/await claimTtsRender/g) ?? []).length, 1, "and it costs one slot");
});

test("each path finalizes only after its own frames succeed", () => {
  for (const [name, block] of [["pair", PAIR], ["redo", REDO], ["scene", SCENE]] as Array<[string, string]>) {
    const lastImage = block.lastIndexOf("await openaiImage(apiKey");
    const finalize = block.indexOf("await finalizeTtsRender");
    assert.ok(lastImage > -1, `${name} must make a billable call`);
    assert.ok(finalize > lastImage, `${name}: half a set is not a cheaper product, it is nothing`);
    assert.equal((block.match(/await finalizeTtsRender/g) ?? []).length, 1, `${name} finalizes once`);
  }
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
  // The prompts moved to src/engine/aiPairPrompt.ts so they could be built and
  // read by a test rather than regexed here. What matters for THIS assertion is
  // unchanged: the only thing reaching either prompt's flaw half is a
  // catalogue lookup keyed by id.
  assert.match(route, /flawsFromIds\(Array\.isArray\(body\?\.flaws\) \? body\.flaws : \[\]\)/);
  const prompts = readFileSync(new URL("../src/engine/aiPairPrompt.ts", import.meta.url), "utf8");
  assert.match(prompts, /spec\.flaws\.map\(\(f\) => f\.add\)/);
  assert.doesNotMatch(prompts, /body\?\./, "the prompt builders never see the raw request");
  const html = readFileSync(new URL("../quick.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /q-ai-blemish/);
  const client = readFileSync(new URL("../src/quick.ts", import.meta.url), "utf8");
  assert.doesNotMatch(client, /blemishes,/, "the client no longer sends one either");
});

test("the response cannot be rejected for being too large", () => {
  // A Vercel function response is capped at 4.5MB. Four photorealistic
  // 1024x1536 PNGs, base64-encoded into JSON, do not fit, and the failure is
  // the worst available shape: generation succeeds, both slots are consumed,
  // and the platform replaces the whole response so the creator is billed two
  // renders for nothing.
  assert.match(route, /const OUTPUT_FORMAT = "jpeg"/);
  assert.doesNotMatch(route, /data:image\/png;base64/, "the declared mime must follow the format asked for");
  // Asked for on BOTH provider routes, not just the generate one: the edit
  // path sends multipart and the generate path sends JSON, so the format has
  // to be set twice or half the frames come back as PNG anyway.
  assert.equal((route.match(/output_format/g) ?? []).length, 2, "both the edit and generate routes");
});

test("four calls cannot run past the function ceiling", () => {
  // The old timeout was documented as sized "so that two of them" fit inside
  // 300s. The full-length pair took the route to four and nothing revisited
  // the number: 4 x 90s is 360s, and past the ceiling there is no response and
  // no guaranteed finally, so both slots sit unusable until the stale sweep.
  const perCall = /const IMAGE_TIMEOUT_MS = (\d+)_(\d+)/.exec(route);
  assert.ok(perCall, "the per-call timeout must be findable");
  const ms = Number(`${perCall![1]}${perCall![2]}`);
  const budget = /const TOTAL_BUDGET_MS = (\d+)_(\d+)/.exec(route);
  assert.ok(budget, "a total budget must exist, not just a per-call timeout");
  const total = Number(`${budget![1]}${budget![2]}`);
  // The PAIR path is the long one: four dependent calls in a single
  // invocation. A redo is one call and cannot approach the ceiling.
  const calls = (PAIR.match(/await openaiImage\(apiKey/g) ?? []).length;
  assert.ok(ms * calls <= 300_000, `${calls} calls at ${ms}ms each exceeds the 300s ceiling`);
  assert.ok(total < 300_000, "the budget must sit below the ceiling, not on it");
  // And it must actually be enforced rather than merely declared.
  assert.match(route, /options\.deadline \? options\.deadline - Date\.now\(\)/);
  assert.equal((route.match(/deadline,?\s*\}/g) ?? []).length >= 3, true, "every call carries the deadline");
});

test("a failed finalize does not hand the slot back", () => {
  // A finalize that throws before committing leaves the row 'reserved', so
  // refunding it would succeed and give the slot to somebody who is about to
  // receive the images. The 15-minute stale sweep releases it instead.
  const block = route.slice(route.indexOf("catch (finalizeError)"), route.indexOf("catch (finalizeError)") + 700);
  assert.doesNotMatch(block, /reservations\.push/, "a failed finalize must not queue the slot for refund");
  assert.match(block, /slot left reserved/);
});

test("a scene set can never be returned as one oversized response", () => {
  // Ten base64 frames in one JSON reply is several times the 4.5MB a function
  // may return, and the failure consumes every slot before the platform
  // discards the response. The route must therefore hand back ONE frame.
  assert.match(SCENE, /return json\(\{ frame:/);
  assert.doesNotMatch(SCENE, /frames:\s*\[/, "a scene path must not assemble an array of images");
  assert.doesNotMatch(SCENE, /for \(const scene of/, "the route must not loop the catalogue itself");
});

test("a scene cannot borrow the other sex's framing", () => {
  // sceneById is scoped by sex, and the route passes the request's own sex to
  // it. Crossing them would produce the wrong shot rather than a near-enough
  // one, because the framing and the light are the sex-specific part.
  assert.match(SCENE, /sceneById\(sex,/);
});

test("both image calls are bounded", () => {
  // A hung call holds a serverless invocation AND a reserved quota slot. The
  // stale sweep returns the slot eventually, but not before the creator has
  // spent a month believing they are one render poorer.
  // The number itself is asserted by the ceiling test above; here it only has
  // to exist and be enforced on every call.
  assert.match(route, /const IMAGE_TIMEOUT_MS = \d+_\d+/);
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
