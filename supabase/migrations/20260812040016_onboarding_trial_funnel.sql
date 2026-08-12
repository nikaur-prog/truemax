-- The post-analysis funnel needs two different trust boundaries:
--
-- 1. A person may read and update only their own onboarding profile.
-- 2. Trial eligibility is billing state. Browser clients can never read or
--    write it; only the service-role Checkout route and Stripe webhook can.

create table if not exists public.profiles (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  first_name           text not null check (char_length(first_name) between 1 and 60),
  last_name            text not null check (char_length(last_name) between 1 and 60),
  mobile               text check (mobile is null or char_length(mobile) between 5 and 32),
  date_of_birth        date not null check (date_of_birth between date '1900-01-01' and current_date),
  discovery_source     text not null check (discovery_source in (
    'tiktok', 'instagram', 'youtube', 'search', 'friend', 'other'
  )),
  primary_objectives   text[] not null check (
    cardinality(primary_objectives) between 1 and 8
  ),
  success_outcome      text not null check (char_length(success_outcome) between 1 and 500),
  expectations         text not null check (char_length(expectations) between 1 and 500),
  strengths            text check (strengths is null or char_length(strengths) <= 500),
  support_areas        text check (support_areas is null or char_length(support_areas) <= 500),
  quiet_topics         text[] not null default '{}',
  consent_version      text not null default 'onboarding-v1',
  completed_at         timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "own profile - read" on public.profiles;
create policy "own profile - read"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "own profile - insert" on public.profiles;
create policy "own profile - insert"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "own profile - update" on public.profiles;
create policy "own profile - update"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.profiles from anon;
revoke delete on public.profiles from authenticated;
grant select, insert, update on public.profiles to authenticated;

-- Date of birth is self-attested at onboarding, but it cannot become a slider
-- for repeatedly changing plan eligibility. A correction goes through support
-- (service role); ordinary profile edits leave the original value untouched.
create or replace function public.protect_profile_birth_date()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.date_of_birth is distinct from old.date_of_birth
    and (select auth.role()) = 'authenticated' then
    raise exception 'Date of birth cannot be changed after onboarding';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_birth_date on public.profiles;
create trigger protect_profile_birth_date
  before update of date_of_birth on public.profiles
  for each row execute function public.protect_profile_birth_date();

revoke all on function public.protect_profile_birth_date() from public, anon, authenticated;

create table if not exists public.trial_redemptions (
  user_id                 uuid primary key references auth.users(id) on delete cascade,
  tier                    text not null check (tier in ('starter', 'max')),
  status                  text not null check (status in ('reserved', 'redeemed')),
  reservation_id          uuid not null unique,
  checkout_session_id     text unique,
  stripe_subscription_id  text unique,
  reserved_until          timestamptz not null,
  redeemed_at             timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

alter table public.trial_redemptions enable row level security;
revoke all on public.trial_redemptions from anon, authenticated;

-- A single atomic insert/update is the trial lock. A second tab or device
-- cannot race two Checkout Sessions into existence for the same account.
create or replace function public.reserve_trial_checkout(
  p_user_id uuid,
  p_tier text,
  p_reservation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_tier not in ('starter', 'max') then
    raise exception 'Invalid trial tier';
  end if;

  insert into public.trial_redemptions (
    user_id, tier, status, reservation_id, reserved_until
  ) values (
    p_user_id, p_tier, 'reserved', p_reservation_id, now() + interval '32 minutes'
  )
  on conflict (user_id) do update set
    tier = excluded.tier,
    status = 'reserved',
    reservation_id = excluded.reservation_id,
    checkout_session_id = null,
    stripe_subscription_id = null,
    reserved_until = excluded.reserved_until,
    redeemed_at = null,
    updated_at = now()
  where public.trial_redemptions.status = 'reserved'
    and public.trial_redemptions.reserved_until < now()
    and public.trial_redemptions.checkout_session_id is null;

  return found;
end;
$$;

revoke all on function public.reserve_trial_checkout(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_trial_checkout(uuid, text, uuid)
  to service_role;

-- Starter is a paid entitlement too. Replace both the table constraint and
-- the webhook RPC's validation without weakening browser write protection.
alter table public.entitlements
  drop constraint if exists entitlements_tier_check;
alter table public.entitlements
  add constraint entitlements_tier_check check (tier in ('free', 'starter', 'max'));

create or replace function public.apply_stripe_entitlement(
  p_event_id text,
  p_event_type text,
  p_event_created_at timestamptz,
  p_user_id uuid,
  p_tier text,
  p_status text,
  p_customer_id text,
  p_subscription_id text,
  p_price_id text,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_tier not in ('free', 'starter', 'max') then
    raise exception 'Invalid entitlement tier';
  end if;

  insert into public.stripe_webhook_events (event_id, event_type, event_created_at)
  values (p_event_id, p_event_type, p_event_created_at)
  on conflict (event_id) do nothing;

  if not found then
    return;
  end if;

  -- A subscription cancellation can arrive after an account-deletion request.
  -- Record and acknowledge that signed event, but never recreate billing state
  -- for an identity that no longer exists.
  if not exists (select 1 from auth.users where id = p_user_id) then
    return;
  end if;

  insert into public.entitlements (
    user_id,
    tier,
    status,
    stripe_customer_id,
    stripe_subscription_id,
    stripe_price_id,
    current_period_end,
    cancel_at_period_end,
    stripe_event_created_at,
    updated_at
  ) values (
    p_user_id,
    p_tier,
    p_status,
    p_customer_id,
    p_subscription_id,
    p_price_id,
    p_current_period_end,
    p_cancel_at_period_end,
    p_event_created_at,
    now()
  )
  on conflict (user_id) do update set
    tier = excluded.tier,
    status = excluded.status,
    stripe_customer_id = excluded.stripe_customer_id,
    stripe_subscription_id = excluded.stripe_subscription_id,
    stripe_price_id = excluded.stripe_price_id,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    stripe_event_created_at = excluded.stripe_event_created_at,
    updated_at = now()
  where public.entitlements.stripe_event_created_at <= excluded.stripe_event_created_at;

  if p_tier in ('starter', 'max') and p_status in ('trialing', 'active') then
    update public.trial_redemptions set
      status = 'redeemed',
      stripe_subscription_id = p_subscription_id,
      redeemed_at = coalesce(redeemed_at, now()),
      updated_at = now()
    where user_id = p_user_id;
  end if;
end;
$$;

revoke all on function public.apply_stripe_entitlement(
  text, text, timestamptz, uuid, text, text, text, text, text, timestamptz, boolean
) from public, anon, authenticated;
grant execute on function public.apply_stripe_entitlement(
  text, text, timestamptz, uuid, text, text, text, text, text, timestamptz, boolean
) to service_role;
