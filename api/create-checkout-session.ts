import { isAdult } from "../src/engine/age.ts";
import { authenticatedUser, getStripe, getSupabaseAdmin, json, requestOrigin, safeMessage } from "./_shared.ts";

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

function configuredPrice(tier: PaidTier): string | null {
  return process.env[tier === "starter" ? "STRIPE_STARTER_PRICE_ID" : "STRIPE_MAX_PRICE_ID"] || null;
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

    const body = await request.json().catch(() => null) as { tier?: unknown } | null;
    if (!isPaidTier(body?.tier)) return json({ error: "Choose Starter or Max to continue." }, 400);
    const tier = body.tier;
    const priceId = configuredPrice(tier);
    if (!priceId) return json({ error: `${tier === "starter" ? "Starter" : "Max"} checkout is still being connected.` }, 503);

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
        success_url: `${origin}/?checkout=success&plan=${tier}`,
        cancel_url: `${origin}/?checkout=cancelled&plan=${tier}`,
        client_reference_id: user.id,
        ...(customerId ? { customer: customerId } : { customer_email: user.email }),
        allow_promotion_codes: true,
        metadata: {
          supabase_user_id: user.id,
          tier,
          trial_reservation_id: reservationId,
        },
        subscription_data: {
          trial_period_days: 7,
          metadata: {
            supabase_user_id: user.id,
            tier,
            trial_reservation_id: reservationId,
          },
        },
        custom_text: {
          submit: {
            message: `${planName} is free for 7 days, then renews monthly until cancelled. Cancel before the trial ends to pay $0.`,
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
