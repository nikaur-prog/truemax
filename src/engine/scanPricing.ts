// ---------------------------------------------------------------------------
// What one extra scan costs, and who is being told.
//
// The price appears on three surfaces (the weekly gate, the depth lock, and
// the plan lock) and it used to be typed into each of them as "$5.99, $2.99
// for members". That is wrong twice over. It is a price list rather than a
// price, so everybody reads a number that is not theirs and has to work out
// which one applies. And three copies of a number drift the moment one of
// them is edited.
//
// One place, one number, chosen by who is looking.
//
// These strings are display only. What anybody is actually charged is the
// Stripe price the checkout resolves from the environment, which is the only
// authority on money in this product. If these two disagree, Stripe is right
// and this file needs editing.
// ---------------------------------------------------------------------------

// These two must match the Stripe prices the checkout resolves, and the pair
// is chosen rather than arbitrary: $2.99 is half of $5.99, so "members pay
// half" is literally true, and two extra scans ($11.98) cost the same as a
// month of Max ($11.99), which is an argument the product can make in one
// line without inventing anything.
export const SCAN_PRICE_STANDARD = "$5.99";
export const SCAN_PRICE_MEMBER = "$2.99";

// Whether this account holds a live subscription of any tier. Defaults to
// false so an unread entitlement quotes the standard price: quoting the
// member price to somebody who is not a member and then charging them more is
// the one direction of this error that is a broken promise.
let member = false;

export function setMemberPricing(value: boolean): void {
  member = value;
}

export function isMemberPricing(): boolean {
  return member;
}

// The price this person pays for one extra scan.
export function scanPrice(): string {
  return member ? SCAN_PRICE_MEMBER : SCAN_PRICE_STANDARD;
}
