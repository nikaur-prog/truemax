import { getSupabaseAdmin, json, safeMessage } from "./_shared.js";

// ---------------------------------------------------------------------------
// Can the server actually TALK to the database, and to WHICH one?
//
// /api/health answers a weaker question: is a variable named X present. That
// is not the same thing, and the difference cost a silent outage. Analytics
// was writing nothing in production while every health check read green: the
// name was set, the value did not work, and /api/track — which swallows every
// error by design so a person is never shown an analytics failure — returned
// its usual 204.
//
// Every server function shares one getSupabaseAdmin(). So when it fails, it is
// not only analytics that stops: the Stripe webhook cannot write an
// entitlement (people pay and nothing unlocks), checkout cannot read one, and
// Max cannot verify who is asking. One probe answers for all of them.
//
// It reports three separable facts, because each points at a different fix:
//
//   ref       which Supabase project the server is pointed at. This account
//             has two, and pointing production at the wrong one looks exactly
//             like "the table does not exist". The ref is already public — it
//             ships in the browser bundle — so naming it discloses nothing.
//   auth      whether the key is accepted at all, from a request that needs
//             no table to exist. Separates "bad key" from "missing table".
//   table     whether the analytics table is really there.
//
// What it never discloses: a key. Errors are scrubbed of anything key-shaped
// and truncated, so this is safe to hit from anywhere while a deploy is being
// fixed.
// ---------------------------------------------------------------------------

function scrub(message: string): string {
  return message
    .replace(/\b(eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._-]{8,}/g, "$1[redacted]")
    .slice(0, 300);
}

// The project ref is the first label of the Supabase hostname.
function projectRef(url: string): string {
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    // A URL this malformed is itself the answer, so say so rather than throwing.
    return `unparseable(${url.slice(0, 40)})`;
  }
}

export async function GET(): Promise<Response> {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const ref = projectRef(url);
  // Shape only, never content: a key of the wrong length or prefix is a
  // common paste error and is worth seeing without revealing the value.
  const keyShape = key ? `${key.slice(0, 3)}…${key.length} chars` : "missing";

  let auth: string | number = "not attempted";
  try {
    // A bare PostgREST root request. It needs no table, so a 200 here proves
    // the URL resolves AND the key is accepted, separating those two failures
    // from "the table is missing".
    const response = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    auth = response.status;
  } catch (error) {
    auth = `fetch failed: ${scrub(safeMessage(error))}`;
  }

  try {
    const { error } = await getSupabaseAdmin()
      .from("funnel_events")
      .select("event", { count: "exact", head: true });
    if (error) {
      return json(
        {
          ok: false,
          ref,
          keyShape,
          auth,
          table: "error",
          // PostgREST puts the useful part in code/details/hint as often as in
          // message, and the first version reported only message — which came
          // back empty and said nothing at all.
          code: error.code ?? null,
          details: error.details ? scrub(error.details) : null,
          hint: error.hint ? scrub(error.hint) : null,
          message: error.message ? scrub(error.message) : "(empty)",
        },
        503,
      );
    }
    return json({ ok: true, ref, keyShape, auth, table: "ok" });
  } catch (error) {
    return json({ ok: false, ref, keyShape, auth, table: "threw", message: scrub(safeMessage(error)) }, 503);
  }
}
