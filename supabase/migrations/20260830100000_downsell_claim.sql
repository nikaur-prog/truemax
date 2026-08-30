-- A timestamp checked before Checkout creation is not a one-time offer.
--
-- 20260830090000 added downsell_redeemed_at, stamped by the webhook when a
-- payment completed and read by the endpoint before it would quote the price.
-- Read-then-act, with a network round trip and a human paying in between, is
-- a race and it reproduces trivially:
--
--   two concurrent requests, both read null, both get a discounted session,
--   both are paid, both grant a credit, and the second webhook stamp updates
--   no row and reports success.
--
-- Two discounted purchases against a promise of one.
--
-- The fix is to CLAIM the offer when the session is created rather than to
-- check a flag, so the exclusion is decided by the database in one statement
-- instead of by two clients agreeing to be polite. A claim is not a
-- redemption, so it has to expire: somebody who opens a checkout and closes
-- it must get the offer back, and the Stripe session itself already dies
-- after 31 minutes.
--
--   claimed_at   set the moment a Checkout Session is created. Expires.
--   redeemed_at  set by the webhook when money actually moved. Permanent.
--
-- A row with a live claim or any redemption is refused. The claim window is
-- 35 minutes, a little longer than the session it guards, so the offer can
-- never come back while a payable session for it is still alive.

alter table public.profiles
  add column if not exists downsell_claimed_at timestamptz;

revoke update (downsell_claimed_at) on public.profiles from authenticated;
revoke update (downsell_claimed_at) on public.profiles from anon;
revoke insert (downsell_claimed_at) on public.profiles from authenticated;
revoke insert (downsell_claimed_at) on public.profiles from anon;

-- The claim, as one statement.
--
-- SECURITY DEFINER because it is called with the service key from the
-- checkout endpoint and must not be reachable from a browser at all: the
-- grant below is to no browser role, and there is no policy path to it.
--
-- Returns true only if THIS call took the offer. The where clause is the
-- whole mechanism: two concurrent callers both run the update, Postgres
-- serialises them on the row, and the second finds a claim already sitting
-- there and matches nothing.
create or replace function public.claim_downsell(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed integer;
begin
  update public.profiles
     set downsell_claimed_at = now()
   where user_id = p_user_id
     -- Declined, which is what the offer is for.
     and trial_declined_at is not null
     -- Never redeemed. This one is permanent.
     and downsell_redeemed_at is null
     -- And no live claim. An abandoned checkout releases the offer after the
     -- session it belongs to has expired.
     and (downsell_claimed_at is null or downsell_claimed_at < now() - interval '35 minutes');
  get diagnostics v_claimed = row_count;
  return v_claimed = 1;
end;
$$;

revoke all on function public.claim_downsell(uuid) from public, anon, authenticated;
