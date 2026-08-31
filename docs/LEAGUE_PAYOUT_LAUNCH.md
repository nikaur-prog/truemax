# Creator League payout launch runbook

## Money flow

TrueMax funds Creator League bonuses from the platform Stripe balance. An
approved creator completes Stripe-hosted recipient onboarding. At sprint close,
Supabase freezes the latest eligible counts and computes an immutable payout
ledger. Staff reviews each row, approves it, and the server transfers the exact
stored amount to the creator's Stripe balance. Stripe then pays the creator's
bank under the creator's payout schedule.

The UI says "Sent to Stripe" when the transfer succeeds. It does not claim the
creator's bank has received the money.

## Required Stripe configuration

1. Activate Connect for the TrueMax Stripe account.
2. Confirm recipient accounts and Accounts v2 are enabled for the platform.
3. Confirm TrueMax can fund its platform balance in every payout currency it
   offers. New Zealand platform top-ups can require Stripe approval. Do not open
   a sprint whose pool cannot already be funded.
4. Set `LEAGUE_PAYOUT_COUNTRIES` to the comma-separated corridors Stripe has
   approved for this platform. It defaults to `NZ`; do not add a country just
   because Stripe operates there. Cross-border payouts require separate
   platform approval.
5. Use a restricted live key where possible. It needs Checkout, Billing,
   Customers, subscriptions and portal access for consumer billing, plus Connect
   account, Account Link, Transfer, Charge and Checkout Session read access for
   payout and reversal handling.
6. Keep `LEAGUE_PAYOUTS_ENABLED=false` in Production until the sandbox checklist
   below passes and the first live sprint pool is funded.
7. Add these events to the existing platform webhook endpoint:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `charge.refunded`
   - `charge.dispute.created`
   - `charge.dispute.closed`

Accounts v2 requirement status is refreshed at every creator visit and before
every transfer. A later cycle can add a separate Events v2 destination for
proactive reminders, but a webhook cache is never trusted to authorize money.

## Sandbox acceptance

1. Apply the payout migration before deploying the API and UI.
2. Deploy a Preview using a Stripe test or restricted test key and set
   `LEAGUE_PAYOUTS_ENABLED=true` only there.
3. Approve a test creator and complete Stripe-hosted onboarding using a test
   recipient account.
4. Create a short test sprint with a small USD pool. Submit at least three
   approved videos across three creators so rounding has to allocate a final
   cent.
5. Let the sprint end, close it from Admin, and confirm:
   - a linked creator's unrelated post cannot be approved or snapshotted;
   - `#truemaxgiveaway` does not satisfy the required `#truemax` tag;
   - removing the campaign tag after approval places the post on hold and
     stops new snapshots;
   - the hourly tracker runs once after the deadline, and closing refuses to
     settle until every earning post is watched and re-approved after that
     final caption check;
   - both official CTA variants and an explicitly reviewed custom CTA can be
     recorded, while a post with no CTA or no commercial-content disclosure is
     rejected;
   - count inserts after close are rejected, including service-role inserts;
   - the browser never sends an amount;
   - payout rows total no more than the pool;
   - repeated close returns the same rows;
   - two simultaneous transfer clicks create one Stripe Transfer;
   - an incomplete recipient cannot be paid;
   - successful rows say `transferred` and failed rows remain retryable;
   - creator account deletion is blocked while a payout is unsettled.
6. Buy and fully refund one scan credit, then open and win one test dispute.
   Confirm unused credit removal, consumed-credit debt, idempotent retries and
   restoration after a won dispute.
7. Rotate any broad or previously exposed test key after verification.

## Human approvals before live payouts

- A New Zealand accountant must confirm GST treatment, creator tax reporting,
  invoice requirements and whether withholding applies to any creator country.
- A lawyer must review the Creator League click-wrap terms, content licence,
  independent-creator wording and supported countries.
- Stripe must confirm the Connect account configuration and platform balance
  funding method for TrueMax's New Zealand account.
- The owner must fund the full published sprint pool before activation and make
  the explicit decision to set `LEAGUE_PAYOUTS_ENABLED=true` in Production.

## Operating a sprint

- Create a draft with the exact public rate, currency, pool, caps and dates.
- Publish the sprint hashtag and give creators both official CTA exports before
  the first post. Linking TikTok proves ownership only; it never proves CTA
  content.
- Fund the pool before activation.
- Do not promise a referral bounty until its own ledger and fraud policy exist.
- The tracker runs hourly. After the published end, let its final caption check
  complete, then open every earning post again. Record which official CTA
  variant is still visible, verify
  the campaign tag and the platform's commercial-content disclosure, then
  re-approve it. The API verifies TikTok ownership and caption text, while a
  human verifies the actual frames. Closing refuses to settle if that final
  review is missing. Approval never allows changing the amount.
- Close only after the final checks. Closing is the settlement event and cannot
  be edited from the browser.
- Resolve all rows by their due date. A failed transfer remains owed and should
  be retried after the creator fixes Stripe requirements.
