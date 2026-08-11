import { currentAccessToken, getSupabaseClient } from "./auth.ts";

export type EntitlementTier = "free" | "max";

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

async function billingRedirect(path: string): Promise<BillingResult> {
  const accessToken = await currentAccessToken();
  if (!accessToken) return { ok: false, message: "Sign in before opening billing." };

  try {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Idempotency-Key": crypto.randomUUID(),
      },
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

export function startMaxCheckout(): Promise<BillingResult> {
  return billingRedirect("/api/create-checkout-session");
}

export function openBillingPortal(): Promise<BillingResult> {
  return billingRedirect("/api/create-portal-session");
}

export type CheckoutResult = "success" | "cancelled";

export function consumeCheckoutResult(): CheckoutResult | null {
  const url = new URL(location.href);
  const value = url.searchParams.get("checkout");
  if (value !== "success" && value !== "cancelled") return null;
  url.searchParams.delete("checkout");
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  return value;
}
