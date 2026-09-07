-- Say when a grace day was spent.
--
-- Grace was silent: a missed day covered by a banked day just carried on, so
-- nobody learned the mechanic existed or that they had just used one. When a
-- run later ends it then reads as arbitrary. This records the day grace
-- covered a gap, so the lamp can say so once, on that day.
--
-- 20260904090000 is applied in production, so this replaces the function
-- rather than editing it. The signature is unchanged, so create or replace
-- is enough and no grant is disturbed.

alter table public.daily_streaks
  add column if not exists grace_spent_on date;

comment on column public.daily_streaks.grace_spent_on is
  'The counted day on which banked grace covered a gap. Read once, on that day, to explain the mechanic.';

create or replace function public.count_streak_day(p_user_id uuid, p_day date, p_day_base integer, p_week_base integer)
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
  week_landed boolean := false;
  spent integer := 0;
  previous_best integer;
  day_points integer := 0;
  week_points integer := 0;
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
      spent := missed;
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
    if spent > 0 then
      s.grace_spent_on := p_day;
    end if;
    if s.current % 7 = 0 then
      s.grace_banked := least(2, s.grace_banked + 1);
    end if;
    s.best := greatest(s.best, s.current);
    week_landed := s.current % 7 = 0;
    update public.daily_streaks
      set current = s.current,
          best = s.best,
          last_counted_day = s.last_counted_day,
          grace_banked = s.grace_banked,
          grace_spent_on = s.grace_spent_on,
          updated_at = now()
      where user_id = p_user_id;
    -- The awards read the run as it now stands, so the day that reaches a
    -- tier earns at that tier. Same transaction as the count: either the
    -- day is counted and paid, or neither happened.
    day_points := public.award_consistency(p_user_id, 'day', p_day, p_day_base);
    if week_landed then
      week_points := public.award_consistency(p_user_id, 'week', p_day, p_week_base);
    end if;
  end if;

  return jsonb_build_object(
    'counted', counted,
    'ended', ended,
    'weekLanded', week_landed,
    'graceSpent', spent,
    'awarded', day_points + week_points,
    'current', s.current,
    'best', s.best,
    'previousBest', previous_best,
    'graceBanked', s.grace_banked,
    'lastCountedDay', s.last_counted_day,
    'graceSpentOn', s.grace_spent_on,
    'enabled', s.enabled
  );
end;
$$;
