// ---------------------------------------------------------------------------
// Is the server side alive, and is it configured?
//
// Written because every other function in this directory was returning
// FUNCTION_INVOCATION_FAILED in production — checkout, the Stripe webhook, the
// side-landmark feedback route, account deletion, all of them — and there was
// no way to tell from outside whether that was a missing environment variable,
// a bad import, or the runtime rejecting the handler signature. Payments were
// dead and nothing in the product said so.
//
// It imports NOTHING on purpose. Not ./_shared.ts, not stripe, not
// @supabase/supabase-js. That is the diagnostic: if this route answers and the
// others still crash, the fault is in the shared module or one of those two
// packages, and if this route crashes too, the fault is the runtime itself.
// Adding an import here to save a few lines would destroy the only thing it is
// for.
//
// On what it discloses: names only, never values, never lengths, and only for a
// fixed allowlist. Whether STRIPE_WEBHOOK_SECRET is set is not a secret — the
// webhook already answers "Webhook is not configured" to anyone who asks — and
// an outage you cannot see is worth more to an attacker than a boolean.
// ---------------------------------------------------------------------------

const CHECKED = [
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_STARTER_PRICE_ID",
  "STRIPE_MAX_PRICE_ID",
  "TRUEMAX_APP_URL",
  "CRON_SECRET",
] as const;

export function GET(): Response {
  const env: Record<string, boolean> = {};
  for (const name of CHECKED) {
    // SUPABASE_SERVICE_ROLE_KEY is the legacy name _shared.ts still falls back
    // to, so a project configured under the old name must not read as missing.
    const legacy = name === "SUPABASE_SECRET_KEY" ? process.env.SUPABASE_SERVICE_ROLE_KEY : undefined;
    env[name] = Boolean(process.env[name] || legacy);
  }
  return Response.json(
    { ok: true, node: process.version, env },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
