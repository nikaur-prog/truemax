-- Funnel counters. Counts, not people.
--
-- The product is about to be pointed at TikTok traffic with no way to see
-- where anyone falls out of the funnel. This is the smallest thing that fixes
-- that: named events, bucketed by day, incremented — no user ids, no session
-- ids, no IPs, no user agents, no timestamps finer than a date. It cannot
-- answer "what did this person do", by construction, which is the point: the
-- privacy policy says photos and identity stay out of analytics, and a table
-- with no identity columns cannot drift into breaking that promise.

create table if not exists public.funnel_events (
  day date not null,
  event text not null check (char_length(event) between 1 and 48),
  count bigint not null default 0,
  primary key (day, event)
);

alter table public.funnel_events enable row level security;
-- No policies on purpose: only the service role (the /api/track function)
-- touches this table. Anonymous reads would leak traffic shape to anyone.

create or replace function public.bump_funnel_event(p_event text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.funnel_events (day, event, count)
  values (current_date, p_event, 1)
  on conflict (day, event) do update set count = funnel_events.count + 1;
$$;

revoke all on function public.bump_funnel_event(text) from public, anon, authenticated;
