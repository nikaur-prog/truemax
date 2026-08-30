import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import Stripe from "stripe";

let stripeClient: Stripe | null = null;
let adminClient: SupabaseClient | null = null;

function required(name: string, fallback?: string): string {
  const value = process.env[name] || (fallback ? process.env[fallback] : undefined);
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

export function getStripe(): Stripe {
  if (!stripeClient) stripeClient = new Stripe(required("STRIPE_SECRET_KEY"));
  return stripeClient;
}

/**
 * Resolve the Stripe subscription that belongs to one Supabase identity.
 *
 * Entitlements are a webhook-fed projection, so they can be stale at the
 * exact moment Checkout has to decide whether an account already owns a plan.
 * Prefer the exact linked subscription, then repair a missing link from the
 * user id stamped by the server when Checkout created the subscription.
 */
export async function stripeSubscriptionForUser(
  userId: string,
  knownSubscriptionId?: string | null,
): Promise<Stripe.Subscription | null> {
  const openStatuses = new Set<Stripe.Subscription.Status>([
    "active",
    "trialing",
    "past_due",
    "unpaid",
    "paused",
    "incomplete",
  ]);
  let known: Stripe.Subscription | null = null;
  if (knownSubscriptionId) {
    try {
      const candidate = await getStripe().subscriptions.retrieve(knownSubscriptionId);
      if (candidate.metadata.supabase_user_id === userId) {
        known = candidate;
        if (openStatuses.has(candidate.status)) return candidate;
      }
    } catch {
      // A deleted or replaced link can still be repaired from server metadata.
    }
  }

  const result = await getStripe().subscriptions.search({
    query: `metadata['supabase_user_id']:'${userId}'`,
    limit: 20,
  });
  const searched = result.data
    .filter((subscription) => subscription.metadata.supabase_user_id === userId)
    .sort((a, b) => {
      const statusOrder = Number(openStatuses.has(b.status)) - Number(openStatuses.has(a.status));
      return statusOrder || b.created - a.created;
    })[0] ?? null;
  return searched ?? known;
}

export function getSupabaseAdmin(): SupabaseClient {
  if (!adminClient) {
    adminClient = createClient(
      required("SUPABASE_URL"),
      required("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      },
    );
  }
  return adminClient;
}

export async function authenticatedUser(request: Request): Promise<User | null> {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const { data, error } = await getSupabaseAdmin().auth.getUser(match[1]);
  return error ? null : data.user;
}

export function requestOrigin(request: Request): string | null {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== requestUrl.origin) return null;

  // A same-origin browser request identifies the exact deployment that opened
  // Checkout. Forcing the configured production URL here made every Preview
  // checkout return into production, defeating safe sandbox verification.
  if (origin) return origin;

  const configured = process.env.TRUEMAX_APP_URL;
  if (!configured) return requestUrl.origin;
  try {
    return new URL(configured).origin;
  } catch {
    throw new Error("TRUEMAX_APP_URL must be an absolute URL");
  }
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

// ---------------------------------------------------------------------------
// Creator League render metering.
//
// League members reach the billable pillar endpoints (/api/tts today), and
// every one of those calls spends money the owner budgeted per creator as
// league_creators.monthly_render_quota. The ledger is league_render_log,
// written HERE after a render succeeds — the client never writes its own
// meter. The month window is "since the first of the current UTC month",
// computed at check time so there is nothing to reset.
// ---------------------------------------------------------------------------

export interface LeagueRenderBudget {
  quota: number;
  used: number;
}

/**
 * The caller's League render budget, or null if they are not an approved
 * League creator. A null from a non-staff caller means the endpoint should
 * refuse — with 404, matching the convention that these endpoints do not
 * confirm their own existence to strangers.
 */
export async function leagueRenderBudget(userId: string): Promise<LeagueRenderBudget | null> {
  const admin = getSupabaseAdmin();
  const { data: creator, error: creatorError } = await admin
    .from("league_creators")
    .select("status, monthly_render_quota,pillar_grants")
    .eq("user_id", userId)
    .maybeSingle<{ status: string; monthly_render_quota: number; pillar_grants: Record<string, unknown> | null }>();
  if (creatorError) throw new Error(creatorError.message);
  if (!creator || creator.status !== "approved" || creator.pillar_grants?.cta !== true) return null;

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { count, error: countError } = await admin
    .from("league_render_log")
    .select("id", { count: "exact", head: true })
    .eq("creator_id", userId)
    .gte("created_at", monthStart);
  if (countError) throw new Error(countError.message);
  return { quota: creator.monthly_render_quota, used: count ?? 0 };
}

/**
 * One row in the ledger, after the render actually happened. Failures are the
 * caller's to swallow: losing a log row must never turn a delivered render
 * into an error for the person who just paid a quota slot for it.
 */
export async function recordLeagueRender(userId: string, kind: string): Promise<void> {
  const { error } = await getSupabaseAdmin().from("league_render_log").insert({ creator_id: userId, kind });
  if (error) throw new Error(error.message);
}

/**
 * Which ledger a reserved render is spent from.
 *
 * "studio" is an AI image pair. It shares the League monthly quota with
 * "league" narration and differs only in the pillar grant that opens it and
 * the `kind` its finalize writes. See the 20260830120000 migration for why an
 * image pair goes through the same reserve/finalize/refund path rather than a
 * simpler count-then-log: the OpenAI calls sit between the check and the spend,
 * so a check-then-spend lets two concurrent pairs take the last slot.
 */
export type TtsMeter = "league" | "voice" | "studio";

export async function claimTtsRender(userId: string, meter: TtsMeter): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin().rpc("claim_tts_render", {
    p_user_id: userId,
    p_meter: meter,
  });
  if (error) throw new Error(error.message);
  return typeof data === "string" && data ? data : null;
}

export async function finalizeTtsRender(reservationId: string, userId: string): Promise<void> {
  const { data, error } = await getSupabaseAdmin().rpc("finalize_tts_render", {
    p_reservation_id: reservationId,
    p_user_id: userId,
  });
  if (error || data !== true) throw new Error(error?.message || "Narration reservation could not be finalized");
}

export async function refundTtsRender(reservationId: string, userId: string): Promise<void> {
  const { error } = await getSupabaseAdmin().rpc("refund_tts_render", {
    p_reservation_id: reservationId,
    p_user_id: userId,
  });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Max-plan voice exports — the member-facing counterpart of League metering.
//
// A voiced analysis is a $2.99 purchase, one credit per export. The webhook
// grants (grant_voice_credit, service role only) and /api/tts spends —
// atomically, server-side, and only after audio actually came back. This
// replaced a Max-plan monthly allowance: every render costs real synthesis
// money, so every render is paid for, whatever plan the buyer holds.
// ---------------------------------------------------------------------------

/** How many voiced exports this account has bought and not yet used. */
export async function voiceCreditBalance(userId: string): Promise<number> {
  const { data, error } = await getSupabaseAdmin()
    .from("voice_credits")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle<{ balance: number }>();
  if (error) throw new Error(error.message);
  return data?.balance ?? 0;
}

/**
 * Spend one credit, after delivery. Atomic in SQL (spend_voice_credit), so
 * two simultaneous renders cannot both ride one credit. Returns the balance
 * after the spend, or -1 when there was nothing left to spend.
 */
export async function spendVoiceCredit(userId: string): Promise<number> {
  const { data, error } = await getSupabaseAdmin().rpc("spend_voice_credit", { p_user_id: userId });
  if (error) throw new Error(error.message);
  return typeof data === "number" ? data : -1;
}
