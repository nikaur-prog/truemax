import { authenticatedUser, getStripe, getSupabaseAdmin, json, requestOrigin, safeMessage } from "./_shared.js";

interface BillingIdentity {
  stripe_subscription_id: string | null;
  status: string;
}

export async function POST(request: Request): Promise<Response> {
  const origin = requestOrigin(request);
  if (!origin) return json({ error: "Cross-origin account deletion is not allowed." }, 403);

  try {
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in before deleting your account." }, 401);

    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("entitlements")
      .select("stripe_subscription_id,status")
      .eq("user_id", user.id)
      .maybeSingle<BillingIdentity>();
    if (error) throw new Error(`Billing lookup failed: ${error.message}`);

    // Cancel first. If Stripe is temporarily unavailable the identity remains
    // usable and the person can retry; deleting first could strand a charge
    // behind an account that no longer exists.
    if (data?.stripe_subscription_id && !["canceled", "incomplete_expired"].includes(data.status)) {
      await getStripe().subscriptions.cancel(data.stripe_subscription_id);
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) throw new Error(`Account deletion failed: ${deleteError.message}`);
    return json({ deleted: true });
  } catch (error) {
    console.error("delete-account", safeMessage(error));
    return json({ error: "Your account was not deleted. Please try again, or contact support." }, 503);
  }
}
