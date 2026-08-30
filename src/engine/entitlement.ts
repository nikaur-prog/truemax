import { currentAccessToken, getSupabaseClient } from "./auth.js";

export type EntitlementTier = "free" | "starter" | "max";
export type PaidTier = Exclude<EntitlementTier, "free">;

export interface Entitlement {
  tier: EntitlementTier;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

interface EntitlementRow {
  tier: EntitlementTier;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

export interface BillingResult {
  ok: boolean;
  message?: string;
}

const FREE: Entitlement = {
  tier: "free",
  status: "none",
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

export async function loadEntitlement(): Promise<Entitlement> {
  const client = await getSupabaseClient();
  const { data, error } = await client
    .from("entitlements")
    .select("tier,status,current_period_end,cancel_at_period_end")
    .maybeSingle<EntitlementRow>();
  if (error) throw new Error(error.message);
  if (!data) return FREE;
  return {
    tier: data.tier,
    status: data.status,
    currentPeriodEnd: data.current_period_end,
    cancelAtPeriodEnd: data.cancel_at_period_end,
  };
}

export function hasMaxAccess(entitlement: Entitlement): boolean {
  return entitlement.tier === "max" &&
    (entitlement.status === "active" || entitlement.status === "trialing");
}

export function hasPaidAccess(entitlement: Entitlement): boolean {
  return entitlement.tier !== "free" &&
    (entitlement.status === "active" || entitlement.status === "trialing");
}

async function billingRedirect(path: string, payload?: unknown): Promise<BillingResult> {
  const accessToken = await currentAccessToken();
  if (!accessToken) return { ok: false, message: "Sign in before opening billing." };

  try {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Idempotency-Key": crypto.randomUUID(),
        ...(payload ? { "Content-Type": "application/json" } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    const body = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
    if (!response.ok || !body?.url) {
      return { ok: false, message: body?.error || "Billing is not available yet." };
    }
    location.assign(body.url);
    return { ok: true };
  } catch {
    return { ok: false, message: "Could not reach billing. Check your connection and try again." };
  }
}

// Billing period rides alongside the tier rather than replacing it: an annual
// Max subscriber is on tier "max" like everybody else, and only the Stripe
// price differs. See api/create-checkout-session.ts for why that matters.
export type Billing = "monthly" | "annual";

export function startTrialCheckout(tier: PaidTier, billing: Billing = "monthly"): Promise<BillingResult> {
  return billingRedirect("/api/create-checkout-session", { tier, billing });
}

export function startMaxCheckout(billing: Billing = "monthly"): Promise<BillingResult> {
  return startTrialCheckout("max", billing);
}

export function openBillingPortal(): Promise<BillingResult> {
  return billingRedirect("/api/create-portal-session");
}

export interface CheckoutResult {
  status: "success" | "cancelled";
  sessionId: string | null;
}

export function consumeCheckoutResult(): CheckoutResult | null {
  const url = new URL(location.href);
  const value = url.searchParams.get("checkout");
  if (value !== "success" && value !== "cancelled") return null;
  const sessionId = url.searchParams.get("session_id");
  url.searchParams.delete("checkout");
  url.searchParams.delete("plan");
  url.searchParams.delete("session_id");
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  return { status: value, sessionId };
}

export async function reconcileEntitlement(sessionId?: string | null): Promise<boolean> {
  const accessToken = await currentAccessToken();
  if (!accessToken) return false;

  try {
    const response = await fetch("/api/reconcile-entitlement", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sessionId ? { sessionId } : {}),
    });
    const body = await response.json().catch(() => null) as { reconciled?: boolean } | null;
    return response.ok && body?.reconciled === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// One-time scan credits: the non-subscription way through the depth gate.
// The balance lives server-side and moves only through SECURITY DEFINER
// functions, so nothing here can invent a credit — only read and spend.
// ---------------------------------------------------------------------------

export async function loadScanCredits(): Promise<number> {
  const client = await getSupabaseClient();
  const { data, error } = await client
    .from("scan_credits")
    .select("balance")
    .maybeSingle<{ balance: number }>();
  if (error) throw new Error(error.message);
  return data?.balance ?? 0;
}

// Is this account staff?
//
// One row, readable only by its owner, granted by hand in the SQL editor. The
// alternative — an email allowlist in the client — would publish a personal
// address in a public repository and still be a client-side check.
//
// Nothing here reads anyone else's data, because there is nothing to read:
// scans never leave the device and the analytics table has no identity
// columns. Staff means unlimited scan depth for yourself and nothing more.
export async function loadIsAdmin(): Promise<boolean> {
  const client = await getSupabaseClient();
  const { data, error } = await client
    .from("app_admins")
    .select("user_id")
    .maybeSingle<{ user_id: string }>();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export function startScanCreditCheckout(): Promise<BillingResult> {
  return billingRedirect("/api/create-checkout-session", { purchase: "scan" });
}

/**
 * The same scan credit at the member price, offered once to somebody who has
 * just declined the trial.
 *
 * Nothing about the eligibility travels in this request. The server reads the
 * decline stamp and the entitlement itself and answers 403 if either says no,
 * because a discount a client can ask for is a discount everybody gets.
 */
export function startDownsellCheckout(): Promise<BillingResult> {
  return billingRedirect("/api/create-checkout-session", { purchase: "downsell" });
}

// ---------------------------------------------------------------------------
// Voiced-analysis credits: $2.99 buys one narrated export. Same shape as the
// scan credit, except the SPEND is server-side in /api/tts (where the
// synthesis actually happens), so the client only reads and buys.
// ---------------------------------------------------------------------------

export async function loadVoiceCredits(): Promise<number> {
  const client = await getSupabaseClient();
  const { data, error } = await client
    .from("voice_credits")
    .select("balance")
    .maybeSingle<{ balance: number }>();
  if (error) throw new Error(error.message);
  return data?.balance ?? 0;
}

export function startVoiceCreditCheckout(): Promise<BillingResult> {
  return billingRedirect("/api/create-checkout-session", { purchase: "voice" });
}

// Returns the remaining balance, or -1 when there was nothing to spend. Fire
// and forget from the scan path — a consumption that fails to record is a free
// scan, which is the survivable direction of that error.
export interface ScanCreditUse {
  consumed: boolean;
  remaining: number;
}

/**
 * Spend at most one credit for a completed scan.
 *
 * The scan ID is the idempotency key: re-rendering or correcting the same scan
 * returns the existing use instead of charging it again.
 */
export async function consumeScanCreditForScan(scanId: string): Promise<ScanCreditUse> {
  const client = await getSupabaseClient();
  const { data, error } = await client.rpc("consume_scan_credit_for_scan", { p_scan_id: scanId });
  if (error) throw new Error(error.message);
  const row = data as { consumed?: unknown; remaining?: unknown } | null;
  return {
    consumed: row?.consumed === true,
    remaining: typeof row?.remaining === "number" ? row.remaining : -1,
  };
}
