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
  // Purchased one-time credits, from the server. A credit is one full-depth
  // scan without a subscription; while any remain, the gate stays open.
  credits?: number;
  // A staff account, read from the database (public.app_admins) — never from a
  // list of emails in the bundle, which on a public repo would publish a
  // personal address. Grants unlimited depth to that account and nothing else:
  // there is no cross-account visibility anywhere in this product to grant.
  admin?: boolean;
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
export function depthFor({ entitlement, scanCount, credits = 0, admin = false }: AccessInput): Depth {
  // Staff first: the owner and testers have to be able to scan repeatedly to
  // check the product, and an allowance that runs out mid-test is a reason to
  // stop testing. Defaults to false, so a failed read locks rather than opens.
  if (admin) return "plan";
  const tier = tierOf(entitlement);
  if (tier === "max") return "plan";
  if (tier === "starter") return "depth";
  // A free account keeps the measurements. Forever, on every scan.
  //
  // This used to expire: two scans at "depth", then "rating" — the score alone,
  // with the region tabs behind a blur. The line has moved, and the new one is
  // easier to say and harder to resent: MEASUREMENT IS FREE, COACHING IS PAID.
  //
  // The argument for it is the product's own pitch. "We show the actual maths"
  // cannot be true on a screen that hides the maths, and the geometry is also
  // the thing that gets screenshotted and shared, which is the loop that
  // brings people in at all. What somebody actually pays for is being told
  // what to DO about it, which is the plan, and that is now walled from the
  // first scan rather than the third.
  //
  // `scanCount` no longer decides depth. It is still an input because the
  // allowance in scanAllowance.ts uses it, and because a caller passing it
  // here is asking a question this function should keep answering the same way
  // however the trial is later counted.
  void scanCount;
  // A purchased credit predates the change and still buys what it was sold as:
  // one scan at full depth without a subscription. Now that depth is free the
  // grant is a no-op for anyone holding one, which is the right direction for
  // a credit to fail in.
  void credits;
  return "depth";
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
