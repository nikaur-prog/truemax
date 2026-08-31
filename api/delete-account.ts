import { authenticatedUser, getStripe, getSupabaseAdmin, json, requestOrigin, safeMessage } from "./_shared.js";
import { stripeLivemode } from "./_league-payout.js";

interface BillingIdentity {
  stripe_subscription_id: string | null;
  status: string;
}

export async function POST(request: Request): Promise<Response> {
  const origin = requestOrigin(request);
  if (!origin) return json({ error: "Cross-origin account deletion is not allowed." }, 403);

  let restoreSubscription: string | null = null;
  try {
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in before deleting your account." }, 401);

    const admin = getSupabaseAdmin();
    const [{ count: unsettled, error: payoutError }, { data: payoutAccount, error: accountError }] = await Promise.all([
      admin
        .from("league_payouts")
        .select("id", { count: "exact", head: true })
        .eq("creator_id", user.id)
        .in("status", ["computed", "approved", "processing", "failed"]),
      admin
        .from("league_payout_accounts")
        .select("stripe_account_id")
        .eq("user_id", user.id)
        .eq("livemode", stripeLivemode())
        .maybeSingle<{ stripe_account_id: string | null }>(),
    ]);
    if (payoutError || accountError) throw new Error("Creator payout lookup failed");
    if ((unsettled ?? 0) > 0) {
      return json({
        error: "Your account has a Creator League payout still being settled. Contact support so we can pay it before deletion.",
      }, 409);
    }

    const { data, error } = await admin
      .from("entitlements")
      .select("stripe_subscription_id,status")
      .eq("user_id", user.id)
      .maybeSingle<BillingIdentity>();
    if (error) throw new Error(`Billing lookup failed: ${error.message}`);

    // Stop renewal first, but keep the operation compensatable until Supabase
    // confirms the identity deletion. An immediate Stripe cancellation cannot
    // be undone; if auth deletion then fails, the old order left a live account
    // with paid access irreversibly cancelled.
    if (data?.stripe_subscription_id && !["canceled", "incomplete_expired"].includes(data.status)) {
      const subscription = await getStripe().subscriptions.retrieve(data.stripe_subscription_id);
      if (!subscription.cancel_at_period_end) {
        await getStripe().subscriptions.update(data.stripe_subscription_id, { cancel_at_period_end: true });
        restoreSubscription = data.stripe_subscription_id;
      }
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) throw new Error(`Account deletion failed: ${deleteError.message}`);
    restoreSubscription = null;
    // Local identity and payout setup are already gone. Closing the matching
    // Stripe recipient prevents any future transfers while Stripe retains only
    // records it must keep for financial and identity-verification law.
    if (payoutAccount?.stripe_account_id) {
      await getStripe().v2.core.accounts.close(payoutAccount.stripe_account_id).catch((closeError) => {
        console.error("delete-account payout close", safeMessage(closeError));
      });
    }
    return json({ deleted: true });
  } catch (error) {
    console.error("delete-account", safeMessage(error));
    if (restoreSubscription) {
      await getStripe().subscriptions.update(restoreSubscription, { cancel_at_period_end: false }).catch((restoreError) => {
        console.error("delete-account subscription restore", safeMessage(restoreError));
      });
    }
    return json({ error: "Your account was not deleted. Please try again, or contact support." }, 503);
  }
}
