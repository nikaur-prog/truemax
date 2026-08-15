import { getSupabaseAdmin, json, safeMessage } from "./_shared.js";

// ---------------------------------------------------------------------------
// Can the server actually TALK to the database?
//
// /api/health answers a weaker question: is a variable named X present. That
// is not the same thing, and the difference cost a silent outage. Analytics
// was writing nothing in production while every health check read green: the
// name was set, the value was not usable, the Supabase client threw on
// construction, and /api/track — which swallows every error by design so a
// person is never shown an analytics failure — returned its usual 204.
//
// Every server function shares one getSupabaseAdmin(). So when it throws, it
// is not only analytics that stops: the Stripe webhook cannot write an
// entitlement (people pay and nothing unlocks), checkout cannot read one, and
// Max cannot verify who is asking. One probe answers for all of them.
//
// What it discloses: a boolean and an error CLASS, never a value. The error
// text is truncated and scrubbed of anything key-shaped, because the whole
// point is to be safe to hit from anywhere while a deploy is being fixed.
// ---------------------------------------------------------------------------

// Long keys are the only secret-shaped thing a Supabase error can carry.
// Redact them rather than trusting every error string to be harmless.
function scrub(message: string): string {
  return message
    .replace(/\b(eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._-]{8,}/g, "$1[redacted]")
    .slice(0, 200);
}

export async function GET(): Promise<Response> {
  let constructed = false;
  try {
    const admin = getSupabaseAdmin();
    constructed = true;
    // A read that touches PostgREST and needs no table to exist beyond the
    // analytics counters, and returns a count rather than any row content.
    const { error } = await admin.from("funnel_events").select("event", { count: "exact", head: true });
    if (error) {
      return json({ ok: false, constructed, reachable: false, error: scrub(error.message) }, 503);
    }
    return json({ ok: true, constructed: true, reachable: true });
  } catch (error) {
    // Thrown before any request went out: a missing or malformed URL/key.
    return json({ ok: false, constructed, reachable: false, error: scrub(safeMessage(error)) }, 503);
  }
}
