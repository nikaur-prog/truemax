export type MembershipBrand = "guest" | "member" | "max";

// The visual state is deliberately derived from two trusted facts only: an
// authenticated session and the server-stamped entitlement. User metadata is
// editable by the user and must never be allowed to paint a paid state.
export function membershipBrand(signedIn: boolean, maxAccess: boolean): MembershipBrand {
  if (!signedIn) return "guest";
  return maxAccess ? "max" : "member";
}

export function brandClass(brand: MembershipBrand): string {
  return `brand-${brand}`;
}

export function logoMarkup(): string {
  return "TRUE<b>MAX</b>";
}

export const MEMBERSHIP_BRAND_EVENT = "truemax:membership-brand";

export function announceMembershipBrand(brand: Exclude<MembershipBrand, "guest">): void {
  window.dispatchEvent(new CustomEvent(MEMBERSHIP_BRAND_EVENT, { detail: { brand } }));
}
