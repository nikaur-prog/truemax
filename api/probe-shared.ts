// Temporary. Delete once the API outage is fixed.
//
// /api/health?deps=1 proved two things at once and they need separating:
// the deployed bundle has no node_modules AND the relative specifier
// "./_shared.ts" points at a file that does not exist after Vercel compiles it
// to _shared.js. Either alone would kill every function, so a fix aimed at the
// wrong one changes nothing.
//
// This imports ./_shared WITHOUT the extension, statically. If it boots, the
// dependency trace works fine once the specifier resolves — meaning the
// ".ts" extensions were what broke it, and dropping them is the whole fix.
// If it crashes, the trace is broken independently and the functions have to be
// bundled by our own build instead of relying on Vercel's.
import { json } from "./_shared";

export function GET(): Response {
  return json({ ok: true, imported: typeof json });
}
