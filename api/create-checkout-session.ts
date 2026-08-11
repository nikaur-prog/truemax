import { authenticatedUser, getStripe, getSupabaseAdmin, json, requestOrigin, safeMessage } from "./_shared.ts";

interface ExistingEntitlement {
  stripe_customer_id: string | null;
}

export async function POST(request: Request): Promise<Response> {
  const origin = requestOrigin(request);
  if (!origin) return json({ error: "Cross-origin checkout is not allowed." }, 403);

  try {
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in before starting checkout." }, 401);

    const priceId = process.env.STRIPE_MAX_PRICE_ID;
    if (!priceId) throw new Error("STRIPE_MAX_PRICE_ID is not configured");

    // Do not take payment until the entitlement table exists. A successful
    // charge with nowhere to provision access is worse than a blocked checkout.
    const { data, error } = await getSupabaseAdmin()
      .from("entitlements")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle<ExistingEntitlement>();
    if (error) throw new Error(`Entitlement storage is unavailable: ${error.message}`);

    const customerId = data?.stripe_customer_id || null;
    const session = await getStripe().checkout.sessions.create(
      {
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${origin}/?checkout=success`,
        cancel_url: `${origin}/?checkout=cancelled`,
        client_reference_id: user.id,
        ...(customerId ? { customer: customerId } : { customer_email: user.email }),
        allow_promotion_codes: true,
        metadata: {
          supabase_user_id: user.id,
          tier: "max",
        },
        subscription_data: {
          metadata: {
            supabase_user_id: user.id,
            tier: "max",
          },
        },
      },
      request.headers.get("x-idempotency-key")
        ? { idempotencyKey: request.headers.get("x-idempotency-key") as string }
        : undefined,
    );

    if (!session.url) throw new Error("Stripe did not return a Checkout URL");
    return json({ url: session.url });
  } catch (error) {
    console.error("create-checkout-session", safeMessage(error));
    return json({ error: "Checkout is not available yet. Try again shortly." }, 503);
  }
}
