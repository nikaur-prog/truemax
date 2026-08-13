// Temporary. Delete once the API outage is fixed.
//
// The companion to probe-shared.ts. That one tests a relative import inside
// api/; this one tests reaching across into src/, whose own files still import
// each other with .ts extensions. If probe-shared boots and this does not, the
// extensions have to come off src/ as well and not just api/ — which is a much
// larger change, and worth knowing before making it rather than after.
import { movedSidePointIds } from "../src/engine/sideFeedbackPayload";

export function GET(): Response {
  return Response.json(
    { ok: true, imported: typeof movedSidePointIds },
    { headers: { "Cache-Control": "no-store" } },
  );
}
