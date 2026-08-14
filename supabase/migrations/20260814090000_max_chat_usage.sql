-- How much Max has been asked in a day.
--
-- Every message to Max costs real money at the model provider, and the plan it
-- sits behind is $11.99 a month. Without a ceiling, one account holding an
-- all-day conversation outspends what it pays, and the failure mode is silent:
-- the bill arrives a month later. So the turn is claimed BEFORE the model is
-- called, atomically, and a claim that would cross the ceiling fails.
--
-- Counted per UTC day rather than per month. A monthly bucket lets somebody
-- spend the entire allowance on the first afternoon and then find Max dead for
-- four weeks, which reads as a broken product rather than a limit; a daily
-- bucket refills while the annoyance is still small.
--
-- The row holds a count and a date. No message text, no topic, no anything
-- about what was said: this table exists to protect a budget, and the moment it
-- stores conversation it becomes a record of what people asked about their own
-- faces, which is not a thing worth keeping.

create table if not exists public.max_chat_usage (
  user_id uuid primary key references auth.users (id) on delete cascade,
  day date not null default (now() at time zone 'utc')::date,
  messages integer not null default 0 check (messages >= 0),
  updated_at timestamptz not null default now()
);

alter table public.max_chat_usage enable row level security;

-- Owners may read their own counter, so the UI can say how many are left
-- before somebody types a message that will be refused. Nothing writes through
-- the API; the claim below is the only path.
drop policy if exists "read own max chat usage" on public.max_chat_usage;
create policy "read own max chat usage"
  on public.max_chat_usage for select
  using (auth.uid() = user_id);

-- Claim one turn for today.
--
-- Returns how many remain after the claim, or -1 when the ceiling was already
-- reached and nothing was claimed. Distinct values because "that was your last
-- one" and "you have none" are different sentences.
--
-- The stale-day reset is part of the same statement as the increment, so two
-- requests landing in the same millisecond cannot both read yesterday's row and
-- both reset it to one.
create or replace function public.claim_max_chat_turn(p_user_id uuid, p_limit integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'utc')::date;
  ceiling integer := greatest(1, p_limit);
  used integer;
begin
  insert into public.max_chat_usage (user_id, day, messages, updated_at)
  values (p_user_id, today, 1, now())
  on conflict (user_id) do update
    set messages = case when public.max_chat_usage.day = today
                        then public.max_chat_usage.messages + 1
                        else 1 end,
        day = today,
        updated_at = now()
    where public.max_chat_usage.day <> today
       or public.max_chat_usage.messages < ceiling
  returning messages into used;

  -- No row came back: the conflict target matched but the where clause refused
  -- the update, which happens only when today's count is already at the
  -- ceiling. Nothing was spent.
  if used is null then
    return -1;
  end if;
  return greatest(0, ceiling - used);
end;
$$;

revoke all on function public.claim_max_chat_turn(uuid, integer) from public, anon, authenticated;
