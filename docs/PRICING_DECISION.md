# TrueMax pricing and billing decisions

Last updated: 25 August 2026 (Pacific/Auckland)

## Confirmed

All web prices are in **USD**.

| Offer | Price | Billing | Who can buy it |
| --- | ---: | --- | --- |
| Starter | **$7.99** | Monthly subscription | Adults and under-18 users |
| Max | **$11.99** | Monthly subscription | Adults only |
| Max (yearly) | **$89.99** | Annual subscription | Adults only |
| Member extra scan | **$2.99** | One-time | Active paid members |
| Non-member extra scan | **$5.99** | One-time | Signed-in free users |

### Starter moved from $6.99 to $7.99 (25 August 2026)

Three reasons, all pointing the same way:

1. **It makes Max easier to sell.** $6.99 → $11.99 is a 72% jump; $7.99 →
   $11.99 is 50%. The narrower the relative gap, the more the better plan
   reads as a rounding error rather than a decision — which is the mechanic
   the whole Starter/Max ladder, and the Max tab's upgrade sheet, rely on.
2. **There is headroom.** The category leader charges $3.99 a week, about
   $207 a year. Starter at $7.99/month is $95.88 a year — still under half,
   which is the comparison the offer copy already makes.
3. **Nothing is grandfathered yet.** No live subscriptions exist, so this
   costs one Stripe change today and goodwill after launch. It is the
   cheapest moment this decision will ever be.

The app already displayed $7.99 (`STARTER_MONTHLY` in `ui/onboardingFunnel.ts`)
while Stripe still held a $6.99 price, so this ratifies the number a customer
could already see and closes the gap in the direction that does not require
telling anybody their price went up.

### Yearly: Max only, deliberately

There is no annual Starter and should not be one until churn data asks for it.
A prepaid year of the entry tier locks somebody out of the Max upsell for
twelve months, and an annual discount converts high-intent buyers rather than
the people choosing the cheapest option. Revisit only if month 2–3 retention
shows Starter is where subscriptions leak.

### Where the price actually lives

Three places have to agree, and they have disagreed before:

- **Stripe** — the only one that charges anybody. The price attached to the
  TrueMax Starter product, and the price ID in `STRIPE_STARTER_PRICE_ID`.
- **`ui/onboardingFunnel.ts`** — `MAX_MONTHLY`, `MAX_ANNUAL`,
  `STARTER_MONTHLY`. What the plan cards display.
- **This table** — what was decided.

`/api/stripe-config?key=CRON_SECRET` reports what Stripe actually holds for
every configured price, which is how a drift like the $6.99/$7.99 one is
caught without waiting for a customer to find it. Nothing in the client
computes a price DIFFERENCE from these constants: the upgrade sheet quotes the
Max price and lets Stripe show the prorated amount, because a subtraction of
two hardcoded numbers is a claim this app cannot verify.

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

## Weekly allowance (decided 25 August 2026)

The gate holds a ROLLING seven-day window per account: free and Starter may
hold one completed scan inside the trailing week, Max two — which is what the
Max plan card sold until 30 August 2026 ("Two scans a week"); the gate simply
never honoured it until now. A slot frees exactly a week after the scan
holding it, so there is no fixed weekday and no replenish moment. Rollover
ceases to be a question: an unused slot is a window with room in it — nothing
banks, nothing expires. The arithmetic lives in `src/engine/scanAllowance.ts`
and is test-pinned to the plan-card wording.

## Decisions needed before the credit ledger is final
- Does the $2.99 member price apply during a free trial? Recommended: no; make
  it available only after the first successful paid invoice.
- What exactly is included in Starter versus Max, beyond Max AI?

These affect entitlements and must not be inferred from display copy.


## Update, 30 August 2026: one personal scan on every tier

Max no longer gets two personal scans a week. The reason is the weekly
ceremony rather than cost: a second personal scan inside the same window sits
inside the noise the first one already carries, so it cannot show progress,
only weather.

The tiers differ on OTHER people's faces instead, which is the axis Max is
actually sold on and the one where "unlimited" was quietly giving Starter and
Max the same product. Starter gets three guest scans a week, Max fifty, free
none — except a free account that declined the trial, which keeps one, because
its own weekly scan is now a guest scan.

No grandfather clause, because no subscription was ever sold at the two-scan
promise.
