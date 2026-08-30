import { isAdult } from "../src/engine/age.js";
import { authenticatedUser, getStripe, getSupabaseAdmin, json, requestOrigin, safeMessage } from "./_shared.js";

type PaidTier = "starter" | "max";

interface ExistingEntitlement {
  stripe_customer_id: string | null;
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

export async function POST(request: Request): Promise<Response> {
  const origin = requestOrigin(request);
  if (!origin) return json({ error: "Cross-origin checkout is not allowed." }, 403);

  let userId: string | null = null;
  let reservationId: string | null = null;
  try {
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in before starting checkout." }, 401);
    userId = user.id;

    const body = await request.json().catch(() => null) as
      { tier?: unknown; purchase?: unknown; billing?: unknown } | null;

    // One-time scan credit — a payment, not a subscription, so none of the
    // trial machinery below applies to it. Members pay the member price; the
    // test is a LIVE subscription rather than "has ever paid", because a
    // cancelled member is a non-member and pricing that flatters them is a
    // discount nobody agreed to fund.
    if (body?.purchase === "scan") {
      const { data: ent, error: entitlementError } = await getSupabaseAdmin()
        .from("entitlements")
        .select("stripe_customer_id,status,tier")
        .eq("user_id", user.id)
        .maybeSingle<{ stripe_customer_id: string | null; status: string; tier: string }>();
      if (entitlementError) throw new Error(`Scan pricing lookup failed: ${entitlementError.message}`);
      const member = Boolean(ent && ent.tier !== "free" && ["active", "trialing"].includes(ent.status));
      const scanPrice = member
        ? process.env.STRIPE_MEMBER_SCAN_PRICE_ID || process.env.STRIPE_PRICE_EXTRA_SCAN_MEMBER || null
        : process.env.STRIPE_SCAN_PRICE_ID || process.env.STRIPE_PRICE_EXTRA_SCAN_STANDARD || null;
      if (!scanPrice) return json({ error: "Single scans are still being connected." }, 503);
      const session = await getStripe().checkout.sessions.create(
        {
          mode: "payment",
          expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
          line_items: [{ price: scanPrice, quantity: 1 }],
          success_url: `${origin}/?purchase=scan-success`,
          cancel_url: `${origin}/?purchase=scan-cancelled`,
          client_reference_id: user.id,
          ...(ent?.stripe_customer_id ? { customer: ent.stripe_customer_id } : { customer_email: user.email }),
          metadata: { supabase_user_id: user.id, purpose: "scan_credit" },
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
    // product, bought at a different moment, so the webhook needs to know
    // nothing about the downsell existing.
    if (body?.purchase === "downsell") {
      const admin = getSupabaseAdmin();
      const [{ data: ent, error: entitlementError }, { data: prof, error: profileError }] = await Promise.all([
        admin
          .from("entitlements")
          .select("stripe_customer_id,status,tier")
          .eq("user_id", user.id)
          .maybeSingle<{ stripe_customer_id: string | null; status: string; tier: string }>(),
        admin
          .from("profiles")
          .select("trial_declined_at,downsell_redeemed_at")
          .eq("user_id", user.id)
          .maybeSingle<{ trial_declined_at: string | null; downsell_redeemed_at: string | null }>(),
      ]);
      if (entitlementError) throw new Error(`Downsell pricing lookup failed: ${entitlementError.message}`);
      if (profileError) throw new Error(`Downsell eligibility lookup failed: ${profileError.message}`);
      const member = Boolean(ent && ent.tier !== "free" && ["active", "trialing"].includes(ent.status));
      // Three conditions, and the third is the one that makes this an offer
      // rather than a tier. "Declined and not a member" both stay true
      // forever, so without a redemption stamp a declined account could come
      // back to this endpoint for every future scan and never pay the standard
      // price again. The client sends a fresh idempotency key each time, so
      // nothing deduplicated it either.
      //
      // A member is refused rather than quietly redirected to the standard
      // price: they already have the thing this sells, and charging them for
      // it because a stale tab offered it would be the worse outcome.
      if (member || !prof?.trial_declined_at || prof.downsell_redeemed_at) {
        return json({ error: "That offer is not available on this account." }, 403);
      }
      const downsellPrice =
        process.env.STRIPE_DOWNSELL_PRICE_ID
        || process.env.STRIPE_PRICE_SCAN_DOWNSELL
        // Falls back to the member scan price, which is the same amount for
        // the same product. A dedicated price is worth configuring so the
        // downsell can be read separately in Stripe, but the offer working is
        // worth more than the reporting.
        || process.env.STRIPE_MEMBER_SCAN_PRICE_ID
        || process.env.STRIPE_PRICE_EXTRA_SCAN_MEMBER
        || null;
      if (!downsellPrice) return json({ error: "Single scans are still being connected." }, 503);
      const session = await getStripe().checkout.sessions.create(
        {
          mode: "payment",
          expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
          line_items: [{ price: downsellPrice, quantity: 1 }],
          success_url: `${origin}/?purchase=scan-success`,
          cancel_url: `${origin}/?purchase=scan-cancelled`,
          client_reference_id: user.id,
          ...(ent?.stripe_customer_id ? { customer: ent.stripe_customer_id } : { customer_email: user.email }),
          metadata: { supabase_user_id: user.id, purpose: "scan_credit", offer: "decline_downsell" },
          custom_text: {
            submit: { message: "Your full analysis, unlocked the moment payment completes. One payment, no subscription." },
          },
        },
        request.headers.get("x-idempotency-key")
          ? { idempotencyKey: request.headers.get("x-idempotency-key") as string }
          : undefined,
      );
      if (!session.url) throw new Error("Stripe did not return a Checkout URL");
      return json({ url: session.url });
    }

    // One voiced analysis export — a payment like the scan credit, one flat
    // price for everyone. There is no member price on purpose: the cost being
    // covered is the synthesis call, and that costs the same whoever asks.
    if (body?.purchase === "voice") {
      const { data: ent, error: entitlementError } = await getSupabaseAdmin()
        .from("entitlements")
        .select("stripe_customer_id")
        .eq("user_id", user.id)
        .maybeSingle<{ stripe_customer_id: string | null }>();
      if (entitlementError) throw new Error(`Voice checkout lookup failed: ${entitlementError.message}`);
      const voicePrice =
        process.env.STRIPE_VOICED_PRICE_ID || process.env.STRIPE_PRICE_VOICED_ANALYSIS || null;
      if (!voicePrice) return json({ error: "Voiced analysis checkout is still being connected." }, 503);
      const session = await getStripe().checkout.sessions.create(
        {
          mode: "payment",
          expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
          line_items: [{ price: voicePrice, quantity: 1 }],
          success_url: `${origin}/?purchase=voice-success`,
          cancel_url: `${origin}/?purchase=voice-cancelled`,
          client_reference_id: user.id,
          ...(ent?.stripe_customer_id ? { customer: ent.stripe_customer_id } : { customer_email: user.email }),
          metadata: { supabase_user_id: user.id, purpose: "voice_credit" },
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
        .select("stripe_customer_id,stripe_subscription_id,status")
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
    if (
      entitlement?.stripe_subscription_id &&
      !["canceled", "incomplete_expired", "none"].includes(entitlement.status)
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

    const customerId = entitlement?.stripe_customer_id || null;
    const planName = tier === "starter" ? "Starter" : "Max";
    const session = await getStripe().checkout.sessions.create(
      {
        mode: "subscription",
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
        },
        subscription_data: {
          trial_period_days: 7,
          metadata: {
            supabase_user_id: user.id,
            tier,
            billing,
            trial_reservation_id: reservationId,
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
    console.error("create-checkout-session", safeMessage(error));
    return json({ error: "Checkout is not available yet. Try again shortly." }, 503);
  }
}
