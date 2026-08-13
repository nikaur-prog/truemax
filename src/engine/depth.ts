import type { Entitlement, EntitlementTier } from "./entitlement.js";

// ---------------------------------------------------------------------------
// Who can see how much.
//
// The free scan gives a real score and a real ranking, because a score you
// cannot check is not a demonstration of anything — the whole pitch is "we show
// the actual math", and a paywall over the number would make that a lie on the
// first screen. What costs money is the depth underneath it: the region
// breakdown, the individual measurements, the potential, and the plan.
//
// Three levels, and the boundary between them is the honest one:
//
//   rating — the score, the ranking, where it sits in the population. Free,
//            forever, and never blurred. This is the demonstration.
//   depth  — every measurement, every region, and the potential. $7.99.
//   plan   — the personalised routine and the follow-up that adapts it. $11.99.
//
// The trial is counted in SCANS rather than days, because that is the unit the
// value arrives in. Somebody who signs up and scans twice has seen exactly what
// they are being asked to pay for; somebody who signs up and forgets for six
// days has not, and burning their trial on a calendar is a refund request.
// ---------------------------------------------------------------------------

export type Depth = "rating" | "depth" | "plan";

// Two scans, not one. One scan shows a number; the second shows it MOVE, or
// fail to, which is the thing this product does that a screenshot cannot. Ending
// the trial before anyone has seen a delta sells the weaker half of the product.
export const TRIAL_SCANS = 2;

export interface AccessInput {
  entitlement: Entitlement | null;
  // How many scans this account has run in total. Local history is the source:
  // the count is not a billing fact and does not need to survive a device wipe.
  scanCount: number;
}

function live(entitlement: Entitlement | null): boolean {
  return Boolean(
    entitlement && (entitlement.status === "active" || entitlement.status === "trialing"),
  );
}

export function tierOf(entitlement: Entitlement | null): EntitlementTier {
  return entitlement && live(entitlement) ? entitlement.tier : "free";
}

// The depth this account can currently see.
//
// Note the ORDER: a paid tier is checked before the trial allowance, so an
// account that subscribed during its trial is served by its subscription and
// cannot be downgraded by having scanned three times.
export function depthFor({ entitlement, scanCount }: AccessInput): Depth {
  const tier = tierOf(entitlement);
  if (tier === "max") return "plan";
  if (tier === "starter") return "depth";
  // The free allowance. Scans are zero-indexed from the account's history, so
  // "has run fewer than two" is the first and second scan.
  if (scanCount < TRIAL_SCANS) return "depth";
  return "rating";
}

export function canSeeDepth(input: AccessInput): boolean {
  return depthFor(input) !== "rating";
}

export function canSeePlan(input: AccessInput): boolean {
  return depthFor(input) === "plan";
}

// How many free in-depth scans are left, for the copy that says so. Zero once
// the allowance is spent, and zero for a paying account — where the sentence
// does not apply and should not appear.
export function freeScansLeft({ entitlement, scanCount }: AccessInput): number {
  if (tierOf(entitlement) !== "free") return 0;
  return Math.max(0, TRIAL_SCANS - scanCount);
}
