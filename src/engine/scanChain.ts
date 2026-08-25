import type { StoredScan } from "./history.js";

// ---------------------------------------------------------------------------
// Which scan a movement is measured against.
//
// The history list is a RECORD: it shows every scan taken on this device,
// newest first, with guests labelled by name. Movement is PROGRESS, and
// progress only exists within one face — so the two cannot be paired by
// adjacency in that list. Doing so produced exactly the screenshot that
// started this: an owner's row showing "−2.9" against a friend who had been
// scanned in between, on a panel whose own note says guests are left out.
//
// Lives in the engine rather than in the view because both the list and the
// recalled-scan dialog have to answer the question identically, and because a
// rule this easy to get wrong is worth a test that needs no DOM.
// ---------------------------------------------------------------------------

/**
 * The scan `scans[i]`'s movement chip should be measured against, given a
 * newest-first list that may interleave the owner's scans with guests'.
 *
 * Undefined when there is nothing legitimate to compare against: the row is a
 * guest's (two faces are not a movement), or it is the owner's first scan.
 */
export function previousForMovement(
  scans: StoredScan[],
  i: number,
): StoredScan | undefined {
  if (scans[i]?.subject) return undefined;
  return scans.slice(i + 1).find((p) => !p.subject);
}
