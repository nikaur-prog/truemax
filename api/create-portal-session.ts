import { authenticatedUser, getStripe, getSupabaseAdmin, json, requestOrigin, safeMessage } from "./_shared.ts";

interface ExistingEntitlement {
  stripe_customer_id: string | null;
}

export async function POST(request: Request): Promise<Response> {
  const origin = requestOrigin(request);
  if (!origin) return json({ error: "Cross-origin billing access is not allowed." }, 403);

  try {
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in to manage billing." }, 401);

    const { data, error } = await getSupabaseAdmin()
      .from("entitlements")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle<ExistingEntitlement>();
    if (error) throw new Error(`Entitlement storage is unavailable: ${error.message}`);
    if (!data?.stripe_customer_id) return json({ error: "No Stripe subscription is linked to this account." }, 404);

    const session = await getStripe().billingPortal.sessions.create({
      customer: data.stripe_customer_id,
      return_url: `${origin}/`,
    });
    return json({ url: session.url });
  } catch (error) {
    console.error("create-portal-session", safeMessage(error));
    return json({ error: "Billing management is not available yet. Try again shortly." }, 503);
  }
}
