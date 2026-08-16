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
  // The yearly plan. Listed so "is the yearly price connected yet" is a
  // question the health endpoint answers, rather than one you find out from a
  // customer hitting a dead button. Its absence is not fatal — checkout falls
  // back to a clear "not connected" message — so this reports false without
  // failing the check.
  "STRIPE_MAX_ANNUAL_PRICE_ID",
  "TRUEMAX_APP_URL",
  "CRON_SECRET",
  "ANTHROPIC_API_KEY",
] as const;

export function GET(): Response {
  // Alternate names the server code also accepts. The report answers "will
  // the feature work", not "is this exact string in the dashboard" — a value
  // stored under its accepted fallback name must not read as missing.
  const FALLBACK: Record<string, string> = {
    SUPABASE_SECRET_KEY: "SUPABASE_SERVICE_ROLE_KEY",
    STRIPE_WEBHOOK_SECRET: "SIGNING_SECRET",
    STRIPE_STARTER_PRICE_ID: "STRIPE_PRICE_STARTER_MONTHLY",
    STRIPE_MAX_PRICE_ID: "STRIPE_PRICE_MAX_MONTHLY",
    STRIPE_MAX_ANNUAL_PRICE_ID: "STRIPE_PRICE_MAX_ANNUAL",
  };
  const env: Record<string, boolean> = {};
  for (const name of CHECKED) {
    const fallback = FALLBACK[name] ? process.env[FALLBACK[name]] : undefined;
    env[name] = Boolean(process.env[name] || fallback);
  }
  // The ?deps=1 probe that used to live here has moved to /api/probe, because
  // it loaded modules through a variable specifier and a variable specifier is
  // invisible to the analyser that decides what ships in the lambda. It was
  // reporting absences it had caused itself. This route goes back to being the
  // one thing it can answer honestly with no imports at all.
  return Response.json(
    { ok: true, node: process.version, env },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
