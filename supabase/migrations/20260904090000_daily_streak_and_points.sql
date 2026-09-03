-- The daily streak and the two points ledgers.
--
-- A day is counted by an action (a routine ticked, a check-in answered, a
-- scan taken), never by a visit. The count, the best run and the banked
-- grace live here so they survive a device, and the points live here so
-- they cannot be typed into a browser console. Browser roles read their
-- own rows and write nothing; every change goes through the service role
-- and the functions below. See docs/DAILY_STREAK_AND_FUNNEL_PLAN.md.

-- ---------------------------------------------------------------------------
-- The streak. One row per person.
-- ---------------------------------------------------------------------------

create table if not exists public.daily_streaks (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  current          integer not null default 0 check (current >= 0),
  best             integer not null default 0 check (best >= 0),
  last_counted_day date,
  grace_banked     integer not null default 0 check (grace_banked between 0 and 2),
  -- The Settings switch. Off hides the light and the points; the record
  -- keeps counting so turning it back on shows the true run.
  enabled          boolean not null default true,
  updated_at       timestamptz not null default now()
);

comment on table public.daily_streaks is
  'Consecutive counted days, the best run, and banked grace. Counted by actions, never visits. Service-written, owner-readable.';

alter table public.daily_streaks enable row level security;

drop policy if exists "own streak - read" on public.daily_streaks;
create policy "own streak - read"
  on public.daily_streaks for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.daily_streaks from anon;
revoke insert, update, delete on public.daily_streaks from authenticated;
grant select on public.daily_streaks to authenticated;
grant select, insert, update, delete on public.daily_streaks to service_role;

-- ---------------------------------------------------------------------------
-- Points. Append-only events; balances are their sum.
--
-- Two ledgers kept apart on purpose. Consistency is earned by counted days
-- and is the only ledger the streak multiplier touches. Progress is earned
-- once per goal when its completion rule is met by a follow-up read, at a
-- flat amount, never multiplied and never scaled by the size of a change.
-- The unique key is what makes a day count once however many devices tap
-- it. Nobody, service role included, is granted update or delete.
-- ---------------------------------------------------------------------------

create table if not exists public.points_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  ledger      text not null check (ledger in ('consistency', 'progress')),
  reason      text not null check (char_length(reason) between 1 and 48),
  day         date not null,
  base        integer not null check (base >= 0),
  multiplier  numeric(3,2) not null default 1.00 check (multiplier between 1.00 and 1.50),
  points      integer not null check (points >= 0),
  created_at  timestamptz not null default now(),
  unique (user_id, ledger, reason, day)
);

comment on table public.points_events is
  'Append-only points awards. Consistency may carry the streak multiplier (capped 1.50); progress never does.';

create index if not exists points_events_user_ledger_idx on public.points_events (user_id, ledger);

alter table public.points_events enable row level security;

drop policy if exists "own points - read" on public.points_events;
create policy "own points - read"
  on public.points_events for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.points_events from anon;
revoke insert, update, delete on public.points_events from authenticated;
grant select on public.points_events to authenticated;
revoke update, delete on public.points_events from service_role;
grant select, insert on public.points_events to service_role;

-- Balances are a reading of the events, so they cannot drift from them.
-- security_invoker means the browser sees only its own rows through the
-- table's policy.
create or replace view public.points_balances
with (security_invoker = true) as
  select user_id,
         ledger,
         sum(points)::integer as points,
         count(*)::integer as events,
         max(day) as last_day
  from public.points_events
  group by user_id, ledger;

revoke all on public.points_balances from anon;
grant select on public.points_balances to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The multiplier tiers. The same table lives in src/engine/dailyStreak.ts
-- for the optimistic render, and a test pins the two against each other.
-- ---------------------------------------------------------------------------

create or replace function public.streak_multiplier(p_days integer)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_days >= 60 then 1.50
    when p_days >= 30 then 1.35
    when p_days >= 14 then 1.20
    when p_days >= 7 then 1.10
    else 1.00
  end;
$$;

revoke all on function public.streak_multiplier(integer) from public, anon, authenticated;
grant execute on function public.streak_multiplier(integer) to service_role;

