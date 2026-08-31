import {
  leaguePayoutAccountState,
  payoutCountryAllowed,
  stripeLivemode,
  validCountry,
  validEntityType,
} from "./_league-payout.js";
import {
  authenticatedUser,
  getStripe,
  getSupabaseAdmin,
  json,
  requestOrigin,
  safeMessage,
} from "./_shared.js";

interface CreatorIdentity {
  status: string;
  display_name: string;
}

interface StoredPayoutAccount {
  stripe_account_id: string | null;
  country: string | null;
  entity_type: string | null;
}

async function approvedCreator(userId: string): Promise<CreatorIdentity | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("league_creators")
    .select("status,display_name")
    .eq("user_id", userId)
    .maybeSingle<CreatorIdentity>();
  if (error || data?.status !== "approved") return null;
  return data;
}

async function refreshAccount(userId: string, livemode: boolean, accountId: string) {
  const account = await getStripe().v2.core.accounts.retrieve(accountId, {
    include: ["configuration.recipient", "requirements"],
  });
  if (account.livemode !== livemode || account.closed) {
    throw new Error("Stripe payout account mode mismatch");
  }
  const state = leaguePayoutAccountState(account);
  const { error } = await getSupabaseAdmin()
    .from("league_payout_accounts")
    .update({
      transfers_status: state.transfersStatus,
      payouts_status: state.payoutsStatus,
      requirements_due: state.requirementsDue,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("livemode", livemode)
    .eq("stripe_account_id", accountId);
  if (error) throw new Error(`Payout status update failed: ${error.message}`);
  return state;
}

export async function POST(request: Request): Promise<Response> {
  const origin = requestOrigin(request);
  if (!origin) return json({ error: "Not found." }, 404);

  try {
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Not found." }, 404);
    const creator = await approvedCreator(user.id);
    if (!creator) return json({ error: "Not found." }, 404);

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = body.action === "onboard" ? "onboard" : "status";
    const livemode = stripeLivemode();
    const admin = getSupabaseAdmin();
    let { data: stored, error: storedError } = await admin
      .from("league_payout_accounts")
      .select("stripe_account_id,country,entity_type")
      .eq("user_id", user.id)
      .eq("livemode", livemode)
      .maybeSingle<StoredPayoutAccount>();
    if (storedError) throw new Error(`Payout account lookup failed: ${storedError.message}`);

    if (action === "status" && !stored?.stripe_account_id) {
      return json({ status: "not_started", livemode });
    }

    if (!stored?.stripe_account_id) {
      const country = typeof body.country === "string" ? body.country.toUpperCase() : body.country;
      if (!validCountry(country) || !validEntityType(body.entityType)) {
        return json({ error: "Choose your legal country and account type." }, 400);
      }
      if (!payoutCountryAllowed(country)) {
        return json({ error: "Stripe payouts are not available in that country yet." }, 409);
      }
      const { data: claim, error: claimError } = await admin.rpc("claim_league_payout_account_setup", {
        p_user_id: user.id,
        p_livemode: livemode,
        p_country: country,
        p_entity_type: body.entityType,
      });
      if (claimError) throw new Error(`Payout account claim failed: ${claimError.message}`);

      if (typeof claim === "string") {
        try {
          const account = await getStripe().v2.core.accounts.create({
            contact_email: user.email ?? undefined,
            display_name: creator.display_name,
            dashboard: "express",
            defaults: {
              currency: "usd",
              responsibilities: {
                fees_collector: "application",
                losses_collector: "application",
              },
            },
            identity: {
              country,
              entity_type: body.entityType,
            },
            configuration: {
              recipient: {
                capabilities: {
                  stripe_balance: {
                    stripe_transfers: { requested: true },
                  },
                },
              },
            },
            metadata: {
              supabase_user_id: user.id,
              programme: "creator_league",
            },
          }, { idempotencyKey: `league-connect:${livemode ? "live" : "test"}:${user.id}` });
          const { data: completed, error: completeError } = await admin.rpc(
            "complete_league_payout_account_setup",
            {
              p_user_id: user.id,
              p_livemode: livemode,
              p_claim: claim,
              p_stripe_account_id: account.id,
            },
          );
          if (completeError || completed !== true) {
            throw new Error(completeError?.message ?? "Payout account claim expired");
          }
        } catch (error) {
          await admin.rpc("release_league_payout_account_setup", {
            p_user_id: user.id,
            p_livemode: livemode,
            p_claim: claim,
          });
          throw error;
        }
      }

      const latest = await admin
        .from("league_payout_accounts")
        .select("stripe_account_id,country,entity_type")
        .eq("user_id", user.id)
        .eq("livemode", livemode)
        .maybeSingle<StoredPayoutAccount>();
      if (latest.error || !latest.data?.stripe_account_id) {
        return json({ error: "Payout setup is already starting. Try again in a moment." }, 409);
      }
      stored = latest.data;
    }

    const accountId = stored.stripe_account_id;
    if (!accountId) return json({ error: "Payout setup is already starting. Try again in a moment." }, 409);
    const state = await refreshAccount(user.id, livemode, accountId);
    if (action === "status") {
      return json({ status: state.ready ? "ready" : "needs_attention", livemode, ...state });
    }

    const link = await getStripe().v2.core.accountLinks.create({
      account: accountId,
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          configurations: ["recipient"],
          collection_options: {
            fields: "eventually_due",
            future_requirements: "include",
          },
          refresh_url: `${origin}/league?connect=refresh#money`,
          return_url: `${origin}/league?connect=return#money`,
        },
      },
    });
    return json({ url: link.url, status: state.ready ? "ready" : "needs_attention", livemode });
  } catch (error) {
    console.error("league-connect", safeMessage(error));
    return json({ error: "Payout setup is temporarily unavailable." }, 503);
  }
}
