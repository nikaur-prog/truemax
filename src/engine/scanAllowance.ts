// ---------------------------------------------------------------------------
// How many scans a week an account gets, and when the next one unlocks.
//
// The Max plan card has said "Two scans a week" since the plan existed, and
// the weekly gate held everybody — Max included — to one. A promise printed
// on the thing somebody paid for and not kept by the product is the worst
// kind of bug, because nobody reports it: the subscriber just learns the
// cards are decoration.
//
// The model is a ROLLING seven-day window, not a calendar week:
//
//   - an account may hold `allowance` completed scans inside the trailing
//     seven days; the next slot frees exactly a week after the scan that is
//     holding it, not at midnight on some chosen weekday;
//   - "rollover" ceases to be a question. An unused slot is simply a window
//     with room in it — there is nothing to bank and nothing to expire.
//
// This settles two of the open questions in docs/PRICING_DECISION.md, and it
// is the answer that needs no stored state beyond what already exists: the
// completion times of the scans themselves.
//
// Pure functions over timestamps, because the gate that uses this is a pile
// of storage reads and network fallbacks that cannot be unit-tested — and the
// arithmetic of "which scan is holding the slot" is exactly the part that
// must be.
// ---------------------------------------------------------------------------

export const SCAN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

import type { EntitlementTier } from "./entitlement.js";

// ONE personal scan a week, on every tier.
//
// Max used to get two, and the card sold it. It is one now, and the reason is
// the weekly ceremony rather than cost: the whole product rests on there being
// exactly one big analysis a week to look forward to, and a second personal
// scan in the same window undercuts it — the second reading is inside the
// noise the first one already carries, so it cannot show progress, only
// weather. What Max buys instead is other people's faces, which is where the
// tiers now differ (see guestAllowance).
//
// Taking back a stated benefit needs a grandfather clause as a rule. There is
// none here because there is nobody to grandfather: no subscription has ever
// been sold at the two-scan promise.
export function weeklyAllowance(_tier: EntitlementTier): number {
  return 1;
}

// How many OTHER people a tier may scan in the same trailing window.
//
// Guest scans were unlimited, and unlimited is not a tier: it gave a Starter
// subscriber and a Max subscriber the identical product on the axis Max is
// actually sold on. Free is zero because the subject chooser is member-gated,
// so a free account has no way to declare a guest in the first place — the
// number states that rather than leaving it implied by another module.
//
// Fifty is a cap rather than a target. It exists so "unlimited" is not printed
// on a card next to a number nobody has measured the cost of.
export function guestAllowance(tier: EntitlementTier, declined = false): number {
  if (tier === "max") return 50;
  if (tier === "starter") return 3;
  // A DECLINED free account keeps its weekly scan, and that scan is a guest
  // scan: stored, but with no profile attached and off the chart. Returning
  // zero here locked them out of scanning entirely, because the decline also
  // disables "It's me" — which is not the consequence the sheet named. The
  // sheet says they cannot scan THEMSELVES; it does not say they cannot scan.
  if (declined) return 1;
  return 0;
}

/**
 * Completion times inside the trailing window, newest first.
 *
 * Non-finite entries are dropped rather than trusted: one NaN from a
 * corrupted stored date would otherwise poison every comparison after it.
 */
export function scansInWindow(times: number[], now: number): number[] {
  return times
    .filter((t) => Number.isFinite(t) && t > now - SCAN_WINDOW_MS && t <= now)
    .sort((a, b) => b - a);
}

/**
 * When the next scan unlocks, or null when one is allowed right now.
 *
 * With the window holding fewer scans than the allowance, a slot is open.
 * Otherwise the slot frees when the scan HOLDING it leaves the window — the
 * allowance-th most recent one, not the newest. Keying off the newest scan
 * (which is what a single-slot gate naturally does) would mean a Max member's
 * second scan pushes their next unlock a full week out, turning two-a-week
 * into two-then-famine.
 */
export function nextScanSlotAt(times: number[], allowance: number, now: number): number | null {
  if (allowance <= 0) return null; // no allowance system for this caller
  const held = scansInWindow(times, now);
  if (held.length < allowance) return null;
  return held[allowance - 1] + SCAN_WINDOW_MS;
}

/**
 * The precise stamp and the history dates describe the same completions, so
 * a stamp within a couple of minutes of a stored scan is that scan, not an
 * extra one. Counting it twice would cost somebody a real slot.
 */
export function mergeScanTimes(stamp: number | null, historyTimes: number[], slopMs = 120_000): number[] {
  const times = historyTimes.filter((t) => Number.isFinite(t));
  if (stamp !== null && Number.isFinite(stamp) && !times.some((t) => Math.abs(t - stamp) <= slopMs)) {
    times.push(stamp);
  }
  return times;
}