-- ---------------------------------------------------------------------------
-- Count a day. Idempotent per day, spends grace, keeps the best.
--
-- The route has already checked the day is within one day of its own UTC
-- date, so a clock cannot be walked forward. A day at or before the last
-- counted day changes nothing and reports counted=false. A gap of one is
-- the next day. A larger gap spends the missed days from banked grace when
-- it can; otherwise the run ends and a new one starts today at one. Every
-- seven consecutive counted days bank one grace day, to a maximum of two.
-- ---------------------------------------------------------------------------

create or replace function public.count_streak_day(p_user_id uuid, p_day date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.daily_streaks%rowtype;
  gap integer;
  missed integer;
  counted boolean := false;
  ended boolean := false;
  previous_best integer;
begin
  insert into public.daily_streaks (user_id) values (p_user_id)
  on conflict (user_id) do nothing;

  select * into s from public.daily_streaks where user_id = p_user_id for update;
  previous_best := s.best;

  if s.last_counted_day is null then
    s.current := 1;
    counted := true;
  elsif p_day > s.last_counted_day then
    gap := p_day - s.last_counted_day;
    missed := gap - 1;
    if missed <= s.grace_banked then
      s.grace_banked := s.grace_banked - missed;
      s.current := s.current + 1;
    else
      ended := s.current > 0;
      s.current := 1;
      s.grace_banked := 0;
    end if;
    counted := true;
  end if;

  if counted then
    s.last_counted_day := p_day;
    if s.current % 7 = 0 then
      s.grace_banked := least(2, s.grace_banked + 1);
    end if;
    s.best := greatest(s.best, s.current);
    update public.daily_streaks
      set current = s.current,
          best = s.best,
          last_counted_day = s.last_counted_day,
          grace_banked = s.grace_banked,
          updated_at = now()
      where user_id = p_user_id;
  end if;

  return jsonb_build_object(
    'counted', counted,
    'ended', ended,
    'weekLanded', counted and s.current % 7 = 0,
    'current', s.current,
    'best', s.best,
    'previousBest', previous_best,
    'graceBanked', s.grace_banked,
    'lastCountedDay', s.last_counted_day,
    'enabled', s.enabled
  );
end;
$$;

revoke all on function public.count_streak_day(uuid, date) from public, anon, authenticated;
grant execute on function public.count_streak_day(uuid, date) to service_role;

-- ---------------------------------------------------------------------------
-- Award consistency points: read the tier and write the multiplied event in
-- one statement. Returns the points written, or 0 when the (user, reason,
-- day) key already exists.
-- ---------------------------------------------------------------------------

create or replace function public.award_consistency(p_user_id uuid, p_reason text, p_day date, p_base integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  days integer;
  mult numeric;
  pts integer;
begin
  if p_base < 0 then
    raise exception 'Base points cannot be negative';
  end if;
  select current into days from public.daily_streaks where user_id = p_user_id;
  mult := public.streak_multiplier(coalesce(days, 0));
  pts := round(p_base * mult);
  insert into public.points_events (user_id, ledger, reason, day, base, multiplier, points)
  values (p_user_id, 'consistency', p_reason, p_day, p_base, mult, pts)
  on conflict (user_id, ledger, reason, day) do nothing;
  if not found then
    return 0;
  end if;
  return pts;
end;
$$;

revoke all on function public.award_consistency(uuid, text, date, integer) from public, anon, authenticated;
grant execute on function public.award_consistency(uuid, text, date, integer) to service_role;

-- Verified progress: flat, multiplier fixed at 1.00, once per (reason, day).
-- The reason is the goal id, so a goal pays once.
create or replace function public.award_progress(p_user_id uuid, p_reason text, p_day date, p_points integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_points < 0 then
    raise exception 'Points cannot be negative';
  end if;
  insert into public.points_events (user_id, ledger, reason, day, base, multiplier, points)
  values (p_user_id, 'progress', p_reason, p_day, p_points, 1.00, p_points)
  on conflict (user_id, ledger, reason, day) do nothing;
  if not found then
    return 0;
  end if;
  return p_points;
end;
$$;

revoke all on function public.award_progress(uuid, text, date, integer) from public, anon, authenticated;
grant execute on function public.award_progress(uuid, text, date, integer) to service_role;
