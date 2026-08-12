# TrueMax pricing and billing decisions

Last updated: 12 August 2026 (Pacific/Auckland)

## Confirmed

All web prices are in **USD**.

| Offer | Price | Billing | Who can buy it |
| --- | ---: | --- | --- |
| Starter | **$6.99** | Monthly subscription | Adults and under-18 users |
| Max | **$11.99** | Monthly subscription | Adults only |
| Member extra scan | **$2.99** | One-time | Active paid members |
| Non-member extra scan | **$5.99** | One-time | Signed-in free users |

The acquisition flow is also confirmed:

1. `/` opens directly on the face scan, not an account wall.
2. After capture, signup is required before the first analysis is revealed.
3. Each verified account gets one initial analysis without starting a Stripe
   subscription.
4. After that analysis, **Next** opens the animated Starter/Max offer.
5. A trial adds one more scan. After that allowance is used, further scans
   follow the paid-member or non-member rules above.
6. Active paid members receive one included scan per week.
7. Max includes the Max AI experience. The complete Starter/Max feature split
   still needs to be written before feature gates are implemented.

Under-18 users see Max as a visible but locked option with a plain explanation.
The server, not CSS or browser metadata, must enforce that restriction.

## Trial decision

The current web MVP uses a **7-day free trial**, with a payment method collected
in Stripe Checkout, one additional scan, and one trial per account. The initial
analysis provides proof of value before the offer. The renewal price and the
plain “cancel before the trial ends and pay $0” explanation appear both in the
TrueMax offer and secure Checkout.

The earlier one-month wording is superseded. Native introductory offers must
use the same seven-day term when Apple and Google billing are implemented.

## Decisions needed before the credit ledger is final

- Does the weekly scan replenish every seven days from subscription start, or
  on a fixed weekday?
- Do unused weekly scans expire or roll over? Recommended: expire when the next
  weekly allowance arrives.
- Does the $2.99 member price apply during a free trial? Recommended: no; make
  it available only after the first successful paid invoice.
- What exactly is included in Starter versus Max, beyond Max AI?

These affect entitlements and must not be inferred from display copy.
