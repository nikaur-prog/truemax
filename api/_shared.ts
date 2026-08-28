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
  const { data: creator } = await admin
    .from("league_creators")
    .select("status, monthly_render_quota")
    .eq("user_id", userId)
    .maybeSingle<{ status: string; monthly_render_quota: number }>();
  if (!creator || creator.status !== "approved") return null;

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { count } = await admin
    .from("league_render_log")
    .select("id", { count: "exact", head: true })
    .eq("creator_id", userId)
    .gte("created_at", monthStart);
  return { quota: creator.monthly_render_quota, used: count ?? 0 };
}

/**
 * One row in the ledger, after the render actually happened. Failures are the
 * caller's to swallow: losing a log row must never turn a delivered render
 * into an error for the person who just paid a quota slot for it.
 */
export async function recordLeagueRender(userId: string, kind: string): Promise<void> {
  await getSupabaseAdmin().from("league_render_log").insert({ creator_id: userId, kind });
}

// ---------------------------------------------------------------------------
// Max-plan voice exports — the member-facing counterpart of League metering.
//
// A Max member can voice their own analysis video a few times a month; the
// allowance is a plan perk with a bounded cost, not a budget the owner set
// per person, so the quota is a constant here rather than a column. Same
// discipline as the League ledger otherwise: counted since the first of the
// current UTC month, recorded server-side after delivery.
// ---------------------------------------------------------------------------

export const MAX_VOICE_QUOTA = 8;

/**
 * The caller's voice-export budget, or null if they do not hold a live Max
 * plan. Live means active or trialing — the same definition max-chat uses,
 * so the two Max perks can never disagree about who is a member.
 */
export async function maxVoiceBudget(userId: string): Promise<LeagueRenderBudget | null> {
  const admin = getSupabaseAdmin();
  const { data: entitlement } = await admin
    .from("entitlements")
    .select("tier,status")
    .eq("user_id", userId)
    .maybeSingle<{ tier: string; status: string }>();
  if (!entitlement || entitlement.tier !== "max" || !["active", "trialing"].includes(entitlement.status)) {
    return null;
  }
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { count } = await admin
    .from("voice_export_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", monthStart);
  return { quota: MAX_VOICE_QUOTA, used: count ?? 0 };
}

/** After the audio came back — same never-fail-the-render rule as the League. */
export async function recordVoiceExport(userId: string): Promise<void> {
  await getSupabaseAdmin().from("voice_export_log").insert({ user_id: userId });
}
