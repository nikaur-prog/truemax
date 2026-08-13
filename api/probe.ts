// Temporary. Delete once the API outage is fixed.
//
// ---------------------------------------------------------------------------
// Correcting the previous probe
//
// /api/health?deps=1 reported "Cannot find package 'stripe'" and I read that as
// the deployed function shipping without node_modules. That reading was not
// safe. It loaded each module as `await import(specifier)` where `specifier`
// was a FUNCTION PARAMETER, and Vercel decides what to put in a lambda by
// statically analysing the source. A computed specifier is invisible to that
// analysis, so `stripe` was correctly absent from that particular function: I
// had made it undiscoverable and then treated its absence as evidence.
//
// A dynamic import with a STRING LITERAL is a different thing entirely — the
// analyser resolves it and packs the dependency, exactly as it would a static
// import — while still failing as a catchable rejection rather than an
// uncatchable boot crash. That is the combination this file needs and the
// previous one lacked: traced like a real import, reportable like an error.
//
// Hence the thunks. Each specifier below is a literal inside its own arrow
// function, which keeps it analysable; passing the string in as an argument is
// what broke the last attempt.
//
// The pairs are the actual question: the same module named twice, once with the
// ".ts" extension the codebase uses and once without. Vercel compiles
// _shared.ts to _shared.js, so "./_shared.ts" names a file that does not exist
// at runtime, and if that is the whole outage then the extensionless spelling
// will load and the other will not. Reaching into src/ is asked separately
// because those files import each other with ".ts" too, and whether that is
// also fatal decides how wide the fix has to be.
// ---------------------------------------------------------------------------

async function attempt(load: () => Promise<unknown>): Promise<string> {
  try {
    const mod = (await load()) as Record<string, unknown>;
    return `ok (${Object.keys(mod).length} exports)`;
  } catch (error) {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
}

export async function GET(): Promise<Response> {
  const results: Record<string, string> = {
    stripe: await attempt(() => import("stripe")),
    supabase: await attempt(() => import("@supabase/supabase-js")),
    "./_shared": await attempt(() => import("./_shared")),
    "./_shared.ts": await attempt(() => import("./_shared.ts")),
    "../src/…/sideFeedbackPayload": await attempt(
      () => import("../src/engine/sideFeedbackPayload"),
    ),
    "../src/…/sideFeedbackPayload.ts": await attempt(
      () => import("../src/engine/sideFeedbackPayload.ts"),
    ),
  };
  return Response.json(
    { ok: true, node: process.version, results },
    { headers: { "Cache-Control": "no-store" } },
  );
}
