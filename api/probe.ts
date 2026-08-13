// Temporary. Delete once the API outage is fixed.
//
// ---------------------------------------------------------------------------
// Round three, and the first one asking the right question.
//
// Round two settled that npm packages reach the lambda intact — `stripe` and
// `@supabase/supabase-js` both loaded. So the dependency trace is not broken
// and nothing needs bundling. What failed was every LOCAL module:
//
//   ./_shared     → Cannot find module '/var/task/api/_shared'
//   ./_shared.ts  → Cannot find module '/var/task/api/_shared.ts'
//
// Both of those are expected to fail whether or not anything is wrong, which is
// why round two could not finish the job. Vercel compiles _shared.ts to
// _shared.js, and Node's ES module resolver — unlike CommonJS, unlike a bundler
// — does no extension guessing at all. "./_shared" is not a request for
// _shared.js; it is a request for a file with no extension. "./_shared.ts" is a
// request for a source file that no longer exists after compilation.
//
// The spelling that can work is the one neither the probes nor the codebase has
// ever tried: "./_shared.js" — the name of the OUTPUT. That is the ordinary
// TypeScript-on-ESM convention, and this repo's api/ directory does not follow
// it anywhere.
//
// So this round asks two things.
//
// probe.ts: does the compiled sibling exist under its .js name.
// probe-static.ts: does it exist at all when nothing statically imports it.
//
// Those can differ. Vercel decides what to compile by following static imports,
// and dynamic ones — even with a literal, even though they are traced for
// npm packages — may not pull a local .ts file into the build. If the static
// route boots and the dynamic lookup here does not, the answer is still "use
// the .js specifier", because every real function in this directory imports
// statically anyway.
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
    "./_shared.js": await attempt(() => import("./_shared.js")),
    "../src/…/sideFeedbackPayload.js": await attempt(
      () => import("../src/engine/sideFeedbackPayload.js"),
    ),
  };
  return Response.json(
    { ok: true, node: process.version, results },
    { headers: { "Cache-Control": "no-store" } },
  );
}
