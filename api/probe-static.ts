// Temporary. Delete once the API outage is fixed.
//
// The companion to probe.ts, and the one that matters most, because it is
// spelled the way the five broken functions would be spelled after the fix: a
// plain static import of a local module under its compiled ".js" name.
//
// If this route answers, the outage is a one-line change per file — every
// relative specifier in api/ currently names ".ts", which is the source file
// and not the artifact — and nothing needs bundling, restructuring, or moving.
//
// If it does not answer, local modules are not reaching the lambda under any
// spelling, and the functions have to be bundled into self-contained files by
// our own build rather than assembled by the platform.
//
// It reaches through _shared into src/ as well (isAdult), so a single 200
// clears the whole import graph the real functions use, not just the first hop.
import { isAdult } from "../src/engine/age.js";
import { json } from "./_shared.js";

export function GET(): Response {
  return json({ ok: true, shared: typeof json, src: typeof isAdult });
}
