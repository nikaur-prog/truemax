import { REGION_NAMES } from "./scoring.js";
import type { Report, RegionScore } from "./types.js";

// ---------------------------------------------------------------------------
// Two scans of one person, region by region.
//
// Reel Creator measures a face twice and the result screen showed one of them.
// The strip at the top said 4.7 → 6.1 and the eight-region grid underneath
// belonged entirely to the after, so the question a before/after actually
// raises — WHICH PART moved — had no answer anywhere on the page, even though
// the engine had measured it twice and was still holding both sets.
//
// Here rather than in the markup because two things about it can be quietly
// wrong and neither shows up as a broken page:
//
//   THE JOIN. The grid sorts regions by score, so zipping the two lists by
//   position compares whatever happened to rank fourth in each — a face whose
//   jaw overtook its cheekbones between scans would have its jaw differenced
//   against its midface and the table would look perfectly reasonable.
//
//   THE SIGN. A drop rendered as a rise is the one error that would make this
//   tool untrustworthy to the person using it, and a rescan going down is a
//   real outcome, not a hypothetical.
// ---------------------------------------------------------------------------

export interface RegionMove {
  region: RegionScore["region"];
  label: string;
  /** null when the before scan had no score for this region at all. */
  before: number | null;
  after: number;
  delta: number | null;
  direction: "up" | "down" | "flat";
}

/**
 * How much movement counts as movement.
 *
 * A tenth is inside the engine's own repeatability — two photographs of one
 * unchanged face taken a minute apart differ by about this much — so anything
 * under it is noise wearing a plus sign. Drawing it in green would be inventing
 * a result, and on a before/after that is the only result anybody reads.
 *
 * The delta is still SHOWN at that size; it is only not coloured. Hiding it
 * would overstate the ones that remain.
 */
export const MOVE_MIN = 0.15;

/** Both scans joined on the region, in the after's ranking order. */
export function regionMoves(before: Report, after: Report): RegionMove[] {
  const by = new Map(before.regions.map((g) => [g.region, g]));
  return [...after.regions]
    .sort((a, b) => b.score - a.score)
    .map((a) => {
      const b = by.get(a.region);
      const delta = b ? a.score - b.score : null;
      return {
        region: a.region,
        label: REGION_NAMES[a.region] ?? a.region,
        before: b ? b.score : null,
        after: a.score,
        delta,
        // The epsilon is not fussiness. 5.15 - 5 is 0.15000000000000036 in
        // binary floating point, so a delta of exactly the threshold lands on
        // whichever side the rounding error falls — and the cell gets coloured
        // or not depending on how the two scores happened to be computed.
        direction:
          delta === null || Math.abs(delta) <= MOVE_MIN + 1e-9 ? "flat" : delta > 0 ? "up" : "down",
      };
    });
}

/** "+1.2", "−0.4", "0.0", or "—" when there is nothing to compare against. */
export function moveLabel(move: RegionMove): string {
  if (move.delta === null) return "–";
  // A real minus sign, not a hyphen, to match the headline strip. And the sign
  // is derived from the delta rather than from the direction, so a movement too
  // small to colour still reads as the direction it went.
  const sign = move.delta > 0 ? "+" : move.delta < 0 ? "−" : "";
  return `${sign}${Math.abs(move.delta).toFixed(1)}`;
}
