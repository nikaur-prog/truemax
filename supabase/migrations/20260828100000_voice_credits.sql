-- Voiced analysis becomes a purchase: $2.99 buys one voiced export.
--
-- Mirrors scan_credits' hardened shape exactly (20260819192625): the owner
-- reads their own balance through RLS, only the Stripe webhook's service
-- role can grant, and spending happens server-side in /api/tts through an
-- atomic decrement that only the service role can call - the credit is spent
-- the moment audio actually comes back, never before.

create table if not exists public.voice_credits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.voice_credits enable row level security;
revoke all on table public.voice_credits from public, anon, authenticated;
grant select on table public.voice_credits to authenticated;

drop policy if exists "read own voice credits" on public.voice_credits;
create policy "read own voice credits"
  on public.voice_credits
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Grant: webhook only. Empty search path so nothing in a writable schema can
-- shadow references inside a SECURITY DEFINER function.
create or replace function public.grant_voice_credit(p_user_id uuid, p_credits integer default 1)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.voice_credits as credits (user_id, balance, updated_at)
  values (p_user_id, greatest(1, p_credits), now())
  on conflict (user_id)
  do update
    set balance = credits.balance + greatest(1, p_credits),
        updated_at = now();
$$;

revoke all on function public.grant_voice_credit(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.grant_voice_credit(uuid, integer)
  to service_role;

-- Spend: the server, for the named user, after a successful render. Not
-- callable by authenticated users - the client never spends, it only asks
-- /api/tts, which is where the render actually happens. Returns the balance
-- after the spend, or -1 when there was nothing to spend.
create or replace function public.spend_voice_credit(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  remaining integer;
begin
  update public.voice_credits
    set balance = balance - 1,
        updated_at = now()
    where user_id = p_user_id and balance > 0
    returning balance into remaining;

  if remaining is null then
    return -1;
  end if;
  return remaining;
end;
$$;

revoke all on function public.spend_voice_credit(uuid)
  from public, anon, authenticated;
grant execute on function public.spend_voice_credit(uuid)
  to service_role;
