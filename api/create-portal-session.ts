import {
  authenticatedUser,
  getStripe,
  getSupabaseAdmin,
  json,
  requestOrigin,
  safeMessage,
  stripeSubscriptionForUser,
} from "./_shared.js";

interface ExistingEntitlement {
  stripe_subscription_id: string | null;
}

function objectId(value: { id: string } | string | null): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

export async function POST(request: Request): Promise<Response> {
  const origin = requestOrigin(request);
  if (!origin) return json({ error: "Cross-origin billing access is not allowed." }, 403);

  try {
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in to manage billing." }, 401);

    const { data, error } = await getSupabaseAdmin()
      .from("entitlements")
      .select("stripe_subscription_id")
      .eq("user_id", user.id)
      .maybeSingle<ExistingEntitlement>();
    if (error) throw new Error(`Entitlement storage is unavailable: ${error.message}`);
    const subscription = await stripeSubscriptionForUser(user.id, data?.stripe_subscription_id);
    // Only a subscription whose server-stamped metadata matches this identity
    // may name the Customer Portal target. A projected Customer id alone is
    // not enough evidence to expose invoices and payment methods.
    const customerId = objectId(subscription?.customer ?? null);
    if (!customerId) return json({ error: "No Stripe subscription is linked to this account." }, 404);

    const session = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/`,
    });
    return json({ url: session.url });
  } catch (error) {
    console.error("create-portal-session", safeMessage(error));
    return json({ error: "Billing management is not available yet. Try again shortly." }, 503);
  }
}
