import type Stripe from "stripe";

export type CapabilityStatus = "unknown" | "active" | "pending" | "restricted" | "unsupported";

export interface LeaguePayoutAccountState {
  transfersStatus: CapabilityStatus;
  payoutsStatus: CapabilityStatus;
  requirementsDue: number;
  ready: boolean;
}

const CAPABILITY_STATUSES = new Set<CapabilityStatus>([
  "active",
  "pending",
  "restricted",
  "unsupported",
]);

function capabilityStatus(value: unknown): CapabilityStatus {
  return typeof value === "string" && CAPABILITY_STATUSES.has(value as CapabilityStatus)
    ? value as CapabilityStatus
    : "unknown";
}

export function leaguePayoutAccountState(account: Stripe.V2.Core.Account): LeaguePayoutAccountState {
  const balance = account.configuration?.recipient?.capabilities?.stripe_balance;
  const transfersStatus = capabilityStatus(balance?.stripe_transfers?.status);
  const payoutsStatus = capabilityStatus(balance?.payouts?.status);
  const requirementsDue = account.requirements?.entries?.length ?? 0;
  return {
    transfersStatus,
    payoutsStatus,
    requirementsDue,
    ready: transfersStatus === "active" && payoutsStatus === "active" && requirementsDue === 0,
  };
}

export function stripeLivemode(
  secret = process.env.STRIPE_SECRET_KEY ?? "",
): boolean {
  return secret.startsWith("sk_live_") || secret.startsWith("rk_live_");
}

export function validCountry(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{2}$/.test(value);
}

/** Connect corridors are a Stripe-account approval, not something a creator
 * can opt the platform into. Default to the platform's home market and expand
 * this allowlist only after Stripe enables the corresponding countries.
 */
export function allowedPayoutCountries(
  configured = process.env.LEAGUE_PAYOUT_COUNTRIES ?? "NZ",
): ReadonlySet<string> {
  return new Set(configured.split(",").map((country) => country.trim().toUpperCase()).filter(validCountry));
}

export function payoutCountryAllowed(value: unknown, configured?: string): value is string {
  return validCountry(value) && allowedPayoutCountries(configured).has(value);
}

export function validEntityType(value: unknown): value is "individual" | "company" | "non_profit" {
  return value === "individual" || value === "company" || value === "non_profit";
}
