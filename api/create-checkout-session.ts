import { attributionMetadata } from "./_attribution.js";
import { isAdult } from "../src/engine/age.js";
import type Stripe from "stripe";
import {
  authenticatedUser,
  getStripe,
  getSupabaseAdmin,
  json,
  requestOrigin,
  safeMessage,
  stripeSubscriptionForUser,
} from "./_shared.js";

type PaidTier = "starter" | "max";

// Stripe API 2026-03-25+ uses this to group and compare the TrueMax Checkout
// integration in Workbench. Keep the suffix stable so reporting is useful.
const CHECKOUT_INTEGRATION_ID = "truemax_kqjdvmsa";

interface ExistingEntitlement {
  stripe_subscription_id: string | null;
  status: string;
}

interface BillingProfile {
  date_of_birth: string;
}

interface TrialReservation {
  status: "reserved" | "redeemed";
  checkout_session_id: string | null;
  reserved_until: string;
}

function isPaidTier(value: unknown): value is PaidTier {
  return value === "starter" || value === "max";
}

// Billing period is NOT a tier.
//
// An annual Max subscriber is on tier "max", the same as a monthly one, and
// gets exactly the same product. Only the Stripe price differs. Modelling the
// year as its own tier would mean every entitlement check, every gate and the
// webhook all needing to learn a fourth name for a thing that is not new —
// and the first one anybody forgot would lock a paying customer out.
export type Billing = "monthly" | "annual";

function isBilling(value: unknown): value is Billing {
  return value === "monthly" || value === "annual";
}

