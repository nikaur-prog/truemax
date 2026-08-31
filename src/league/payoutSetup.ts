export type PayoutSetupAudience = "creator" | "staff";

/** Staff can open the League without applying to their own programme. That
 * synthetic dashboard identity must not call creator-only payout APIs. */
export function payoutSetupAudience(syntheticStaff: boolean): PayoutSetupAudience {
  return syntheticStaff ? "staff" : "creator";
}

export function staffPayoutSetupHTML(): string {
  return `<div class="lg-card"><h3>Stripe payout accounts</h3>
    <p class="lg-sub">Approved creators set up their own Stripe account here. Use Admin to review
    settlements and send approved transfers.</p></div>`;
}
