-- Stripe is the source of truth; this table is the small read model the app
-- needs. Browser clients may read only their own row and can never write it.
create table if not exists public.entitlements (
  user_id                  uuid primary key references auth.users(id) on delete cascade,
  tier                     text not null default 'free' check (tier in ('free', 'max')),
  status                   text not null default 'none',
  stripe_customer_id       text unique,
  stripe_subscription_id   text unique,
  stripe_price_id          text,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean not null default false,
  stripe_event_created_at  timestamptz not null default '-infinity',
  updated_at                timestamptz not null default now()
);

alter table public.entitlements enable row level security;

drop policy if exists "own entitlement - read" on public.entitlements;
create policy "own entitlement - read"
  on public.entitlements for select
  using (auth.uid() = user_id);

revoke all on public.entitlements from anon;
revoke insert, update, delete on public.entitlements from authenticated;
grant select on public.entitlements to authenticated;

-- Stripe retries deliveries and can deliver events out of order. Event IDs
-- make repeats idempotent; event timestamps prevent an older retry from
-- overwriting a newer subscription state.
create table if not exists public.stripe_webhook_events (
  event_id          text primary key,
  event_type        text not null,
  event_created_at  timestamptz not null,
  processed_at      timestamptz not null default now()
);

alter table public.stripe_webhook_events enable row level security;
revoke all on public.stripe_webhook_events from anon, authenticated;

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
set search_path = public
as $$
begin
  if p_tier not in ('free', 'max') then
    raise exception 'Invalid entitlement tier';
  end if;

  insert into public.stripe_webhook_events (event_id, event_type, event_created_at)
  values (p_event_id, p_event_type, p_event_created_at)
  on conflict (event_id) do nothing;

  if not found then
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
end;
$$;

revoke all on function public.apply_stripe_entitlement(
  text, text, timestamptz, uuid, text, text, text, text, text, timestamptz, boolean
) from public, anon, authenticated;
grant execute on function public.apply_stripe_entitlement(
  text, text, timestamptz, uuid, text, text, text, text, text, timestamptz, boolean
) to service_role;
