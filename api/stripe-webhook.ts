import { getStripe, getSupabaseAdmin, json, safeMessage } from "./_shared.js";

type StripeClient = ReturnType<typeof getStripe>;
type Subscription = Omit<Awaited<ReturnType<StripeClient["subscriptions"]["retrieve"]>>, "lastResponse">;
type CheckoutSession = Omit<Awaited<ReturnType<StripeClient["checkout"]["sessions"]["retrieve"]>>, "lastResponse">;

interface EntitlementUpdate {
  userId: string;
  tier: "free" | "starter" | "max";
  status: string;
  customerId: string;
  subscriptionId: string;
  priceId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export function configuredWebhookSecrets(
  env: Partial<Record<"STRIPE_WEBHOOK_SECRET" | "SIGNING_SECRET", string | undefined>> = process.env,
): string[] {
  return [
    ...new Set(
      [env.STRIPE_WEBHOOK_SECRET, env.SIGNING_SECRET]
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

export function verifyWebhookEvent<T>(
  constructEvent: (payload: string, signature: string, secret: string) => T,
  payload: string,
  signature: string,
  secrets: readonly string[],
): T {
  let lastError: unknown = new Error("No Stripe webhook secret is configured.");
  for (const secret of secrets) {
    try {
      return constructEvent(payload, signature, secret);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function objectId(value: { id: string } | string | null): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

export function entitlementFromSubscription(subscription: Subscription): EntitlementUpdate | null {
  const userId = subscription.metadata.supabase_user_id;
  const customerId = objectId(subscription.customer);
  if (!userId || !customerId) return null;

  const item = subscription.items.data[0];
  const priceId = item?.price.id ?? null;
  const paidStatus = subscription.status === "active" || subscription.status === "trialing";
  // The server stamps this metadata when it creates Checkout. Trusting that
  // marker keeps existing subscribers entitled if a new price replaces the
  // current STRIPE_MAX_PRICE_ID; unrelated Stripe products have no marker.
  const stampedTier = subscription.metadata.tier;
  if (stampedTier !== "starter" && stampedTier !== "max") return null;

  return {
    userId,
    tier: paidStatus ? stampedTier : "free",
    status: subscription.status,
    customerId,
    subscriptionId: subscription.id,
    priceId,
    currentPeriodEnd: item?.current_period_end
      ? new Date(item.current_period_end * 1000).toISOString()
      : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  };
}

async function fromCheckout(session: CheckoutSession): Promise<EntitlementUpdate | null> {
  const subscriptionId = objectId(session.subscription);
  if (!subscriptionId) return null;
  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  return entitlementFromSubscription(subscription);
}

export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get("stripe-signature");
  // There are two live Stripe webhook endpoints for the same production URL,
  // each with its own signing secret. Trying only the first configured value
  // makes every delivery from the other endpoint look forged. Verify against
  // every configured secret; the payload still has to match one exactly.
  const webhookSecrets = configuredWebhookSecrets();
  if (!signature || webhookSecrets.length === 0) return json({ error: "Webhook is not configured." }, 400);

  const rawBody = await request.text();
  let event: ReturnType<StripeClient["webhooks"]["constructEvent"]>;
  try {
    // Stripe signs the exact bytes it sends. Reading text here, before any JSON
    // parser touches whitespace or key order, is mandatory for verification.
    event = verifyWebhookEvent(
      getStripe().webhooks.constructEvent.bind(getStripe().webhooks),
      rawBody,
      signature,
      webhookSecrets,
    );
  } catch (error) {
    console.error("stripe-webhook signature", safeMessage(error));
    return json({ error: "Invalid webhook signature." }, 400);
  }

  try {
    if (
      event.type === "checkout.session.completed"
      || event.type === "checkout.session.async_payment_succeeded"
    ) {
      const session = event.data.object;
      // Scan-credit purchases are payments with a purpose marker the server
      // stamped at Checkout creation. Payment status is checked because a
      // completed session with delayed payment methods can still be unpaid,
      // and a credit granted on an unpaid session is a free scan.
      if (session.metadata?.purpose === "scan_credit" && session.payment_status === "paid") {
        const userId = session.metadata.supabase_user_id;
        if (userId) {
          const { error } = await getSupabaseAdmin().rpc("apply_one_time_credit", {
            p_event_id: event.id,
            p_checkout_session_id: session.id,
            p_user_id: userId,
            p_credit_kind: "scan",
            p_credits: 1,
          });
          if (error) throw new Error(`Scan credit grant failed: ${error.message}`);
        }
      }

      // Voiced-analysis purchases: same shape, different ledger.
      if (session.metadata?.purpose === "voice_credit" && session.payment_status === "paid") {
        const userId = session.metadata.supabase_user_id;
        if (userId) {
          const { error } = await getSupabaseAdmin().rpc("apply_one_time_credit", {
            p_event_id: event.id,
            p_checkout_session_id: session.id,
            p_user_id: userId,
            p_credit_kind: "voice",
            p_credits: 1,
          });
          if (error) throw new Error(`Voice credit grant failed: ${error.message}`);
        }
      }
    }

    if (event.type === "checkout.session.expired") {
      const session = event.data.object;
      const userId = session.metadata?.supabase_user_id;
      const reservationId = session.metadata?.trial_reservation_id;
      if (userId && reservationId) {
        const { error } = await getSupabaseAdmin()
          .from("trial_redemptions")
          .delete()
          .eq("user_id", userId)
          .eq("reservation_id", reservationId)
          .eq("status", "reserved");
        if (error) throw new Error(`Expired trial release failed: ${error.message}`);
      }
      return json({ received: true });
    }

    let update: EntitlementUpdate | null = null;
    if (
      event.type === "checkout.session.completed"
      || event.type === "checkout.session.async_payment_succeeded"
    ) {
      update = await fromCheckout(event.data.object);
    } else if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      update = entitlementFromSubscription(event.data.object);
    } else {
      return json({ received: true, ignored: true });
    }

    // A Stripe account can contain unrelated products. Only sessions created
    // by TrueMax carry this user metadata, so unrelated events are acknowledged
    // without touching Supabase.
    if (!update) return json({ received: true, ignored: true });

    const { error } = await getSupabaseAdmin().rpc("apply_stripe_entitlement", {
      p_event_id: event.id,
      p_event_type: event.type,
      p_event_created_at: new Date(event.created * 1000).toISOString(),
      p_user_id: update.userId,
      p_tier: update.tier,
      p_status: update.status,
      p_customer_id: update.customerId,
      p_subscription_id: update.subscriptionId,
      p_price_id: update.priceId,
      p_current_period_end: update.currentPeriodEnd,
      p_cancel_at_period_end: update.cancelAtPeriodEnd,
    });
    if (error) throw new Error(`Entitlement update failed: ${error.message}`);

    return json({ received: true });
  } catch (error) {
    console.error("stripe-webhook", safeMessage(error));
    // A server failure must stay non-2xx so Stripe retries the delivery. Bad
    // signatures above are the only permanent 400-class failure.
    return json({ error: "Webhook processing failed." }, 500);
  }
}
