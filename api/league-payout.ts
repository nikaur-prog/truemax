import { leaguePayoutAccountState, stripeLivemode } from "./_league-payout.js";
import {
  authenticatedUser,
  getStripe,
  getSupabaseAdmin,
  json,
  requestOrigin,
  safeMessage,
} from "./_shared.js";

interface ClaimedPayout {
  payout_id: string;
  creator_id: string;
  amount_cents: number;
  currency: string;
  stripe_account_id: string;
  attempt_id: string;
  sprint_id: string;
}

async function isStaff(userId: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from("app_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle<{ user_id: string }>();
  return !error && data?.user_id === userId;
}

export async function POST(request: Request): Promise<Response> {
  if (!requestOrigin(request)) return json({ error: "Not found." }, 404);

  try {
    const user = await authenticatedUser(request);
    if (!user || !(await isStaff(user.id))) return json({ error: "Not found." }, 404);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (typeof body.payoutId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.payoutId)) {
      return json({ error: "Choose a payout to send." }, 400);
    }
    if (process.env.LEAGUE_PAYOUTS_ENABLED !== "true") {
      return json({ error: "Stripe transfers are locked until launch approval is complete." }, 503);
    }

    const livemode = stripeLivemode();
    const admin = getSupabaseAdmin();
    const { data: candidate, error: candidateError } = await admin
      .from("league_payouts")
      .select("id,creator_id,status,stripe_transfer_id")
      .eq("id", body.payoutId)
      .maybeSingle<{ id: string; creator_id: string | null; status: string; stripe_transfer_id: string | null }>();
    if (candidateError || !candidate?.creator_id) return json({ error: "Payout not found." }, 404);
    if (candidate.status === "transferred") {
      return json({ transferred: true, transferId: candidate.stripe_transfer_id });
    }

    const { data: stored, error: storedError } = await admin
      .from("league_payout_accounts")
      .select("stripe_account_id")
      .eq("user_id", candidate.creator_id)
      .eq("livemode", livemode)
      .maybeSingle<{ stripe_account_id: string | null }>();
    if (storedError || !stored?.stripe_account_id) {
      return json({ error: "The creator has not finished Stripe payout setup." }, 409);
    }
    const account = await getStripe().v2.core.accounts.retrieve(stored.stripe_account_id, {
      include: ["configuration.recipient", "requirements"],
    });
    const state = leaguePayoutAccountState(account);
    await admin.from("league_payout_accounts").update({
      transfers_status: state.transfersStatus,
      payouts_status: state.payoutsStatus,
      requirements_due: state.requirementsDue,
      updated_at: new Date().toISOString(),
    }).eq("user_id", candidate.creator_id).eq("livemode", livemode);
    if (account.closed || account.livemode !== livemode || !state.ready) {
      return json({ error: "The creator's Stripe payout account still needs attention." }, 409);
    }

    const { data: claimed, error: claimError } = await admin.rpc("claim_league_transfer_for_mode", {
      p_payout_id: body.payoutId,
      p_livemode: livemode,
    });
    if (claimError) throw new Error(`Payout claim failed: ${claimError.message}`);
    const payout = (claimed as ClaimedPayout[] | null)?.[0];
    if (!payout) {
      return json({ error: "That payout is already sending or is not approved." }, 409);
    }

    try {
      const transfer = await getStripe().transfers.create({
        amount: payout.amount_cents,
        currency: payout.currency,
        destination: payout.stripe_account_id,
        transfer_group: `league_sprint_${payout.sprint_id}`,
        metadata: {
          league_payout_id: payout.payout_id,
          league_sprint_id: payout.sprint_id,
        },
      }, { idempotencyKey: `league-payout:${payout.payout_id}` });
      const { data: completed, error: completeError } = await admin.rpc("complete_league_transfer", {
        p_payout_id: payout.payout_id,
        p_attempt_id: payout.attempt_id,
        p_stripe_transfer_id: transfer.id,
      });
      if (completeError || completed !== true) {
        throw new Error(completeError?.message ?? "Payout ledger completion failed");
      }
      return json({ transferred: true, transferId: transfer.id });
    } catch (error) {
      await admin.rpc("fail_league_transfer", {
        p_payout_id: payout.payout_id,
        p_attempt_id: payout.attempt_id,
        p_code: "stripe_transfer_failed",
        p_message: "Stripe did not confirm the transfer. It is safe to retry.",
      });
      throw error;
    }
  } catch (error) {
    console.error("league-payout", safeMessage(error));
    return json({ error: "The transfer did not complete. Nothing was recorded as paid." }, 503);
  }
}
