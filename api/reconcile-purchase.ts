import {
  authenticatedUser,
  getStripe,
  getSupabaseAdmin,
  json,
  requestOrigin,
  safeMessage,
} from "./_shared.js";

type PurchaseKind = "scan" | "voice";

function checkoutSessionId(value: unknown): string | null {
  if (typeof value !== "string" || !/^cs_(?:test_|live_)?[A-Za-z0-9]+$/.test(value)) return null;
  return value;
}

export async function POST(request: Request): Promise<Response> {
  const origin = requestOrigin(request);
  if (!origin) return json({ error: "Cross-origin reconciliation is not allowed." }, 403);

  try {
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in before checking this purchase." }, 401);

    const body = await request.json().catch(() => null) as { sessionId?: unknown } | null;
    const sessionId = checkoutSessionId(body?.sessionId);
    if (!sessionId) return json({ reconciled: false }, 400);

    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    const purpose = session.metadata?.purpose;
    const kind: PurchaseKind | null = purpose === "scan_credit"
      ? "scan"
      : purpose === "voice_credit"
        ? "voice"
        : null;
    if (
      session.status !== "complete"
      || session.mode !== "payment"
      || session.payment_status !== "paid"
      || session.client_reference_id !== user.id
      || session.metadata?.supabase_user_id !== user.id
      || !kind
    ) {
      return json({ reconciled: false });
    }

    const admin = getSupabaseAdmin();
    const claimId = session.metadata?.downsell_claim_id;
    if (kind === "scan" && session.metadata?.offer === "decline_downsell" && claimId) {
      const { error } = await admin.rpc("redeem_downsell_credit", {
        p_event_id: `return:${session.id}`,
        p_checkout_session_id: session.id,
        p_user_id: user.id,
        p_claim_id: claimId,
      });
      if (error) throw new Error(`Downsell reconciliation failed: ${error.message}`);
    } else {
      const { error } = await admin.rpc("apply_one_time_credit", {
        p_event_id: `return:${session.id}`,
        p_checkout_session_id: session.id,
        p_user_id: user.id,
        p_credit_kind: kind,
        p_credits: 1,
      });
      if (error) throw new Error(`Purchase reconciliation failed: ${error.message}`);

      // A Checkout opened immediately before the claim-id deployment can
      // still return afterwards. Deliver it idempotently and permanently burn
      // the legacy downsell just as its webhook does.
      if (kind === "scan" && session.metadata?.offer === "decline_downsell") {
        const stamped = await admin
          .from("profiles")
          .update({ downsell_redeemed_at: new Date().toISOString() })
          .eq("user_id", user.id)
          .is("downsell_redeemed_at", null);
        if (stamped.error) throw new Error(`Downsell stamp failed: ${stamped.error.message}`);
      }
    }

    return json({ reconciled: true, kind });
  } catch (error) {
    console.error("reconcile-purchase", safeMessage(error));
    return json({ error: "Your purchase could not be confirmed yet. It is safe to retry." }, 503);
  }
}
