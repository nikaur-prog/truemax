-- The downsell was meant to be an exit offer and was actually a standing
-- discount.
--
-- It sells the ordinary single scan credit at the member price to somebody who
-- has just declined the trial. The eligibility test was "has declined and is
-- not a member", and both of those stay true forever, so a declined account
-- could open that checkout again and again and buy every future scan at the
-- member price instead of the standard one. The client sends a fresh
-- idempotency key per call, so nothing deduplicated it either. That is not an
-- exit offer, it is a permanent half-price tier for anyone who presses "No
-- thanks" once.
--
-- One stamp, written by the webhook when a downsell payment actually
-- completes, and read by the checkout endpoint before it will quote the price
-- again. Deliberately recorded at FULFILMENT rather than at session creation:
-- opening a checkout and closing it is not a purchase, and burning the offer
-- on an abandoned session would take it away from somebody who never got it.
--
-- Column on profiles rather than a table of its own. Unlike trial_declined_at
-- it is not a consequence a user could undo by writing to their own row: it
-- takes something away rather than granting it, so the worst a client-side
-- write could do is deny itself the offer. It is revoked from the browser
-- roles anyway, for the same reason every other billing fact is.

alter table public.profiles
  add column if not exists downsell_redeemed_at timestamptz;

revoke update (downsell_redeemed_at) on public.profiles from authenticated;
revoke update (downsell_redeemed_at) on public.profiles from anon;
revoke insert (downsell_redeemed_at) on public.profiles from authenticated;
revoke insert (downsell_redeemed_at) on public.profiles from anon;
