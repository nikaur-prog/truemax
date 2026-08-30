-- Extend the already-applied downsell claim instead of replacing its state.
--
-- 20260830100000_downsell_claim.sql introduced downsell_claimed_at and the
-- service-side claim_downsell(uuid) call. A timestamp is enough to serialize
-- Checkout creation, but it cannot bind fulfilment or release to the exact
-- Session that owns the claim. It also expires while an asynchronous payment
-- can still be pending. This adds an opaque claim id and Session link so:
--
--   * two callers still cannot reserve the offer concurrently;
--   * a linked claim is released only by its own failed/expired Session;
--   * credit grant and permanent redemption happen in one transaction; and
--   * an asynchronous payment cannot make the offer available again merely
--     because thirty-five minutes elapsed.
--
-- The legacy function remains for the currently deployed endpoint. New code
-- uses reserve/link/release/redeem below. A legacy, unlinked timestamp retains
-- its original thirty-five-minute expiry during the rolling deployment.

alter table public.profiles
  add column if not exists downsell_claim_id uuid,
  add column if not exists downsell_checkout_session_id text;

revoke update (downsell_claim_id, downsell_checkout_session_id)
  on public.profiles from authenticated, anon;
revoke insert (downsell_claim_id, downsell_checkout_session_id)
  on public.profiles from authenticated, anon;

create unique index if not exists profiles_downsell_claim_id_unique
  on public.profiles (downsell_claim_id)
  where downsell_claim_id is not null;

create unique index if not exists profiles_downsell_checkout_session_unique
  on public.profiles (downsell_checkout_session_id)
  where downsell_checkout_session_id is not null;

-- Rolling-deploy compatibility for the old endpoint. A claim linked by the
-- new endpoint never expires by time alone; only its exact Stripe Session may
-- release it. Old claims have no link and keep the original expiry behaviour.
create or replace function public.claim_downsell(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed integer;
begin
  update public.profiles
     set downsell_claimed_at = now(),
         downsell_claim_id = null,
         downsell_checkout_session_id = null
   where user_id = p_user_id
     and trial_declined_at is not null
     and downsell_redeemed_at is null
     and downsell_checkout_session_id is null
     and (
       downsell_claimed_at is null
       or downsell_claimed_at < now() - interval '35 minutes'
     );
  get diagnostics claimed = row_count;
  return claimed = 1;
end;
$$;

revoke all on function public.claim_downsell(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_downsell(uuid)
  to service_role;

create or replace function public.reserve_downsell_checkout(
  p_user_id uuid,
  p_claim_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed integer;
begin
  if p_user_id is null or p_claim_id is null then
    raise exception 'Invalid downsell claim' using errcode = '22023';
  end if;

  -- One conditional UPDATE is both the eligibility test and the row lock.
  -- Concurrent callers serialize on this profile and only the first matches.
  update public.profiles as profile
     set downsell_claimed_at = now(),
         downsell_claim_id = p_claim_id,
         downsell_checkout_session_id = null
   where profile.user_id = p_user_id
     and profile.trial_declined_at is not null
     and profile.downsell_redeemed_at is null
     and not exists (
       select 1
         from public.entitlements as entitlement
        where entitlement.user_id = p_user_id
          and entitlement.tier <> 'free'
          and entitlement.status in ('active', 'trialing')
     )
     and (
       profile.downsell_claimed_at is null
       or (
         profile.downsell_checkout_session_id is null
         and profile.downsell_claimed_at < now() - interval '35 minutes'
       )
     );
  get diagnostics claimed = row_count;
  return claimed = 1;
end;
$$;

revoke all on function public.reserve_downsell_checkout(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_downsell_checkout(uuid, uuid)
  to service_role;

create or replace function public.link_downsell_checkout(
  p_user_id uuid,
  p_claim_id uuid,
  p_checkout_session_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_checkout_session_id is null or btrim(p_checkout_session_id) = '' then
    raise exception 'Invalid Checkout Session' using errcode = '22023';
  end if;

  update public.profiles
     set downsell_checkout_session_id = p_checkout_session_id
   where user_id = p_user_id
     and downsell_claim_id = p_claim_id
     and downsell_redeemed_at is null
     and downsell_checkout_session_id is null;
  return found;
end;
$$;

revoke all on function public.link_downsell_checkout(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.link_downsell_checkout(uuid, uuid, text)
  to service_role;

create or replace function public.release_downsell_checkout(
  p_user_id uuid,
  p_claim_id uuid,
  p_checkout_session_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set downsell_claimed_at = null,
         downsell_claim_id = null,
         downsell_checkout_session_id = null
   where user_id = p_user_id
     and downsell_claim_id = p_claim_id
     and downsell_redeemed_at is null
     and (
       (p_checkout_session_id is null and downsell_checkout_session_id is null)
       or downsell_checkout_session_id = p_checkout_session_id
     );
  return found;
end;
$$;

revoke all on function public.release_downsell_checkout(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.release_downsell_checkout(uuid, uuid, text)
  to service_role;

create or replace function public.redeem_downsell_credit(
  p_event_id text,
  p_checkout_session_id text,
  p_user_id uuid,
  p_claim_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile public.profiles%rowtype;
  granted boolean;
begin
  select * into profile
    from public.profiles
   where user_id = p_user_id
   for update;

  if not found
     -- Ordinary <> is null-unsafe: NULL <> value evaluates to NULL, and a
     -- PL/pgSQL IF treats that as false. IS DISTINCT FROM makes a missing
     -- claim or Session an explicit mismatch instead of a path to a credit.
     or profile.downsell_claim_id is distinct from p_claim_id
     or profile.downsell_checkout_session_id is distinct from p_checkout_session_id then
    raise exception 'Downsell claim does not match payment' using errcode = '22023';
  end if;

  if profile.downsell_redeemed_at is not null then
    return false;
  end if;

  select public.apply_one_time_credit(
    p_event_id,
    p_checkout_session_id,
    p_user_id,
    'scan',
    1
  ) into granted;

  if not granted then
    -- A webhook and the browser return deliberately use different event ids,
    -- but billing_credit_events also makes the Checkout Session unique. A
    -- false grant is idempotent only when this exact paid Session already gave
    -- this exact user's scan; every other conflict remains an error.
    if not exists (
      select 1
        from public.billing_credit_events as event
       where event.checkout_session_id = p_checkout_session_id
         and event.user_id = p_user_id
         and event.credit_kind = 'scan'
         and event.credits = 1
    ) then
      raise exception 'Downsell credit conflicts with an existing grant';
    end if;
  end if;

  update public.profiles
     set downsell_redeemed_at = now()
   where user_id = p_user_id;

  return true;
end;
$$;

revoke all on function public.redeem_downsell_credit(text, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.redeem_downsell_credit(text, text, uuid, uuid)
  to service_role;