function stripeObjectId(value: { id: string } | string | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

// Each price answers to two names: the one the code was written against and
// the one the values were actually stored under in Vercel. Renaming deployed
// environment variables to satisfy the code is exactly the kind of manual step
// that keeps a checkout dead for days; the code can just look in both places.
function configuredPrice(tier: PaidTier, billing: Billing): string | null {
  if (tier === "starter") {
    return process.env.STRIPE_STARTER_PRICE_ID || process.env.STRIPE_PRICE_STARTER_MONTHLY || null;
  }
  if (billing === "annual") {
    // No monthly fallback on purpose. If the annual price is not configured,
    // the honest failure is "the yearly plan is not connected yet" — silently
    // charging somebody monthly when they chose and expected to be charged for
    // a year is the one outcome worse than a broken button.
    return process.env.STRIPE_MAX_ANNUAL_PRICE_ID || process.env.STRIPE_PRICE_MAX_ANNUAL || null;
  }
  return process.env.STRIPE_MAX_PRICE_ID || process.env.STRIPE_PRICE_MAX_MONTHLY || null;
}

async function releaseReservation(userId: string, reservationId: string): Promise<void> {
  await getSupabaseAdmin()
    .from("trial_redemptions")
    .delete()
    .eq("user_id", userId)
    .eq("reservation_id", reservationId)
    .eq("status", "reserved");
}

async function releaseDownsellClaim(
  userId: string,
  claimId: string,
  checkoutSessionId: string | null = null,
): Promise<void> {
  await getSupabaseAdmin().rpc("release_downsell_checkout", {
    p_user_id: userId,
    p_claim_id: claimId,
    p_checkout_session_id: checkoutSessionId,
  });
}

export async function POST(request: Request): Promise<Response> {
  const origin = requestOrigin(request);
  if (!origin) return json({ error: "Cross-origin checkout is not allowed." }, 403);

  let userId: string | null = null;
  let reservationId: string | null = null;
  let downsellClaimId: string | null = null;
  let downsellCheckoutSessionId: string | null = null;
  try {
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in before starting checkout." }, 401);
    userId = user.id;

    const body = await request.json().catch(() => null) as
      { tier?: unknown; purchase?: unknown; billing?: unknown; attribution?: unknown } | null;

    // Where this purchase came from, allowlisted and capped before it goes
    // anywhere near Stripe. Spread into every Session's metadata below so the
    // record of the sale and the record of its source are the same object: a
    // separate attribution table would need its own join, its own retention
    // answer and its own way of going stale, and Stripe already holds the one
    // row that is definitely true about a payment.
    const attribution = attributionMetadata(body?.attribution);

    // One-time scan credit — a payment, not a subscription, so none of the
    // trial machinery below applies to it. Members pay the member price; the
    // test is a LIVE subscription rather than "has ever paid", because a
    // cancelled member is a non-member and pricing that flatters them is a
    // discount nobody agreed to fund.
    if (body?.purchase === "scan") {
      const { data: ent, error: entitlementError } = await getSupabaseAdmin()
        .from("entitlements")
        .select("stripe_subscription_id,status,tier")
        .eq("user_id", user.id)
        .maybeSingle<{
          stripe_subscription_id: string | null;
          status: string;
          tier: string;
        }>();
      if (entitlementError) throw new Error(`Scan pricing lookup failed: ${entitlementError.message}`);
      const stripeSubscription = await stripeSubscriptionForUser(user.id, ent?.stripe_subscription_id);
      const member = Boolean(stripeSubscription && ["active", "trialing"].includes(stripeSubscription.status));
      // A Customer id is reusable only after a Stripe subscription carrying
      // this exact Supabase user id proves ownership. Trusting a projected id
      // by itself could open or charge the wrong customer if that row were
      // ever corrupted; a duplicate Customer is cheaper than cross-user billing.
      const customerId = stripeObjectId(stripeSubscription?.customer);
      const scanPrice = member
        ? process.env.STRIPE_MEMBER_SCAN_PRICE_ID || process.env.STRIPE_PRICE_EXTRA_SCAN_MEMBER || null
        : process.env.STRIPE_SCAN_PRICE_ID || process.env.STRIPE_PRICE_EXTRA_SCAN_STANDARD || null;
      if (!scanPrice) return json({ error: "Single scans are still being connected." }, 503);
      const session = await getStripe().checkout.sessions.create(
        {
          mode: "payment",
          integration_identifier: CHECKOUT_INTEGRATION_ID,
          expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
          line_items: [{ price: scanPrice, quantity: 1 }],
          success_url: `${origin}/?purchase=scan-success&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}/?purchase=scan-cancelled`,
          client_reference_id: user.id,
          ...(customerId ? { customer: customerId } : { customer_email: user.email }),
          metadata: { supabase_user_id: user.id, purpose: "scan_credit", ...attribution },
          custom_text: {
            submit: { message: "One in-depth scan, added to your account the moment payment completes. No subscription." },
          },
        },
        request.headers.get("x-idempotency-key")
          ? { idempotencyKey: request.headers.get("x-idempotency-key") as string }
          : undefined,
      );
      if (!session.url) throw new Error("Stripe did not return a Checkout URL");
      return json({ url: session.url });
    }

    // The decline downsell.
    //
    // Somebody who has just turned the trial down is not a member and is not
    // going to become one today, and the standard $5.99 single scan is the
    // wrong number to put in front of them: the alternative on the table is
    // nothing at all, not a subscription. So they are offered the same scan
    // credit at the member price, once.
    //
    // THE ELIGIBILITY IS CHECKED HERE, not carried up from the client, and
    // that is the whole reason this is a separate branch rather than a flag on
    // the scan branch. A "give me the cheap price" field in a request body is
    // a cheap price for everybody who opens the console, and the standard
    // price then means nothing. The two conditions the server can actually
    // verify are that the account declined and that it is not already a
    // member, and those are exactly the two that make the offer honest.
    //
    // The purpose marker is the ordinary scan_credit one: this is the same
    // product, bought at a different moment. The claim marker binds the
    // discounted Session to the one server-side reservation it may redeem.
    if (body?.purchase === "downsell") {
      const admin = getSupabaseAdmin();
      const downsellPrice =
        process.env.STRIPE_DOWNSELL_PRICE_ID
        || process.env.STRIPE_PRICE_SCAN_DOWNSELL
        || process.env.STRIPE_MEMBER_SCAN_PRICE_ID
        || process.env.STRIPE_PRICE_EXTRA_SCAN_MEMBER
        || null;
      if (!downsellPrice) return json({ error: "Single scans are still being connected." }, 503);

      const { data: ent, error: entitlementError } = await admin
        .from("entitlements")
        .select("stripe_subscription_id")
        .eq("user_id", user.id)
        .maybeSingle<{ stripe_subscription_id: string | null }>();
      if (entitlementError) {
        return json({ error: "That offer is not available on this account." }, 403);
      }

      // The Stripe object is authoritative for a billing decision. The local
      // row can lag a webhook; quoting a decline discount to an active,
      // delinquent or incomplete subscriber would create a second purchase
      // while that account already has an open subscription relationship.
      let stripeSubscription: Stripe.Subscription | null;
      try {
        stripeSubscription = await stripeSubscriptionForUser(user.id, ent?.stripe_subscription_id);
      } catch {
        return json({ error: "That offer is not available on this account." }, 403);
      }
      if (stripeSubscription && !["canceled", "incomplete_expired"].includes(stripeSubscription.status)) {
        return json({ error: "That offer is not available on this account." }, 403);
      }

      downsellClaimId = crypto.randomUUID();
      const { data: claimed, error: claimError } = await admin.rpc("reserve_downsell_checkout", {
        p_user_id: user.id,
        p_claim_id: downsellClaimId,
      });
      if (claimError || claimed !== true) {
        downsellClaimId = null;
        return json({ error: "That offer is not available on this account." }, 403);
      }

      const customerId = stripeObjectId(stripeSubscription?.customer);
      const session = await getStripe().checkout.sessions.create(
        {
          mode: "payment",
          integration_identifier: CHECKOUT_INTEGRATION_ID,
          expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
          line_items: [{ price: downsellPrice, quantity: 1 }],
          success_url: `${origin}/?purchase=scan-success&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}/?purchase=scan-cancelled`,
          client_reference_id: user.id,
          ...(customerId ? { customer: customerId } : { customer_email: user.email }),
          metadata: {
            supabase_user_id: user.id,
            purpose: "scan_credit",
            offer: "decline_downsell",
            downsell_claim_id: downsellClaimId,
            ...attribution,
          },
          custom_text: {
            submit: { message: "Your full analysis, unlocked the moment payment completes. One payment, no subscription." },
          },
        },
        request.headers.get("x-idempotency-key")
          ? { idempotencyKey: request.headers.get("x-idempotency-key") as string }
          : undefined,
      );
      if (!session.url) throw new Error("Stripe did not return a Checkout URL");
      downsellCheckoutSessionId = session.id;
      const { data: linked, error: linkError } = await admin.rpc("link_downsell_checkout", {
        p_user_id: user.id,
        p_claim_id: downsellClaimId,
        p_checkout_session_id: session.id,
      });
      if (linkError || linked !== true) {
        await getStripe().checkout.sessions.expire(session.id).catch(() => undefined);
        throw new Error(linkError?.message || "Downsell Checkout could not be linked");
      }
      return json({ url: session.url });
    }

    // One voiced analysis export — a payment like the scan credit, one flat
    // price for everyone. There is no member price on purpose: the cost being
    // covered is the synthesis call, and that costs the same whoever asks.
    if (body?.purchase === "voice") {
      const { data: ent, error: entitlementError } = await getSupabaseAdmin()
        .from("entitlements")
        .select("stripe_subscription_id")
        .eq("user_id", user.id)
        .maybeSingle<{ stripe_subscription_id: string | null }>();
      if (entitlementError) throw new Error(`Voice checkout lookup failed: ${entitlementError.message}`);
      const stripeSubscription = await stripeSubscriptionForUser(user.id, ent?.stripe_subscription_id);
      const customerId = stripeObjectId(stripeSubscription?.customer);
      const voicePrice =
        process.env.STRIPE_VOICED_PRICE_ID || process.env.STRIPE_PRICE_VOICED_ANALYSIS || null;
      if (!voicePrice) return json({ error: "Voiced analysis checkout is still being connected." }, 503);
      const session = await getStripe().checkout.sessions.create(
        {
          mode: "payment",
          integration_identifier: CHECKOUT_INTEGRATION_ID,
          expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
          line_items: [{ price: voicePrice, quantity: 1 }],
          success_url: `${origin}/?purchase=voice-success&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}/?purchase=voice-cancelled`,
          client_reference_id: user.id,
          ...(customerId ? { customer: customerId } : { customer_email: user.email }),
          metadata: { supabase_user_id: user.id, purpose: "voice_credit", ...attribution },
          custom_text: {
            submit: { message: "One voiced analysis video, unlocked the moment payment completes. No subscription." },
          },
        },
        request.headers.get("x-idempotency-key")
          ? { idempotencyKey: request.headers.get("x-idempotency-key") as string }
          : undefined,
      );
      if (!session.url) throw new Error("Stripe did not return a Checkout URL");
      return json({ url: session.url });
    }

    if (!isPaidTier(body?.tier)) return json({ error: "Choose Starter or Max to continue." }, 400);
    const tier = body.tier;
    // Unrecognised or absent billing falls back to monthly, which is the
    // cheaper commitment. An unreadable field must never be the reason
    // somebody is billed for a year.
    const billing: Billing = isBilling(body?.billing) ? body.billing : "monthly";
    const priceId = configuredPrice(tier, billing);
    if (!priceId) {
      return json(
        {
          error: billing === "annual"
            ? "The yearly plan is still being connected. Monthly is available now."
            : `${tier === "starter" ? "Starter" : "Max"} checkout is still being connected.`,
        },
        503,
      );
    }

    const admin = getSupabaseAdmin();
    const [
      { data: entitlement, error: entitlementError },
      { data: profile, error: profileError },
      { data: existingTrial, error: trialError },
    ] = await Promise.all([
      admin
        .from("entitlements")
        .select("stripe_subscription_id,status")
        .eq("user_id", user.id)
        .maybeSingle<ExistingEntitlement>(),
      admin
        .from("profiles")
        .select("date_of_birth")
        .eq("user_id", user.id)
        .maybeSingle<BillingProfile>(),
      admin
        .from("trial_redemptions")
        .select("status,checkout_session_id,reserved_until")
        .eq("user_id", user.id)
        .maybeSingle<TrialReservation>(),
    ]);
    if (entitlementError) throw new Error(`Entitlement storage is unavailable: ${entitlementError.message}`);
    if (profileError) throw new Error(`Profile storage is unavailable: ${profileError.message}`);
    if (trialError) throw new Error(`Trial eligibility is unavailable: ${trialError.message}`);
    if (!profile) return json({ error: "Finish your pathway questions before starting a trial." }, 409);
    if (tier === "max" && !isAdult(profile.date_of_birth)) {
      return json({ error: "Max is available from age 18. Starter is available now." }, 403);
    }
    const stripeSubscription = await stripeSubscriptionForUser(
      user.id,
      entitlement?.stripe_subscription_id,
    );
    if (
      (stripeSubscription && !["canceled", "incomplete_expired"].includes(stripeSubscription.status))
      || (!stripeSubscription
        && entitlement?.stripe_subscription_id
        && !["canceled", "incomplete_expired", "none"].includes(entitlement.status))
    ) {
      return json({ error: "This account already has a subscription. Open billing to manage it." }, 409);
    }

    // A Checkout Session lasts 31 minutes and the local lock lasts 32. Only remove a stale reservation
    // after Stripe itself confirms that the linked Session expired; a Session
    // completed near the deadline can have a slightly delayed webhook and must
    // never be replaced by a second trial in that gap.
    if (existingTrial?.status === "redeemed") {
      return json({ error: "This account has already used its free trial." }, 409);
    }
    if (existingTrial?.status === "reserved") {
      const expiredLocally = new Date(existingTrial.reserved_until).getTime() <= Date.now();
      let canRelease = expiredLocally && !existingTrial.checkout_session_id;
      if (expiredLocally && existingTrial.checkout_session_id) {
        const previous = await getStripe().checkout.sessions.retrieve(existingTrial.checkout_session_id);
        canRelease = previous.status === "expired";
      }
      if (!canRelease) {
        return json({ error: "A trial Checkout is already open for this account." }, 409);
      }
      await admin.from("trial_redemptions").delete().eq("user_id", user.id).eq("status", "reserved");
    }

    reservationId = crypto.randomUUID();
    const { data: reserved, error: reserveError } = await admin.rpc("reserve_trial_checkout", {
      p_user_id: user.id,
      p_tier: tier,
      p_reservation_id: reservationId,
    });
    if (reserveError) throw new Error(`Trial eligibility is unavailable: ${reserveError.message}`);
    if (reserved !== true) {
      return json({ error: "This account has already used its free trial, or a trial Checkout is already open." }, 409);
    }

    const customerId = stripeObjectId(stripeSubscription?.customer);
    const planName = tier === "starter" ? "Starter" : "Max";
    const session = await getStripe().checkout.sessions.create(
      {
        mode: "subscription",
        integration_identifier: CHECKOUT_INTEGRATION_ID,
        expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
        line_items: [{ price: priceId, quantity: 1 }],
        // Stripe replaces this literal placeholder after Checkout. The client
        // passes the resulting Session id to the authenticated reconciliation
        // endpoint so a successful payment cannot stay locked behind a late
        // or misconfigured webhook.
        success_url: `${origin}/?checkout=success&plan=${tier}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/?checkout=cancelled&plan=${tier}`,
        client_reference_id: user.id,
        ...(customerId ? { customer: customerId } : { customer_email: user.email }),
        allow_promotion_codes: true,
        metadata: {
          supabase_user_id: user.id,
          tier,
          billing,
          trial_reservation_id: reservationId,
          ...attribution,
        },
        subscription_data: {
          trial_period_days: 7,
          // On the SUBSCRIPTION too, not only the Session. A Session is a
          // moment; a subscription is the thing that renews, and every renewal
          // invoice after the first carries no Session at all. Without this
          // copy, the ad that brought somebody in could be credited with their
          // first payment and nothing they ever paid afterwards, which is the
          // difference between a channel looking unprofitable and looking like
          // the best one you have.
          metadata: {
            supabase_user_id: user.id,
            tier,
            billing,
            trial_reservation_id: reservationId,
            ...attribution,
          },
        },
        custom_text: {
          submit: {
            // The renewal period has to be the real one. This line said
            // "renews monthly" unconditionally, which on a yearly plan is a
            // false statement about what somebody is agreeing to, printed on
            // the button they agree with.
            message: `${planName} is free for 7 days, then renews ${
              billing === "annual" ? "yearly" : "monthly"
            } until cancelled. Cancel before the trial ends to pay $0.`,
          },
        },
      },
      request.headers.get("x-idempotency-key")
        ? { idempotencyKey: request.headers.get("x-idempotency-key") as string }
        : undefined,
    );

    if (!session.url) throw new Error("Stripe did not return a Checkout URL");
    const { error: linkError } = await admin
      .from("trial_redemptions")
      .update({ checkout_session_id: session.id, updated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("reservation_id", reservationId)
      .eq("status", "reserved");
    if (linkError) {
      await getStripe().checkout.sessions.expire(session.id).catch(() => undefined);
      throw new Error(`Trial Checkout could not be linked: ${linkError.message}`);
    }
    return json({ url: session.url });
  } catch (error) {
    if (userId && reservationId) await releaseReservation(userId, reservationId).catch(() => undefined);
    if (userId && downsellClaimId) {
      if (!downsellCheckoutSessionId) {
        await releaseDownsellClaim(userId, downsellClaimId).catch(() => undefined);
      } else {
        // Never release a claim while its Session may still accept payment.
        // Expire first and release only after Stripe confirms it is closed.
        const closed = await getStripe().checkout.sessions.expire(downsellCheckoutSessionId)
          .then((session) => session.status === "expired")
          .catch(() => false);
        if (closed) {
          await releaseDownsellClaim(userId, downsellClaimId, downsellCheckoutSessionId).catch(() => undefined);
        }
      }
    }
    console.error("create-checkout-session", safeMessage(error));
    return json({ error: "Checkout is not available yet. Try again shortly." }, 503);
  }
}
