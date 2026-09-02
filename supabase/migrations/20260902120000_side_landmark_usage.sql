-- How many cloud placements an account has asked for in a day.
--
-- The vision pass that places the side points costs money at the model
-- provider on every side scan, free scans included. The same shape as
-- max_chat_usage: a count and a date per account, claimed atomically before
-- the model is called, released if the call produced nothing. No photograph,
-- no coordinates, nothing about the face: this table protects a budget and
-- that is all it is allowed to know.

create table if not exists public.side_landmark_usage (
  user_id uuid primary key references auth.users (id) on delete cascade,
  day date not null default (now() at time zone 'utc')::date,
  passes integer not null default 0 check (passes >= 0),
  updated_at timestamptz not null default now()
);

alter table public.side_landmark_usage enable row level security;

drop policy if exists "read own side landmark usage" on public.side_landmark_usage;
create policy "read own side landmark usage"
  on public.side_landmark_usage for select
  using (auth.uid() = user_id);

-- Claim one pass for today. Returns how many remain after the claim, or -1
-- when the ceiling was already reached and nothing was claimed. The stale-day
-- reset is part of the same statement as the increment.
create or replace function public.claim_side_landmark_pass(p_user_id uuid, p_limit integer)
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
  insert into public.side_landmark_usage (user_id, day, passes, updated_at)
  values (p_user_id, today, 1, now())
  on conflict (user_id) do update
    set passes = case when public.side_landmark_usage.day = today
                      then public.side_landmark_usage.passes + 1
                      else 1 end,
        day = today,
        updated_at = now()
    where public.side_landmark_usage.day <> today
       or public.side_landmark_usage.passes < ceiling
  returning passes into used;

  if used is null then
    return -1;
  end if;
  return greatest(0, ceiling - used);
end;
$$;

-- Give a claimed pass back when the model call failed. Only today's row and
-- only down to zero: a release can never manufacture allowance.
create or replace function public.release_side_landmark_pass(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'utc')::date;
begin
  update public.side_landmark_usage
    set passes = greatest(0, passes - 1),
        updated_at = now()
    where user_id = p_user_id
      and day = today
      and passes > 0;
end;
$$;

revoke all on function public.claim_side_landmark_pass(uuid, integer) from public, anon, authenticated;
revoke all on function public.release_side_landmark_pass(uuid) from public, anon, authenticated;
