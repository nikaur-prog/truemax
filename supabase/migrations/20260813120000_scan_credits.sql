-- One-time scan credits.
--
-- A credit is one full-depth scan for an account that is past its free
-- allowance and does not want a subscription. Two prices for the same thing —
-- members pay less — but one balance: a credit is a credit regardless of what
-- was paid for it, because entitlement complexity is where billing bugs live.
--
-- Balance lives server-side and moves only through the two functions below,
-- both SECURITY DEFINER: the webhook grants after Stripe confirms payment, and
-- the client may only ever spend downward. No path lets a browser write a
-- number of its choosing.

create table if not exists public.scan_credits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

alter table public.scan_credits enable row level security;

-- Owners read their own balance; nobody inserts or updates through the API.
drop policy if exists "read own scan credits" on public.scan_credits;
create policy "read own scan credits"
  on public.scan_credits for select
  using (auth.uid() = user_id);

-- Called by the webhook (service role) after checkout.session.completed.
create or replace function public.grant_scan_credit(p_user_id uuid, p_credits integer default 1)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.scan_credits (user_id, balance, updated_at)
  values (p_user_id, greatest(1, p_credits), now())
  on conflict (user_id)
  do update set balance = scan_credits.balance + greatest(1, p_credits), updated_at = now();
$$;

-- Called by the signed-in client when a paid scan is actually consumed.
-- Returns the remaining balance, or -1 when there was nothing to spend —
-- distinct values, because "you have zero left" and "you never had one"
-- produce different sentences in the UI.
create or replace function public.consume_scan_credit()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining integer;
begin
  update public.scan_credits
    set balance = balance - 1, updated_at = now()
    where user_id = auth.uid() and balance > 0
    returning balance into remaining;
  if remaining is null then
    return -1;
  end if;
  return remaining;
end;
$$;

revoke all on function public.grant_scan_credit(uuid, integer) from public, anon, authenticated;
grant execute on function public.consume_scan_credit() to authenticated;
