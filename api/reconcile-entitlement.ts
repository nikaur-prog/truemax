import type Stripe from "stripe";
import {
  authenticatedUser,
  getStripe,
  getSupabaseAdmin,
  json,
  requestOrigin,
  safeMessage,
} from "./_shared.js";
import { entitlementFromSubscription } from "./stripe-webhook.js";

const CURRENT_STATUSES = new Set<Stripe.Subscription.Status>([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
]);

export function chooseCurrentSubscription(
  subscriptions: readonly Stripe.Subscription[],
): Stripe.Subscription | null {
  return [...subscriptions]
    .filter((subscription) => CURRENT_STATUSES.has(subscription.status))
    .sort((a, b) => b.created - a.created)[0] ?? null;
}

async function subscriptionFromSession(
  sessionId: string,
  userId: string,
): Promise<Stripe.Subscription | null> {
  if (!/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(sessionId)) return null;
  const session = await getStripe().checkout.sessions.retrieve(sessionId);
  if (
    session.status !== "complete" ||
    session.mode !== "subscription" ||
    session.client_reference_id !== userId ||
    session.metadata?.supabase_user_id !== userId
  ) return null;

  const subscriptionId = typeof session.subscription === "string"
    ? session.subscription
    : session.subscription?.id;
  if (!subscriptionId) return null;
  return getStripe().subscriptions.retrieve(subscriptionId);
}

async function subscriptionFromUserMetadata(userId: string): Promise<Stripe.Subscription | null> {
  const result = await getStripe().subscriptions.search({
    query: `metadata['supabase_user_id']:'${userId}'`,
    limit: 20,
  });
  return chooseCurrentSubscription(result.data);
}

export async function POST(request: Request): Promise<Response> {
  const origin = requestOrigin(request);
  if (!origin) return json({ error: "Cross-origin reconciliation is not allowed." }, 403);

  try {
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in before checking membership." }, 401);
    const body = await request.json().catch(() => null) as { sessionId?: unknown } | null;
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : null;

    // The Checkout id is the strongest lookup because it identifies the exact
    // return journey. Existing affected subscribers have no id in their URL,
    // so a metadata lookup repairs them too. Both paths are bound to the
    // authenticated Supabase user; a caller cannot nominate somebody else's
    // subscription and attach it to their account.
    const subscription = sessionId
      ? await subscriptionFromSession(sessionId, user.id)
      : await subscriptionFromUserMetadata(user.id);
    if (!subscription || subscription.metadata.supabase_user_id !== user.id) {
      return json({ reconciled: false });
    }

    const update = entitlementFromSubscription(subscription);
    if (!update || update.userId !== user.id) return json({ reconciled: false });
    const itemPeriod = subscription.items.data[0]?.current_period_end ?? 0;
    const reconciliationId = `reconcile:${subscription.id}:${subscription.status}:${itemPeriod}`;
    const reconciledAt = new Date().toISOString();
    const { error } = await getSupabaseAdmin().rpc("apply_stripe_entitlement", {
      p_event_id: reconciliationId,
      p_event_type: "truemax.entitlement.reconciled",
      p_event_created_at: reconciledAt,
      p_user_id: update.userId,
      p_tier: update.tier,
      p_status: update.status,
      p_customer_id: update.customerId,
      p_subscription_id: update.subscriptionId,
      p_price_id: update.priceId,
      p_current_period_end: update.currentPeriodEnd,
      p_cancel_at_period_end: update.cancelAtPeriodEnd,
    });
    if (error) throw new Error(`Entitlement reconciliation failed: ${error.message}`);

    return json({ reconciled: true, tier: update.tier, status: update.status });
  } catch (error) {
    console.error("reconcile-entitlement", safeMessage(error));
    return json({ error: "Membership could not be checked yet." }, 503);
  }
}
