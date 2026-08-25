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

// By LIVE tier (tierOf already folds subscription status in): the Starter
// card sells "One scan a week", the Max card "Two scans a week", and free
// matches Starter because the free scan is the funnel, not a plan.
export function weeklyAllowance(tier: EntitlementTier): number {
  return tier === "max" ? 2 : 1;
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
