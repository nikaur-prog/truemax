import type { Entitlement, EntitlementTier } from "./entitlement.js";

// ---------------------------------------------------------------------------
// Who can see how much.
//
// One line decides it: MEASUREMENT IS FREE, COACHING IS PAID.
//
// The whole pitch is that we show the actual maths, and a paywall over the
// maths would make that a lie on the first screen. So the score, the ranking,
// every region, every individual measurement and the delta between scans are
// free, forever, on every scan. They are also the thing that gets
// screenshotted, which is the loop that brings anyone here at all.
//
// What costs money is being told what to DO about it.
//
//   rating — the score and the ranking alone. No longer reachable from
//            depthFor: it is kept because the video and share surfaces render
//            at this level, and as the type's floor.
//   depth  — every measurement, every region, the potential, the delta. Free.
//   plan   — the routine, the products, the follow-up that adapts it. Paid,
//            from the first scan. Starter $7.99, Max $11.99.
//
// THE TRIAL IS COUNTED IN DAYS, AND IT IS NOT COUNTED HERE.
//
// It used to be a scan count living in this file: two scans at full depth,
// then a wall. That existed to meter DEPTH, and depth is free now, so there is
// nothing left for it to meter — an allowance that gates something given away
// is just a number that can only be wrong.
//
// The trial that remains is the subscription's own seven days, which Stripe
// owns and reports as `status: "trialing"`. `live()` below already treats it
// as a live subscription, which is the whole of the client's involvement.
// Seven days is deliberately long enough to span two scan slots: the first
// scan starts it, the second lands before it ends, and the second scan is the
// one that shows the number MOVE — the half of the product a screenshot cannot
// convey. Ending a trial before anyone has seen a delta sells the weaker half.
// ---------------------------------------------------------------------------

export type Depth = "rating" | "depth" | "plan";

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
